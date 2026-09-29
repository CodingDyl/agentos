import { MAX_EMAIL_BODY, type EmailContent } from "../../shared/outreach-types";
import type { Icp, Offer, Prospect } from "../../shared/traction-types";
import { HermesError, sendToHermes } from "../hermes/client";
import { extractJson } from "../hermes/worker-review";
import { outreachGaps } from "../traction/engine";
import { readState, TractionNotFoundError } from "../traction/store";
import { isPlainAddress } from "./mime";

/**
 * Hermes drafting one outreach email, and the checks that come first.
 *
 * The same rule the queue's Ask Hermes always had, now enforced on the
 * server: no email is drafted without a specific, verifiable thing to say
 * (the prospect's website and a noticed observation, an ICP and an offer).
 * "Personalised" is not something a model can do without facts, and a
 * plausible invented compliment is worse than no email.
 */

export class OutreachDraftError extends Error {}

/** What Hermes says when it cannot do it honestly. */
export const NOT_ENOUGH_CONTEXT =
  "NOT ENOUGH CONTEXT FOR PERSONALIZED OUTREACH";

const GAP_WORDS: Record<string, string> = {
  icp: "an ICP",
  offer: "an offer chosen for this prospect",
  website: "their website",
  observation: "one specific thing you noticed about them",
};

/**
 * What Hermes is told. Only public, work-related facts: the company, their
 * website, what was noticed, the offer. Never the prospect's email address or
 * phone, and never the private notes (which may hold their own words, other
 * people's details, or money).
 */
export function buildEmailPacket(context: {
  prospect: Prospect;
  icp: Icp;
  offer: Offer;
}): string {
  const { prospect, icp, offer } = context;
  const followUp = prospect.stage !== "target" || Boolean(prospect.lastTouchAt);

  return [
    followUp ? "DRAFT A FOLLOW-UP EMAIL" : "DRAFT A FIRST OUTREACH EMAIL",
    "",
    `Write one short email from me to ${prospect.contact ?? `someone at ${prospect.company}`}.`,
    "",
    "Rules:",
    "- Lead with the specific thing noticed about them, then connect it to the offer in one sentence, then ask one easy question.",
    "- Under 110 words. Plain text. Three short paragraphs at most.",
    "- Every claim must come from the facts below or their website. Never invent numbers, clients, results or compliments.",
    '- No flattery, no "I came across your amazing company", no "I hope this finds you well", no "just checking in".',
    "- Do not sign off with a name and do not add an opt-out line: both are added for me.",
    followUp
      ? "- This is a follow-up: refer to the earlier contact briefly and add one new piece of value."
      : "- This is the first email they will get from me.",
    `- If you cannot find something genuinely specific, reply with exactly "${NOT_ENOUGH_CONTEXT}" and list what is missing.`,
    "",
    `THEIR COMPANY: ${prospect.company}`,
    prospect.contact ? `THE PERSON: ${prospect.contact}` : undefined,
    prospect.segment ? `WHAT THEY ARE: ${prospect.segment}` : undefined,
    `THEIR WEBSITE: ${prospect.website}`,
    `WHAT I NOTICED (specific and checkable): ${prospect.observation}`,
    prospect.angle ? `THE ANGLE TO OPEN WITH: ${prospect.angle}` : undefined,
    prospect.reasons.length > 0
      ? `WHY THEM:\n${prospect.reasons.map((reason) => `- ${reason}`).join("\n")}`
      : undefined,
    "",
    `WHO I AM SELLING TO: ${icp.name}. ${icp.offer}`,
    `WHAT I AM OFFERING THEM: ${offer.name}: ${offer.offer}`,
    offer.problem ? `THE PROBLEM IT SOLVES: ${offer.problem}` : undefined,
    "",
    "Reply with a single JSON object and nothing else:",
    '{ "subject": "under 8 words, specific, no clickbait", "body": "the email" }',
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/** Hermes' reply as an email, or the reason there is none. */
export function readEmailDraft(reply: string): EmailContent {
  if (reply.includes(NOT_ENOUGH_CONTEXT)) {
    throw new OutreachDraftError(
      `Hermes needs more to go on: ${reply.replace(NOT_ENOUGH_CONTEXT, "").trim().slice(0, 400) || "add something specific about them"}`,
    );
  }

  const payload = extractJson(reply);
  if (typeof payload !== "object" || payload === null)
    throw new OutreachDraftError(
      "Hermes answered, but not with an email AgentOS could read.",
    );

  const { subject, body } = payload as { subject?: unknown; body?: unknown };
  const cleanSubject =
    typeof subject === "string"
      ? subject
          .replace(/[\r\n]+/g, " ")
          .trim()
          .slice(0, 150)
      : "";
  const cleanBody =
    typeof body === "string"
      ? body.replace(/\r\n/g, "\n").trim().slice(0, MAX_EMAIL_BODY)
      : "";
  if (!cleanSubject || !cleanBody)
    throw new OutreachDraftError(
      "Hermes answered without a subject or a body.",
    );

  return { subject: cleanSubject, body: cleanBody };
}

/** Body then signature, as the email will read. */
export function withSignature(body: string, signature: string): string {
  return `${body.trim()}\n\n--\n${signature.trim()}`;
}

/** Why an email to this prospect cannot be created at all, or undefined when it can. Nothing to do with what it says. */
export function recipientBlocker(
  prospect: Prospect,
  signature: string,
): string | undefined {
  if (!prospect.email || !isPlainAddress(prospect.email))
    return "Add a valid email address for this prospect first.";
  if (prospect.stage === "won" || prospect.stage === "lost")
    return "This prospect is closed; there is nothing to send.";
  if (!signature.trim())
    return "Write your signature and opt-out line first: it goes on every email.";
  return undefined;
}

/** Why Hermes cannot draft for this prospect yet: the above, and not enough to say. */
export function draftingBlocker(
  prospect: Prospect,
  icp: Icp | undefined,
  offers: readonly Offer[],
  signature: string,
): string | undefined {
  const blocker = recipientBlocker(prospect, signature);
  if (blocker) return blocker;
  const gaps = outreachGaps(prospect, icp, offers);
  if (gaps.length > 0)
    return `Not enough to personalise yet. Add ${gaps.map((gap) => GAP_WORDS[gap] ?? gap).join(", ")}.`;
  return undefined;
}

export async function draftOutreachEmail(
  prospectId: string,
): Promise<EmailContent> {
  const state = await readState();
  const prospect = state.prospects.find((entry) => entry.id === prospectId);
  if (!prospect) throw new TractionNotFoundError(`No prospect ${prospectId}`);

  const blocker = draftingBlocker(
    prospect,
    state.icp,
    state.offers,
    state.outreach.signature,
  );
  if (blocker || !state.icp)
    throw new OutreachDraftError(blocker ?? "Add an ICP first.");
  const offer = state.offers.find(
    (entry) => entry.id === prospect.offerId,
  ) as Offer;

  let reply: string;
  try {
    reply = await sendToHermes(
      buildEmailPacket({ prospect, icp: state.icp, offer }),
      { operation: "other", timeoutMs: 90_000 },
    );
  } catch (error) {
    throw new OutreachDraftError(
      error instanceof HermesError
        ? error.message
        : "Hermes could not be reached.",
    );
  }

  const draft = readEmailDraft(reply);
  return {
    subject: draft.subject,
    body: withSignature(draft.body, state.outreach.signature),
  };
}
