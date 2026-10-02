import express from "express";
import { BusinessDraftRequestSchema, ClientWorkspaceLinkSchema, EntityWorkspacesPatchSchema, FollowUpActionSchema } from "../../shared/business-types";
import { isVirtecWritable } from "../virtec/client";
import { getVirtecSnapshot } from "../virtec/snapshot";
import { dismissFollowUp, markFollowUpSent, snoozeFollowUp } from "../virtec/writes";
import { createInboxDraft, getReplyContext, GmailError } from "../mail/gmail-client";
import { MimeError } from "../outreach/mime";
import { parse } from "../traction/route-helpers";
import { getBusiness } from "./business";
import { BusinessNotFoundError, setClientWorkspace, setEntityWorkspaces } from "./store";

/** Business: entities, clients and the workspace links between them. */
export const businessRouter = express.Router();

function fail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof BusinessNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  console.error(`[agentos] business: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

businessRouter.get("/", async (request, response) => {
  try {
    response.json(await getBusiness({ fresh: request.query.fresh === "1" }));
  } catch (error) {
    fail(response, error, "read Business");
  }
});

businessRouter.put("/entities/:id/workspaces", async (request, response) => {
  const body = parse(EntityWorkspacesPatchSchema, request.body, response, "workspace list");
  if (!body) return;
  try {
    await setEntityWorkspaces(request.params.id, body.workspaces);
    response.json(await getBusiness());
  } catch (error) {
    fail(response, error, "link workspaces");
  }
});

businessRouter.put("/clients/:id/workspace", async (request, response) => {
  const body = parse(ClientWorkspaceLinkSchema, request.body, response, "workspace link");
  if (!body) return;
  try {
    // Only a client Virtec actually has can be linked; this also keeps
    // arbitrary keys (`__proto__`) out of the record.
    const known = (await getBusiness()).clients.some((client) => client.id === request.params.id);
    if (!known) {
      response.status(404).json({ error: "No such client" });
      return;
    }
    await setClientWorkspace(request.params.id, body.workspace);
    response.json(await getBusiness());
  } catch (error) {
    fail(response, error, "link the client");
  }
});

/**
 * A person handled a follow-up (wrote to the client, put it off, or decided it
 * is not worth chasing). The change is made in Virtec, which owns follow-ups;
 * nothing is kept locally, so a failed write is reported rather than hidden.
 */
businessRouter.post("/follow-ups/:id", async (request, response) => {
  const body = parse(FollowUpActionSchema, request.body, response, "follow-up action");
  if (!body) return;

  try {
    if (!isVirtecWritable()) {
      response.status(409).json({ error: "Virtec write access is not set up (VIRTEC_WRITE_API_KEY)." });
      return;
    }
    // Only a follow-up Virtec actually has; the id goes into a Virtec URL.
    const known = (await getVirtecSnapshot()).followUps.some((followUp) => followUp.id === request.params.id);
    if (!known) {
      response.status(404).json({ error: "No such follow-up" });
      return;
    }

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(midnight.getDate() + body.days);

    const outcome =
      body.action === "sent" ? await markFollowUpSent(request.params.id) : body.action === "dismiss" ? await dismissFollowUp(request.params.id) : await snoozeFollowUp(request.params.id, midnight);

    if (!outcome.ok) {
      response.status(502).json({ error: outcome.error });
      return;
    }
    response.json(await getBusiness());
  } catch (error) {
    fail(response, error, "update the follow-up");
  }
});

/** "Re: " once, never "Re: Re: ". */
export function replySubject(subject: string): string {
  const clean = subject.replace(/[\r\n]+/g, " ").trim() || "your message";
  return /^re:/i.test(clean) ? clean.slice(0, 150) : `Re: ${clean}`.slice(0, 150);
}

/**
 * A person asked for a draft to a client: a follow-up's suggested email, or a
 * reply to one of their threads. It lands in Gmail Drafts; nothing is sent.
 */
businessRouter.post("/drafts", async (request, response) => {
  const body = parse(BusinessDraftRequestSchema, request.body, response, "draft");
  if (!body) return;

  try {
    const business = await getBusiness();
    const client = business.clients.find((entry) => entry.id === body.clientId);
    if (!client) {
      response.status(404).json({ error: "No such client" });
      return;
    }

    let to: string | undefined;
    let subject = body.subject?.trim() ?? "";
    let inReplyTo: string | undefined;

    if (body.threadId) {
      if (!client.mail.some((thread) => thread.threadId === body.threadId)) {
        response.status(404).json({ error: "That thread is not one of this client's" });
        return;
      }
      const context = await getReplyContext(body.threadId);
      to = context.fromEmail;
      inReplyTo = context.messageId && /^<[^<>\s]{1,300}>$/.test(context.messageId) ? context.messageId : undefined;
      subject = replySubject(context.subject || subject || "Your message");
    } else if (body.followUpId) {
      const followUp = business.followUps.find((entry) => entry.id === body.followUpId && entry.customerId === client.id);
      if (!followUp) {
        response.status(404).json({ error: "No such follow-up for this client" });
        return;
      }
      to = followUp.customerEmail ?? client.email;
      subject ||= followUp.suggestedSubject ?? "";
    } else {
      to = client.email;
    }

    if (!to) {
      response.status(422).json({ error: "Virtec has no email address for this client." });
      return;
    }
    if (!subject) {
      response.status(400).json({ error: "The draft needs a subject." });
      return;
    }

    const draft = await createInboxDraft({ to, subject, body: body.body, inReplyTo }, body.threadId);
    response.json({ draftId: draft.draftId, to, url: "https://mail.google.com/mail/#drafts" });
  } catch (error) {
    if (error instanceof MimeError) {
      response.status(422).json({ error: error.message });
      return;
    }
    if (error instanceof GmailError) {
      response.status(error.reason === "unauthorized" ? 401 : 502).json({ error: `${error.message} Check that Gmail is connected in Inbox.` });
      return;
    }
    fail(response, error, "create the draft");
  }
});
