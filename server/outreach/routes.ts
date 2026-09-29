import express, { type Response } from "express";
import {
  DEFAULT_DAILY_CAP,
  EmailContentSchema,
  MAX_DAILY_CAP,
  OutreachSettingsInputSchema,
  SendRequestSchema,
  SuppressionInputSchema,
  type OutreachStatus,
} from "../../shared/outreach-types";
import { fail as tractionFail, parse } from "../traction/route-helpers";
import {
  addSuppression,
  isSuppressed,
  logOutreach,
  readState,
  removeSuppression,
  reserveSend,
  saveOutreachSignature,
  SendRefusedError,
  sentInLastDay,
  settleSend,
  TractionNotFoundError,
} from "../traction/store";
import {
  buildOutreachConsentUrl,
  disconnectOutreach,
  isOutreachConfigured,
  OutreachAuthError,
  outreachAddress,
} from "./auth";
import {
  draftOutreachEmail,
  draftReplyEmail,
  OutreachDraftError,
  recipientBlocker,
} from "./draft";
import {
  createDraft,
  draftUrl,
  OutreachGmailError,
  sendMessage,
} from "./gmail";
import { buildMessage, isPlainAddress, MimeError } from "./mime";
import { syncOutreachInbox } from "./sync";

/**
 * `/api/outreach`: the separate mailbox, and writing to prospects from it.
 *
 * The recipient of an email is never in a request. It is always the
 * prospect's stored address, looked up here from the prospect's id, so a
 * request can change what an email says but not who it goes to.
 */
export const outreachRouter = express.Router();

/** Emails allowed in any 24 hours. `OUTREACH_DAILY_CAP`, clamped to 1..50; 10 when unset or unreadable. */
export function dailyCap(): number {
  const value = Number.parseInt(process.env.OUTREACH_DAILY_CAP ?? "", 10);
  return Number.isFinite(value) && value >= 1
    ? Math.min(value, MAX_DAILY_CAP)
    : DEFAULT_DAILY_CAP;
}

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof SendRefusedError) {
    response.status(429).json({ error: error.message });
    return;
  }
  if (error instanceof OutreachDraftError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof MimeError) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof OutreachAuthError) {
    response
      .status(error.reason === "offline" ? 502 : 409)
      .json({ error: error.message });
    return;
  }
  if (error instanceof OutreachGmailError) {
    response
      .status(error.reason === "unauthorized" ? 409 : 502)
      .json({ error: error.message });
    return;
  }
  tractionFail(response, error, what);
}

outreachRouter.get("/status", async (_request, response) => {
  try {
    const state = await readState();
    const address = await outreachAddress();
    const status: OutreachStatus = {
      configured: isOutreachConfigured(),
      connected: address !== undefined,
      address,
      signature: state.outreach.signature,
      lastSyncAt: state.outreachSync.lastSyncAt,
      sentToday: sentInLastDay(state),
      dailyCap: dailyCap(),
    };
    response.json(status);
  } catch (error) {
    fail(response, error, "read the outreach status");
  }
});

/** Sends the browser to Google to choose the outreach account. The page it started from rides through in `state`. */
outreachRouter.get("/connect", (request, response) => {
  try {
    response.redirect(buildOutreachConsentUrl(request.get("referer")));
  } catch (error) {
    response
      .status(409)
      .json({
        error:
          error instanceof Error ? error.message : "Google is not configured.",
      });
  }
});

outreachRouter.post("/disconnect", async (_request, response) => {
  await disconnectOutreach();
  response.json({ ok: true });
});

outreachRouter.put("/settings", async (request, response) => {
  const input = parse(
    OutreachSettingsInputSchema,
    request.body,
    response,
    "settings",
  );
  if (!input) return;
  try {
    response.json({ signature: await saveOutreachSignature(input.signature) });
  } catch (error) {
    fail(response, error, "save the signature");
  }
});

/** Hermes drafts the email (subject and body, signature included) for a person to edit. Nothing is created or sent. */
outreachRouter.post("/prospects/:id/draft", async (request, response) => {
  try {
    response.json(await draftOutreachEmail(request.params.id));
  } catch (error) {
    fail(response, error, "draft the email");
  }
});

/**
 * Puts the email in the outreach mailbox's Drafts. A person opens it in Gmail
 * and presses Send; nothing is sent from here.
 *
 * A cold email (a target, or someone contacted once) must carry the
 * signature, which is where the sender's identity and the opt-out line live.
 */
outreachRouter.post("/prospects/:id/gmail-draft", async (request, response) => {
  const content = parse(EmailContentSchema, request.body, response, "email");
  if (!content) return;

  try {
    const state = await readState();
    const prospect = state.prospects.find(
      (entry) => entry.id === request.params.id,
    );
    if (!prospect)
      throw new TractionNotFoundError(`No prospect ${request.params.id}`);

    const address = await outreachAddress();
    if (!address) {
      response
        .status(409)
        .json({ error: "Connect the outreach mailbox first." });
      return;
    }
    const signature = state.outreach.signature.trim();
    const blocker = recipientBlocker(prospect, signature);
    if (blocker) {
      response.status(422).json({ error: blocker });
      return;
    }
    const suppressed = isSuppressed(state, prospect.email as string);
    if (suppressed) {
      response
        .status(422)
        .json({
          error: `${prospect.email} is on the do-not-contact list (${suppressed.reason}).`,
        });
      return;
    }
    const cold = prospect.stage === "target" || prospect.stage === "contacted";
    if (cold && !content.body.includes(signature)) {
      response
        .status(422)
        .json({
          error:
            "Your signature and opt-out line must stay at the foot of an email to someone who has not replied.",
        });
      return;
    }

    const created = await createDraft({
      to: prospect.email as string,
      subject: content.subject,
      body: content.body,
    });
    await logOutreach({
      prospectId: prospect.id,
      kind: "draft",
      to: prospect.email as string,
      subject: content.subject,
      gmailDraftId: created.draftId,
    });
    response
      .status(201)
      .json({
        draftId: created.draftId,
        address,
        openUrl: draftUrl(address, created.messageId),
      });
  } catch (error) {
    fail(response, error, "create the Gmail draft");
  }
});

/**
 * Sends one email, now, to one prospect. The body of the request is exactly
 * what the person saw in the preview, plus `confirm: true`. There is no
 * recipient in it, and no way to send to more than one prospect per call.
 *
 * Refused (429) when the address is on the do-not-contact list, was emailed
 * in the last 14 days, or the daily cap is reached. A cold email must carry
 * the signature and its opt-out line.
 */
outreachRouter.post("/prospects/:id/send", async (request, response) => {
  const content = parse(SendRequestSchema, request.body, response, "email");
  if (!content) return;

  let reservationId: string | undefined;
  try {
    const state = await readState();
    const prospect = state.prospects.find(
      (entry) => entry.id === request.params.id,
    );
    if (!prospect)
      throw new TractionNotFoundError(`No prospect ${request.params.id}`);
    if (!(await outreachAddress())) {
      response
        .status(409)
        .json({ error: "Connect the outreach mailbox first." });
      return;
    }

    const signature = state.outreach.signature.trim();
    const blocker = recipientBlocker(prospect, signature);
    if (blocker) {
      response.status(422).json({ error: blocker });
      return;
    }
    const to = prospect.email as string;
    if (!isPlainAddress(to)) {
      response
        .status(422)
        .json({
          error:
            "This prospect's email address is not one AgentOS will send to.",
        });
      return;
    }
    // Answering something they wrote: it must be theirs, from this prospect's own address.
    const replyTo = content.replyToId
      ? state.outreachReplies.find((entry) => entry.id === content.replyToId && entry.prospectId === prospect.id)
      : undefined;
    if (content.replyToId && !replyTo) {
      response.status(422).json({ error: "That message is no longer here. Check for replies again." });
      return;
    }
    const cold = !replyTo && (prospect.stage === "target" || prospect.stage === "contacted");
    if (cold && !content.body.includes(signature)) {
      response.status(422).json({
        error: "Your signature and opt-out line must stay at the foot of an email to someone who has not replied.",
      });
      return;
    }
    const message = { to, subject: content.subject, body: content.body, inReplyTo: replyTo?.messageIdHeader };
    // Refuse a malformed email before a slot is reserved for it.
    buildMessage(message);

    reservationId = (
      await reserveSend({ prospectId: prospect.id, subject: content.subject, dailyCap: dailyCap(), isReply: Boolean(replyTo) })
    ).id;
    const sent = await sendMessage(message, replyTo?.threadId);
    await settleSend(reservationId, {
      kind: "sent",
      gmailMessageId: sent.messageId,
      threadId: sent.threadId,
    });
    response.status(201).json({ sent: true, to, messageId: sent.messageId });
  } catch (error) {
    if (reservationId) {
      const maybeSent =
        error instanceof OutreachGmailError &&
        (error.reason === "offline" || error.reason === "unreadable");
      await settleSend(reservationId, {
        kind: maybeSent ? "unconfirmed" : "released",
      }).catch(() => undefined);
      if (maybeSent) {
        response
          .status(502)
          .json({
            error:
              "Gmail did not confirm the send. It may have gone: check the outreach mailbox's Sent folder before trying again. AgentOS has counted it as sent.",
          });
        return;
      }
    }
    fail(response, error, "send the email");
  }
});

// ─── The do-not-contact list ───────────────────────────────────────────────

outreachRouter.get("/suppressions", async (_request, response) => {
  try {
    response.json({ suppressions: (await readState()).suppressions });
  } catch (error) {
    fail(response, error, "read the do-not-contact list");
  }
});

outreachRouter.post("/suppressions", async (request, response) => {
  const input = parse(
    SuppressionInputSchema,
    request.body,
    response,
    "address",
  );
  if (!input) return;
  if (!isPlainAddress(input.address)) {
    response.status(400).json({ error: "That is not an email address." });
    return;
  }
  try {
    response
      .status(201)
      .json(await addSuppression(input.address, input.reason));
  } catch (error) {
    fail(response, error, "add to the do-not-contact list");
  }
});

outreachRouter.delete("/suppressions/:address", async (request, response) => {
  try {
    await removeSuppression(request.params.address);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove from the do-not-contact list");
  }
});

// ─── Replies ───────────────────────────────────────────────────────────────

/** Reads the outreach inbox now: replies, "stop" messages, bounces. Read-only against Gmail. */
outreachRouter.post("/sync", async (_request, response) => {
  try {
    response.json(await syncOutreachInbox());
  } catch (error) {
    fail(response, error, "check the outreach mailbox");
  }
});

/** What this prospect has written back, newest first. */
outreachRouter.get("/prospects/:id/replies", async (request, response) => {
  try {
    const state = await readState();
    response.json({ replies: state.outreachReplies.filter((entry) => entry.prospectId === request.params.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10) });
  } catch (error) {
    fail(response, error, "read the replies");
  }
});

/** Hermes drafts the answer to one stored reply. Nothing is created or sent. */
outreachRouter.post("/prospects/:id/replies/:replyId/draft", async (request, response) => {
  try {
    response.json(await draftReplyEmail(request.params.id, request.params.replyId));
  } catch (error) {
    fail(response, error, "draft the reply");
  }
});
