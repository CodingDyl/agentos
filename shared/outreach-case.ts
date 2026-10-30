import { z } from "zod";

/**
 * Outreach cases: everything known and decided about writing to one business.
 *
 * One record per prospect, saved as it is edited. You, Hermes and coding
 * agents all read and write the same record through the same endpoint
 * (`PATCH /api/outreach/cases/:prospectId`), and each field remembers who
 * last filled it. To add a field: add it to `OutreachCaseSchema`, to
 * `OutreachCasePatchSchema`, and to `CASE_FIELDS` below. The screen, the
 * Hermes brief and the docs all read `CASE_FIELDS`.
 *
 * See docs/outreach/README.md.
 */

/** The three ways to sell. */
export const OutreachPathSchema = z.enum(["build_first", "cold_pitch", "photo_sample"]);
export type OutreachPath = z.infer<typeof OutreachPathSchema>;

export const PATHS: Record<OutreachPath, { name: string; line: string; when: string }> = {
  build_first: {
    name: "Build it first",
    line: "Build their new site, send them the link, charge monthly for hosting and care.",
    when: "Small businesses with no website or a weak one. Showing beats pitching.",
  },
  cold_pitch: {
    name: "Pitch a custom build",
    line: "A standard cold email for a bigger website or system, quoted as a project.",
    when: "Established businesses that need more than a small site.",
  },
  photo_sample: {
    name: "Better photos, free",
    line: "Enhance 2-3 of their own photos, send them as a link, and charge once-off for the full set.",
    when: "Guesthouses, holiday rentals, restaurants, estate agents and venues whose listing photos are weak.",
  },
};

/** A free sample is this many of their own photos at most. */
export const SAMPLE_PHOTO_LIMIT = 3;

/** The library tag the enhanced photos for one business carry. Same slug rule as the server's `prospectTag`. */
export function samplePhotoTag(business: string): string {
  const slug = business
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `prospect:${slug}`;
}

export const FilledBySchema = z.enum(["you", "hermes", "agent"]);
export type FilledBy = z.infer<typeof FilledBySchema>;

const Words = (max: number) => z.string().trim().max(max);

export const CaseDraftSchema = z.object({
  subject: Words(150),
  body: z.string().max(6000),
});

export const OutreachCaseSchema = z.object({
  prospectId: z.string(),
  /** What the business is and does, in plain words. */
  about: Words(1200).default(""),
  /** Specific problems noticed, one per line. Each checkable by the owner. */
  findings: z.array(Words(300)).max(8).default([]),
  /** How you could help them, in plain words. */
  howWeHelp: Words(1200).default(""),
  /** The email's first line: the one thing that makes them read on. */
  hook: Words(500).default(""),
  path: OutreachPathSchema.optional(),
  /** Why Hermes suggested that path. */
  pathReason: Words(400).default(""),
  /** Hermes' ideas for framing the offer. Pick one into `offer`, or ignore them. */
  framing: z.array(Words(400)).max(6).default([]),
  /** The offer as the email will put it, in one or two lines. */
  offer: Words(600).default(""),
  /** Build-first: the live link to the site you built for them. */
  previewUrl: Words(300).default(""),
  /** Build-first: e.g. "R450 a month, hosting and changes included". Quoted exactly. */
  monthlyPrice: Words(80).default(""),
  /** Build-first: a one-off set-up fee, if any. */
  setupPrice: Words(80).default(""),
  /** Custom build: a price or range, e.g. "from R25,000". */
  projectPrice: Words(80).default(""),
  /**
   * What the leak costs them, your estimate: written as you would say it
   * ("100", "R129", "20%") and read by `leakEstimate`. Never filled by Hermes.
   */
  leadsPerMonth: Words(40).default(""),
  costPerLead: Words(40).default(""),
  leakPercent: Words(40).default(""),
  jobValue: Words(40).default(""),
  bookedPercent: Words(40).default(""),
  /** Better photos: the link to a gallery of the enhanced photos. Always a link, never an attachment. */
  samplesUrl: Words(300).default(""),
  /** Better photos: you compared each enhanced photo with its original and it shows nothing that is not really there. */
  samplesChecked: z.boolean().default(false),
  /** Which of your companies the email is from. */
  senderId: z.string().default(""),
  draft: CaseDraftSchema.optional(),
  /**
   * When the draft was last saved. Set by the server, never by a writer. A
   * follow-up screen uses it to tell a new draft from the email already sent.
   * Kept beside the draft, not in it, so the draft stays exactly an email.
   */
  draftAt: z.string().default(""),
  /** Research notes: anything Hermes, an agent or you found that is not a field above. */
  notes: z.string().max(6000).default(""),
  /** Who last filled each field. */
  filledBy: z.record(z.string(), FilledBySchema).default({}),
  updatedAt: z.string().default(""),
});
export type OutreachCase = z.infer<typeof OutreachCaseSchema>;

/** Any subset of the editable fields. `null` clears one. */
export const OutreachCasePatchSchema = z
  .object({
    about: Words(1200).nullable(),
    findings: z.array(Words(300).min(1)).max(8).nullable(),
    howWeHelp: Words(1200).nullable(),
    hook: Words(500).nullable(),
    path: OutreachPathSchema.nullable(),
    pathReason: Words(400).nullable(),
    framing: z.array(Words(400).min(1)).max(6).nullable(),
    offer: Words(600).nullable(),
    previewUrl: z.union([z.literal(""), z.string().trim().url().max(300).regex(/^https?:\/\//, "Must be a web address")]).nullable(),
    monthlyPrice: Words(80).nullable(),
    setupPrice: Words(80).nullable(),
    projectPrice: Words(80).nullable(),
    leadsPerMonth: Words(40).nullable(),
    costPerLead: Words(40).nullable(),
    leakPercent: Words(40).nullable(),
    jobValue: Words(40).nullable(),
    bookedPercent: Words(40).nullable(),
    samplesUrl: z.union([z.literal(""), z.string().trim().url().max(300).regex(/^https?:\/\//, "Must be a web address")]).nullable(),
    samplesChecked: z.boolean().nullable(),
    senderId: z.string().max(80).nullable(),
    draft: CaseDraftSchema.nullable(),
    notes: z.string().max(6000).nullable(),
  })
  .partial()
  .strict();
export type OutreachCasePatch = z.infer<typeof OutreachCasePatchSchema>;

/** A write: the patch, and who is making it. */
export const CaseWriteSchema = z
  .object({ patch: OutreachCasePatchSchema, by: FilledBySchema.default("you") })
  .strict();

export type CaseFieldKey = Exclude<keyof OutreachCasePatch, "draft" | "samplesChecked">;

/**
 * Every editable field, with what it is for. Read by the screen (labels,
 * hints), by the Hermes brief (what to fill), and by the docs.
 * `hermes: true` fields are ones the brief fills.
 */
export const CASE_FIELDS: readonly { key: CaseFieldKey; label: string; hint: string; hermes: boolean; list?: boolean }[] = [
  { key: "about", label: "What they do", hint: "The business in two or three plain sentences.", hermes: true },
  { key: "findings", label: "What we noticed", hint: "One per line. Each something the owner can check on their phone.", hermes: true, list: true },
  { key: "howWeHelp", label: "How we can help", hint: "What you would do for them, and what it changes for their customers.", hermes: true },
  { key: "hook", label: "Opening line", hint: "The first line of the email. About them, not you.", hermes: true },
  { key: "path", label: "Approach", hint: "Build it first (monthly) or pitch a custom build.", hermes: true },
  { key: "pathReason", label: "Why this approach", hint: "", hermes: true },
  { key: "framing", label: "Ways to frame the offer", hint: "Hermes' ideas. Use one as the offer, or write your own.", hermes: true, list: true },
  { key: "offer", label: "The offer", hint: "One or two lines, as the email should put it.", hermes: true },
  { key: "previewUrl", label: "Preview link", hint: "The live site you built for them.", hermes: false },
  { key: "samplesUrl", label: "Sample photos link", hint: "A gallery of the enhanced photos. A link, never attachments.", hermes: false },
  { key: "monthlyPrice", label: "Monthly price", hint: "e.g. R450 a month, hosting and updates included", hermes: false },
  { key: "setupPrice", label: "Set-up fee", hint: "Leave empty for no upfront cost", hermes: false },
  { key: "projectPrice", label: "Project price", hint: "e.g. from R25,000", hermes: false },
  { key: "leadsPerMonth", label: "Enquiries a month", hint: "From their ads, e.g. 100", hermes: false },
  { key: "costPerLead", label: "Cost per enquiry", hint: "e.g. R129", hermes: false },
  { key: "leakPercent", label: "Lost on the site", hint: "Leave without calling, e.g. 20%", hermes: false },
  { key: "jobValue", label: "Average job", hint: "e.g. R1,700", hermes: false },
  { key: "bookedPercent", label: "Enquiries booked", hint: "Become a job, e.g. 40%", hermes: false },
  { key: "senderId", label: "Sent from", hint: "Which of your companies", hermes: false },
  { key: "notes", label: "Research notes", hint: "Anything else found about them. Hermes reads these when drafting.", hermes: false },
];

/** Hermes' brief, as it answers. Only `hermes: true` fields. */
export const HermesBriefSchema = z.object({
  about: z.string().default(""),
  findings: z.array(z.string()).default([]),
  howWeHelp: z.string().default(""),
  hook: z.string().default(""),
  path: OutreachPathSchema.optional(),
  pathReason: z.string().default(""),
  framing: z.array(z.string()).default([]),
  offer: z.string().default(""),
});
export type HermesBrief = z.infer<typeof HermesBriefSchema>;

// ─── Your companies ─────────────────────────────────────────────────────────

/**
 * A company you send as. The email goes from the connected outreach mailbox,
 * with this company's name as the sender name and its signature at the foot.
 */
export const SenderSchema = z.object({
  id: z.string(),
  /** "Virtara" */
  company: Words(80).min(1),
  /** The name the email shows as from, e.g. "Dylan at Virtara". */
  fromName: Words(80).min(1),
  /** What the company does, for Hermes to write from. */
  about: Words(600).default(""),
  website: Words(200).default(""),
  /** Who you are and how to opt out, at the foot of every email from this company. */
  signature: Words(600).min(1),
  /** Defaults copied into a case when the approach is chosen. */
  defaultMonthly: Words(80).default(""),
  defaultSetup: Words(80).default(""),
  defaultProject: Words(80).default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Sender = z.infer<typeof SenderSchema>;

export const SenderInputSchema = SenderSchema.omit({ id: true, createdAt: true, updatedAt: true }).strict();
export type SenderInput = z.infer<typeof SenderInputSchema>;

// ─── What the leak costs ────────────────────────────────────────────────────

/** The leak-cost fields, in the order the screen shows them. */
export const LEAK_FIELDS = ["leadsPerMonth", "costPerLead", "leakPercent", "jobValue", "bookedPercent"] as const;

export interface LeakEstimate {
  /** Enquiries a month the site loses. */
  lostEnquiries: number;
  /** Ad spend a month that buys those lost enquiries. */
  wastedSpend: number;
  /** Booked jobs a month those enquiries would have become, and what they are worth. Absent without a job value and booking rate. */
  lostJobs?: number;
  lostRevenue?: number;
}

/** A number as people write one: "R1,714", "20%", "R 2 500", "1714.50". Undefined when there is none. */
export function readAmount(text: string): number | undefined {
  const cleaned = text.replace(/(?<=\d)[\s,](?=\d{3}\b)/g, "").replace(/[^\d.]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return undefined;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * What the site's leak costs them a month, from your estimate. Needs the
 * enquiries, the cost of each and the share lost; the jobs and their value
 * are added when the job value and booking rate are known. Undefined until
 * there is enough to say anything.
 */
export function leakEstimate(entry: Pick<OutreachCase, (typeof LEAK_FIELDS)[number]>): LeakEstimate | undefined {
  const leads = readAmount(entry.leadsPerMonth);
  const cost = readAmount(entry.costPerLead);
  const percent = readAmount(entry.leakPercent);
  if (!leads || cost === undefined || !percent || percent > 100) return undefined;
  const lostEnquiries = (leads * percent) / 100;
  const estimate: LeakEstimate = { lostEnquiries, wastedSpend: lostEnquiries * cost };
  const job = readAmount(entry.jobValue);
  const booked = readAmount(entry.bookedPercent);
  if (job && booked && booked <= 100) {
    estimate.lostJobs = (lostEnquiries * booked) / 100;
    estimate.lostRevenue = estimate.lostJobs * job;
  }
  return estimate;
}

const rands = (value: number) => `R${Math.round(value).toLocaleString("en-ZA").replace(/\u00a0/g, " ")}`;
const about = (value: number) => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));

/** The estimate in one plain sentence, the same on the screen and in the draft. */
export function leakSentence(estimate: LeakEstimate): string {
  const head = `About ${about(estimate.lostEnquiries)} enquiries a month leave the site without calling: ${rands(estimate.wastedSpend)} of ad spend a month`;
  return estimate.lostJobs !== undefined && estimate.lostRevenue !== undefined
    ? `${head}, and about ${about(estimate.lostJobs)} ${estimate.lostJobs === 1 ? "job" : "jobs"} worth ${rands(estimate.lostRevenue)}.`
    : `${head}.`;
}

/** Where a case has got to, for the list. */
export type CaseStage = "new" | "briefed" | "decided" | "drafted" | "sent" | "replied";

export const CASE_STAGE_LABEL: Record<CaseStage, string> = {
  new: "Not started",
  briefed: "Briefed",
  decided: "Offer chosen",
  drafted: "Draft ready",
  sent: "Emailed",
  replied: "Replied",
};

export function caseStage(entry: OutreachCase | undefined, sent: boolean, replied: boolean): CaseStage {
  if (replied) return "replied";
  if (sent) return "sent";
  if (!entry) return "new";
  if (entry.draft?.body.trim()) return "drafted";
  if (entry.path && entry.offer.trim()) return "decided";
  if (entry.about.trim() || entry.findings.length > 0 || entry.hook.trim()) return "briefed";
  return "new";
}

/** What is still missing before Hermes can draft, in words. Empty means it can. */
export function draftGaps(entry: OutreachCase, sender: Sender | undefined): string[] {
  const gaps: string[] = [];
  if (!entry.hook.trim() && entry.findings.length === 0) gaps.push("an opening line or something you noticed");
  if (!entry.path) gaps.push("an approach");
  if (!entry.offer.trim()) gaps.push("the offer");
  if (entry.path === "build_first" && !entry.previewUrl.trim()) gaps.push("the preview link");
  if (entry.path === "photo_sample") {
    if (!entry.samplesUrl.trim()) gaps.push("the sample photos link");
    if (!entry.samplesChecked) gaps.push("your check that the photos invent nothing");
  }
  if (!sender) gaps.push("which company it is from");
  return gaps;
}

/** The play an email is logged under, for "what works". */
export const PATH_PLAY = { build_first: "website_preview", cold_pitch: "cold_pitch", photo_sample: "photo_sample" } as const;
