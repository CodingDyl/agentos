import { draftGaps, type OutreachCase, type OutreachCasePatch, type Sender } from "@shared/outreach-case";

/** The "Write the email" card, so the Pitch ready card can take you to it. */
export const writeEmailAnchor = (prospectId: string) => `write-email-${prospectId}`;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The company to offer without asking, only when there is no doubt: the one
 * the quote is already in, or your only company when there is no quote. A
 * quote in a company you do not send as is a real choice, so nothing is offered.
 */
export function suggestedSender(senders: readonly Sender[], quoteCompany: string | undefined): Sender | undefined {
  if (quoteCompany) return senders.find((sender) => sameName(sender.company, quoteCompany));
  return senders.length === 1 ? senders[0] : undefined;
}

export interface PitchDraftInput {
  entry: OutreachCase;
  senders: readonly Sender[];
  /** The rebuild's preview: the server copies it onto the case before drafting. */
  previewUrl: string | undefined;
  /** "What we found" as the card shows it, which may come from the site check and not be on the case yet. */
  findings: readonly string[];
  quoteCompany: string | undefined;
  /** What is in the card's own controls. */
  chosenSenderId?: string;
  hook?: string;
  offer?: string;
}

export interface PitchDraftPlan {
  sender: Sender | undefined;
  /** What has to be saved on the case for the draft to go ahead. Only ever fills what is empty, or the company you chose. */
  patch: OutreachCasePatch;
  /** Same words and same rule as the server: empty means drafting will not be refused. */
  gaps: string[];
  ready: boolean;
  needsSender: boolean;
  /** The case has no opening of its own and there are no findings to use, so the card asks for one. */
  asksHook: boolean;
  asksOffer: boolean;
}

/** What pressing "Draft the pitch email" would save, and what is still missing before it can. */
export function planPitchDraft(input: PitchDraftInput): PitchDraftPlan {
  const { entry, senders, findings } = input;
  const sender = senders.find((candidate) => candidate.id === input.chosenSenderId)
    ?? senders.find((candidate) => candidate.id === entry.senderId)
    ?? suggestedSender(senders, input.quoteCompany);

  const patch: OutreachCasePatch = {};
  if (sender && sender.id !== entry.senderId) patch.senderId = sender.id;

  const hook = input.hook?.trim() ?? "";
  const offer = input.offer?.trim() ?? "";
  const hasOpening = Boolean(entry.hook.trim()) || entry.findings.length > 0;
  if (!hasOpening) {
    if (hook) patch.hook = hook;
    else if (findings.length > 0) patch.findings = [...findings];
  }
  const asksOffer = !entry.offer.trim();
  if (asksOffer && offer) patch.offer = offer;

  const gaps = draftGaps(
    {
      ...entry,
      path: "build_first",
      previewUrl: entry.previewUrl || input.previewUrl || "",
      hook: patch.hook ?? entry.hook,
      findings: patch.findings ?? entry.findings,
      offer: patch.offer ?? entry.offer,
    },
    sender,
  );

  return {
    sender,
    patch,
    gaps,
    ready: gaps.length === 0,
    needsSender: !sender,
    asksHook: !hasOpening && findings.length === 0,
    asksOffer,
  };
}
