import { z } from "zod";

/**
 * Outreach plays: the few cold-email approaches that work for small
 * businesses, each with what it needs from you and why it works.
 *
 * A play stands in for an offer. Small local businesses do not answer a
 * service menu; they answer a specific thing done or noticed for them. Each
 * play below is one such thing, and the composer asks only for the inputs
 * that play needs.
 */

export const PlaySchema = z.enum([
  "website_preview",
  "cold_pitch",
  "quick_fixes",
  "refresh",
  "bookings",
  "own_offer",
]);
export type Play = z.infer<typeof PlaySchema>;

export const CtaSchema = z.enum(["reply_question", "short_call", "see_preview"]);
export type Cta = z.infer<typeof CtaSchema>;

const Line = (max: number) => z.string().trim().max(max);

/** Everything the composer collected. Sent with the draft request; it is all the person's own words. */
export const OutreachBriefSchema = z
  .object({
    play: PlaySchema,
    cta: CtaSchema,
    /** The live link to a site already built for them. Required by the preview play. */
    previewUrl: z.string().trim().url().max(300).regex(/^https?:\/\//).optional(),
    /** Up to three concrete fixes, for the quick-fixes play. */
    fixes: z.array(Line(200).min(1)).max(3).default([]),
    /** "R4,500 once-off", "free if you keep it". Quoted as written, never invented. */
    price: Line(80).optional(),
    /** A link or one line about similar work done. */
    proof: Line(200).optional(),
    /** Anything else the email must say. */
    extra: Line(300).optional(),
    /** For `own_offer`: which saved offer. */
    offerId: z.string().max(80).optional(),
  })
  .strict();
export type OutreachBrief = z.infer<typeof OutreachBriefSchema>;

export type PlayInput = "previewUrl" | "fixes" | "price" | "proof" | "extra" | "offerId";

export interface PlayDefinition {
  id: Play;
  name: string;
  /** One line: when to use it. */
  bestFor: string;
  /** What makes it work, as a field note. */
  whyItWorks: string;
  /** The offer, in one sentence, as Hermes is told it. */
  pitch: string;
  /** Inputs this play asks for; `required` ones block the draft until filled. */
  inputs: { field: PlayInput; label: string; hint: string; required?: boolean }[];
  defaultCta: Cta;
}

export const PLAYS: readonly PlayDefinition[] = [
  {
    id: "website_preview",
    name: "Build it first",
    bestFor: "No website, or one that is badly broken on a phone.",
    whyItWorks:
      "Show, don't pitch. A link to a site already built with their name, services and photos is something they can look at in ten seconds, and it removes the risk of saying yes.",
    pitch: "I built a preview of a new website for them; it is live at the link and theirs to look at with no obligation.",
    inputs: [
      { field: "previewUrl", label: "Preview link", hint: "The live preview you built for them. Send a link, never an attachment.", required: true },
      { field: "price", label: "What it costs to keep", hint: "e.g. R4,500 once-off, or R450 a month with hosting. Leave empty to talk price later." },
      { field: "extra", label: "Anything else to mention", hint: "e.g. I used the photos from your Google listing" },
    ],
    defaultCta: "see_preview",
  },
  {
    id: "cold_pitch",
    name: "Pitch a custom build",
    bestFor: "Established businesses that need a bigger website or system.",
    whyItWorks: "A specific problem, a clear offer and one easy question.",
    pitch: "A custom website or system, quoted as a project.",
    inputs: [{ field: "price", label: "Project price", hint: "e.g. from R25,000" }],
    defaultCta: "reply_question",
  },
  {
    id: "quick_fixes",
    name: "Three quick fixes",
    bestFor: "A website that works but is losing them enquiries.",
    whyItWorks:
      "Free, specific and checkable. Naming two or three fixes they can verify on their own phone proves you looked, and gives them value even if they never reply.",
    pitch: "I noticed a few specific fixes that would get them more enquiries from their existing website, and can do them.",
    inputs: [
      { field: "fixes", label: "The fixes", hint: "One per line, each something they can check themselves. Up to three.", required: true },
      { field: "price", label: "Price, if you want to name one", hint: "e.g. R1,500 for all three" },
    ],
    defaultCta: "reply_question",
  },
  {
    id: "refresh",
    name: "Website refresh",
    bestFor: "An outdated site that works but does not look like the business it represents.",
    whyItWorks:
      "Lead with the gap between how good the business is (their reviews) and how the site looks. Owners feel that gap already; naming it kindly is enough.",
    pitch: "I redesign websites for businesses like theirs so the site matches the quality customers already talk about.",
    inputs: [
      { field: "proof", label: "Similar work", hint: "A link to a site you built, or one line about a result" },
      { field: "price", label: "Starting price", hint: "e.g. from R6,000" },
    ],
    defaultCta: "reply_question",
  },
  {
    id: "bookings",
    name: "Online bookings and enquiries",
    bestFor: "Service businesses (salons, trades, clinics) where customers still have to phone.",
    whyItWorks:
      "Tie it to time and missed money: calls missed while working, bookings lost after hours. Owners of busy service businesses feel this daily.",
    pitch: "I set up online booking and enquiry capture so they stop losing customers who cannot get through by phone.",
    inputs: [
      { field: "proof", label: "Similar work", hint: "A booking page you set up, or one line about a result" },
      { field: "price", label: "Price", hint: "e.g. R2,500 set-up" },
    ],
    defaultCta: "reply_question",
  },
  {
    id: "own_offer",
    name: "One of your saved offers",
    bestFor: "Anything the four above do not cover.",
    whyItWorks: "Use when you already have an offer written for this kind of business.",
    pitch: "",
    inputs: [
      { field: "offerId", label: "Offer", hint: "Choose from Traction → Offers", required: true },
      { field: "extra", label: "Anything else to mention", hint: "" },
    ],
    defaultCta: "reply_question",
  },
];

export const CTAS: readonly { id: Cta; name: string; line: string; note: string }[] = [
  {
    id: "reply_question",
    name: "One easy question",
    line: "End with a single yes/no question they can answer in one line.",
    note: "Best for a first email: asking for interest gets more replies than asking for time.",
  },
  {
    id: "short_call",
    name: "A 10-minute call",
    line: "Ask for a 10-minute call this week, with no pressure.",
    note: "Better for a follow-up, once they have shown some interest.",
  },
  {
    id: "see_preview",
    name: "Look at the preview",
    line: "Ask them to have a look at the preview link and say what they think.",
    note: "Only with a preview link: the link is the pitch.",
  },
];

export function playById(id: Play): PlayDefinition {
  return PLAYS.find((play) => play.id === id) ?? PLAYS[PLAYS.length - 1];
}

/** Which inputs are missing for a brief to be drafted. Empty means it can be. */
export function briefGaps(brief: OutreachBrief): string[] {
  const missing: string[] = [];
  for (const input of playById(brief.play).inputs) {
    if (!input.required) continue;
    const value = brief[input.field];
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (empty) missing.push(input.label.toLowerCase());
  }
  if (brief.cta === "see_preview" && !brief.previewUrl) missing.push("a preview link for that call to action");
  return missing;
}

/** What the website review found, as facts the composer can recommend from. */
export const SiteSignalsSchema = z.object({
  reachable: z.boolean(),
  https: z.boolean().optional(),
  mobileViewport: z.boolean().optional(),
  hasForm: z.boolean().optional(),
  hasPhoneOrWhatsApp: z.boolean().optional(),
  /** Text on the site that mentions booking online. */
  mentionsBooking: z.boolean().optional(),
  /** The newest year in the copyright line, when there is one. */
  copyrightYear: z.number().int().optional(),
  /** A social page rather than a website of their own. */
  socialOnly: z.boolean().optional(),
});
export type SiteSignals = z.infer<typeof SiteSignalsSchema>;

/** The play that suits what the review found, and why, in one line. */
export function recommendPlay(signals: SiteSignals | undefined, segment?: string): { play: Play; reason: string } {
  if (!signals || !signals.reachable || signals.socialOnly) {
    return {
      play: "website_preview",
      reason: signals?.socialOnly
        ? "They only have a social page: a built preview gives them something they do not have."
        : "No working website was found: a built preview is the strongest opener.",
    };
  }
  if (signals.mobileViewport === false) {
    return { play: "website_preview", reason: "Their site is not built for phones, where most of their customers look: show them one that is." };
  }
  const service = /(salon|hair|nail|beauty|spa|barber|clinic|dent|physio|plumb|electric|mechanic|auto|repair|clean|paint|garden|vet|gym|fitness|massage|tattoo)/i.test(segment ?? "");
  if (service && !signals.mentionsBooking && !signals.hasForm) {
    return { play: "bookings", reason: "A service business with no online booking or enquiry form: customers have to phone." };
  }
  const year = new Date().getFullYear();
  if (signals.copyrightYear !== undefined && signals.copyrightYear <= year - 3) {
    return { play: "refresh", reason: `The site's copyright line says ${signals.copyrightYear}: it has not been touched in years.` };
  }
  return { play: "quick_fixes", reason: "The site works: specific fixes they can check are the most credible opener." };
}

export const ObservationSchema = z.object({
  /** One sentence the email can open with. */
  text: z.string(),
  /** Where it can be checked: a page, a heading, a missing element. */
  evidence: z.string(),
  /** Who noticed it: AgentOS from the markup, or Hermes from reading the site. */
  by: z.enum(["agentos", "hermes"]),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const ResearchResultSchema = z.object({
  website: z.string().optional(),
  signals: SiteSignalsSchema,
  observations: z.array(ObservationSchema),
  recommended: z.object({ play: PlaySchema, reason: z.string() }),
  /** Why Hermes added nothing, when it did not. AgentOS's own checks still stand. */
  hermesNote: z.string().optional(),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ─── Results ────────────────────────────────────────────────────────────────

export const SentStatusSchema = z.enum(["awaiting", "replied", "bounced", "opted_out", "draft"]);

export const SentEmailSchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  company: z.string(),
  to: z.string(),
  subject: z.string(),
  play: PlaySchema.optional(),
  at: z.string(),
  /** 1 for the first email to them, 2 for the first follow-up… */
  touch: z.number().int(),
  status: SentStatusSchema,
  repliedAt: z.string().optional(),
});
export type SentEmail = z.infer<typeof SentEmailSchema>;

export const RateSchema = z.object({
  /** Prospects emailed. */
  contacted: z.number().int(),
  replied: z.number().int(),
  /** Moved on to a conversation, proposal or win. */
  positive: z.number().int(),
  bounced: z.number().int(),
  optedOut: z.number().int(),
  /** replied / contacted, when anyone was contacted. */
  replyRate: z.number().optional(),
});
export type Rate = z.infer<typeof RateSchema>;

export const OutreachStatsSchema = z.object({
  /** Emails sent (not drafts), all time and in the last 30 and 7 days. */
  sent: z.object({ all: z.number().int(), last30: z.number().int(), last7: z.number().int() }),
  overall: RateSchema,
  last30: RateSchema,
  byPlay: z.array(RateSchema.extend({ play: z.string() })),
  /** Days from first email to first reply, median, when there are replies. */
  medianReplyDays: z.number().optional(),
  followUpsDue: z.array(
    z.object({
      prospectId: z.string(),
      company: z.string(),
      touch: z.number().int(),
      lastAt: z.string(),
      dueAt: z.string(),
    }),
  ),
  sentEmails: z.array(SentEmailSchema),
});
export type OutreachStats = z.infer<typeof OutreachStatsSchema>;

/** Days after the previous email that each follow-up is due. A third email is the last. */
export const FOLLOW_UP_DAYS = [3, 4] as const;
export const MAX_TOUCHES = FOLLOW_UP_DAYS.length + 1;
