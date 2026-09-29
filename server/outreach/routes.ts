import express, { type Response } from "express";
import { EmailContentSchema, OutreachSettingsInputSchema, type OutreachStatus } from "../../shared/outreach-types";
import { fail as tractionFail, parse } from "../traction/route-helpers";
import { logOutreach, readState, saveOutreachSignature, TractionNotFoundError } from "../traction/store";
import {
  buildOutreachConsentUrl,
  disconnectOutreach,
  isOutreachConfigured,
  OutreachAuthError,
  outreachAddress,
} from "./auth";
import { draftOutreachEmail, OutreachDraftError, recipientBlocker } from "./draft";
import { createDraft, draftUrl, OutreachGmailError } from "./gmail";
import { MimeError } from "./mime";

/**
 * `/api/outreach`: the separate mailbox, and writing to prospects from it.
 *
 * The recipient of an email is never in a request. It is always the
 * prospect's stored address, looked up here from the prospect's id, so a
 * request can change what an email says but not who it goes to.
 */
export const outreachRouter = express.Router();

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof OutreachDraftError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof MimeError) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof OutreachAuthError) {
    response.status(error.reason === "offline" ? 502 : 409).json({ error: error.message });
    return;
  }
  if (error instanceof OutreachGmailError) {
    response.status(error.reason === "unauthorized" ? 409 : 502).json({ error: error.message });
    return;
  }
  tractionFail(response, error, what);
}

outreachRouter.get("/status", async (_request, response) => {
  try {
    const status: OutreachStatus = {
      configured: isOutreachConfigured(),
      connected: (await outreachAddress()) !== undefined,
      address: await outreachAddress(),
      signature: (await readState()).outreach.signature,
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
    response.status(409).json({ error: error instanceof Error ? error.message : "Google is not configured." });
  }
});

outreachRouter.post("/disconnect", async (_request, response) => {
  await disconnectOutreach();
  response.json({ ok: true });
});

outreachRouter.put("/settings", async (request, response) => {
  const input = parse(OutreachSettingsInputSchema, request.body, response, "settings");
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
    const prospect = state.prospects.find((entry) => entry.id === request.params.id);
    if (!prospect) throw new TractionNotFoundError(`No prospect ${request.params.id}`);

    const address = await outreachAddress();
    if (!address) {
      response.status(409).json({ error: "Connect the outreach mailbox first." });
      return;
    }
    const signature = state.outreach.signature.trim();
    const blocker = recipientBlocker(prospect, signature);
    if (blocker) {
      response.status(422).json({ error: blocker });
      return;
    }
    const cold = prospect.stage === "target" || prospect.stage === "contacted";
    if (cold && !content.body.includes(signature)) {
      response.status(422).json({ error: "Your signature and opt-out line must stay at the foot of an email to someone who has not replied." });
      return;
    }

    const created = await createDraft({ to: prospect.email as string, subject: content.subject, body: content.body });
    await logOutreach({ prospectId: prospect.id, kind: "draft", to: prospect.email as string, subject: content.subject, gmailDraftId: created.draftId });
    response.status(201).json({ draftId: created.draftId, address, openUrl: draftUrl(address, created.messageId) });
  } catch (error) {
    fail(response, error, "create the Gmail draft");
  }
});
