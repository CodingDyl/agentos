import express, { type Response } from "express";
import {
  DEFAULT_DAILY_CAP,
  GmailDraftRequestSchema,
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
import { caseRouter } from "./case-routes";
import { allow, ApolloError, revealEmail, searchPeopleAtDomain } from "./apollo";
import type { Sender } from "../../shared/outreach-case";
import { OutreachBriefSchema, type OutreachBrief } from "../../shared/outreach-plays";
import { researchProspect } from "./research";
import { computeOutreachStats } from "./stats";
import { EmailFinderError, findEmailsForWebsite, siteDomain } from "./email-finder";
import {
  buildOutreachConsentUrl,
  inboxAddressForOutreach,
  outreachUsesInbox,
  useInboxForOutreach,
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
outreachRouter.use(caseRouter);

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
      usesInbox: await outreachUsesInbox(),
      inboxAddress: await inboxAddressForOutreach(),
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

/** Sends outreach from the account the inbox already has connected. */
outreachRouter.post("/use-inbox", async (_request, response) => {
  try {
    response.json(await useInboxForOutreach());
  } catch (error) {
    fail(response, error, "use the inbox account for outreach");
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

/**
 * Looks for the prospect's email address on their own website. Returns
 * suggestions, ranked; nothing is saved until a person accepts one.
 */
outreachRouter.post("/prospects/:id/find-email", async (request, response) => {
  try {
    const state = await readState();
    const prospect = state.prospects.find((entry) => entry.id === request.params.id);
    if (!prospect) {
      response.status(404).json({ error: "That prospect does not exist." });
      return;
    }
    response.json(await findEmailsForWebsite(prospect.website));
  } catch (error) {
    if (error instanceof EmailFinderError) {
      response.status(409).json({ error: error.message });
      return;
    }
    fail(response, error, "look for the email address");
  }
});

/** Who runs the business, from Apollo. Free: names and titles only, no addresses. */
outreachRouter.post("/prospects/:id/apollo/people", async (request, response) => {
  try {
    const prospect = (await readState()).prospects.find((entry) => entry.id === request.params.id);
    const domain = siteDomain(prospect?.website);
    if (!prospect || !domain) {
      response.status(409).json({ error: "This prospect needs its own website (not a social page) before Apollo can look the business up." });
      return;
    }
    allow("search_people", "company search");
    response.json({ domain, people: await searchPeopleAtDomain(domain) });
  } catch (error) {
    apolloFail(response, error);
  }
});

/** One person's email. This is the step that spends an Apollo credit. */
outreachRouter.post("/prospects/:id/apollo/reveal", async (request, response) => {
  try {
    const personId = typeof request.body?.personId === "string" ? request.body.personId : "";
    const prospect = (await readState()).prospects.find((entry) => entry.id === request.params.id);
    const domain = siteDomain(prospect?.website);
    if (!personId || !prospect || !domain) {
      response.status(400).json({ error: "Choose a person to reveal." });
      return;
    }
    allow("reveal_email", "reveal one email");
    const found = await revealEmail(personId, domain);
    response.json({ candidate: found ? { address: found.address, kind: "owner", source: "Apollo", note: found.verified ? "Verified by Apollo" : "Found by Apollo, not verified" } : null });
  } catch (error) {
    apolloFail(response, error);
  }
});

function senderFor(state: { senders: Sender[] }, senderId: string | undefined): Sender | undefined {
  return senderId ? state.senders.find((entry) => entry.id === senderId) : undefined;
}

function apolloFail(response: Response, error: unknown): void {
  if (error instanceof ApolloError) {
    response.status(error.reason === "failed" ? 502 : 409).json({ error: error.message });
    return;
  }
  fail(response, error, "ask Apollo");
}

/** The website review, in AgentOS: checks from the markup, and up to three things Hermes noticed. Saves nothing. */
outreachRouter.post("/prospects/:id/research", async (request, response) => {
  try {
    const prospect = (await readState()).prospects.find((entry) => entry.id === request.params.id);
    if (!prospect) throw new TractionNotFoundError(`No prospect ${request.params.id}`);
    response.json(await researchProspect(prospect));
  } catch (error) {
    fail(response, error, "review the website");
  }
});

/** Sent emails, reply rates, what works, and follow-ups due. Read only. */
outreachRouter.get("/stats", async (_request, response) => {
  try {
    response.json(computeOutreachStats(await readState()));
  } catch (error) {
    fail(response, error, "read the outreach results");
  }
});

/**
 * Hermes drafts the email (subject and body, signature included) for a
 * person to edit. Nothing is created or sent. A body, when there is one, is
 * the composer's brief: the play, its inputs and the call to action.
 */
outreachRouter.post("/prospects/:id/draft", async (request, response) => {
  let brief: OutreachBrief | undefined;
  if (request.body && typeof request.body === "object" && "play" in request.body) {
    const parsed = parse(OutreachBriefSchema, request.body, response, "outreach brief");
    if (!parsed) return;
    brief = parsed;
  }
  try {
    response.json(await draftOutreachEmail(request.params.id, brief));
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
  const content = parse(GmailDraftRequestSchema, request.body, response, "email");
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
    const sender = senderFor(state, content.senderId);
    if (content.senderId && !sender) {
      response.status(422).json({ error: "That company no longer exists. Choose another." });
      return;
    }
    const signature = (sender?.signature ?? state.outreach.signature).trim();
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
      from: sender ? { name: sender.fromName, address } : undefined,
    });
    await logOutreach({
      prospectId: prospect.id,
      kind: "draft",
      to: prospect.email as string,
      subject: content.subject,
      play: content.play,
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
 * too recently for the follow-up schedule, or the daily cap is reached. A cold email must carry
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
    const mailbox = await outreachAddress();
    if (!mailbox) {
      response
        .status(409)
        .json({ error: "Connect the outreach mailbox first." });
      return;
    }

    const sender = senderFor(state, content.senderId);
    if (content.senderId && !sender) {
      response.status(422).json({ error: "That company no longer exists. Choose another." });
      return;
    }
    const signature = (sender?.signature ?? state.outreach.signature).trim();
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
    const message = {
      to,
      subject: content.subject,
      body: content.body,
      inReplyTo: replyTo?.messageIdHeader,
      from: sender ? { name: sender.fromName, address: mailbox } : undefined,
    };
    // Refuse a malformed email before a slot is reserved for it.
    buildMessage(message);

    reservationId = (
      await reserveSend({ prospectId: prospect.id, subject: content.subject, dailyCap: dailyCap(), isReply: Boolean(replyTo), play: content.play })
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
