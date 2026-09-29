import { z } from "zod";

/**
 * Lead magnets: something useful a prospect gets in exchange for their email.
 *
 * Written here (Hermes drafts, a person edits), shipped to the Virtara or
 * Jurivo site as one JSON file plus a cover image, and measured by the
 * signups Virtec records under the magnet's own source, `magnet-<slug>`.
 *
 * Two shapes live in this file:
 *
 * - `LeadMagnet` is AgentOS's working record: drafts, gaps, links to an
 *   offer and an experiment.
 * - `LeadMagnetFile` is what a site reads. It is the contract between
 *   AgentOS and the sites, versioned, and holds only what a visitor sees.
 */

const Text = (max: number) => z.string().trim().min(1).max(max);

export const LeadMagnetTrackSchema = z.enum(["virtara", "jurivo"]);

/** The form the value takes. A checklist is the fastest to make and to use. */
export const LeadMagnetFormatSchema = z.enum(["checklist", "guide", "template", "scorecard"]);

export const LeadMagnetStatusSchema = z.enum(["draft", "ready", "live"]);

/**
 * Lower-case words joined by hyphens, at most 32 characters, so the signup
 * source `magnet-<slug>` fits Virtec's 40. It becomes a URL and a filename,
 * so nothing else is allowed.
 */
export const LeadMagnetSlugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, "Use lower-case letters, digits and hyphens (2 to 32)");

/** Creative asset ids are UUIDs; nothing else is accepted, so an id can never become a path. */
const AssetIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

export const LeadMagnetSectionSchema = z.object({
  heading: Text(120),
  /**
   * Plain text with a little structure the sites render safely: blank lines
   * between paragraphs, `- ` for a bullet, `- [ ] ` for a checklist item and
   * `**bold**`. Never HTML.
   */
  body: z.string().trim().max(4000),
});

export const MAX_LEAD_MAGNET_SECTIONS = 12;

const fields = {
  slug: LeadMagnetSlugSchema,
  track: LeadMagnetTrackSchema,
  format: LeadMagnetFormatSchema,
  status: LeadMagnetStatusSchema,
  title: Text(120),
  /** The one-line result the reader gets: "Stop losing after-hours enquiries". */
  promise: Text(200).optional(),
  /** Who it is for, in the reader's words: "Partners at 2 to 20 attorney firms". */
  audience: Text(200).optional(),
  offerId: z.string().optional(),
  experimentId: z.string().optional(),

  // The landing page.
  headline: Text(120).optional(),
  subhead: Text(300).optional(),
  /** What is inside, as three to five concrete lines. */
  bullets: z.array(Text(160)).max(6).default([]),
  /** The button: "Get the checklist". */
  cta: Text(40).optional(),
  seoTitle: Text(70).optional(),
  seoDescription: Text(170).optional(),

  // The magnet itself.
  sections: z.array(LeadMagnetSectionSchema).max(MAX_LEAD_MAGNET_SECTIONS).default([]),
  /** The one step after reading, pointing at the offer: "Book a 20-minute intake review". */
  nextStep: Text(300).optional(),
  coverAssetId: AssetIdSchema.optional(),

  // The email a signup gets at once, sent by Virtec.
  emailSubject: z.string().trim().min(1).max(150).regex(/^[^\r\n]*$/, "One line").optional(),
  /** Plain text with `{{link}}` where the link to the resource goes, and optionally `{{firstName}}`. */
  emailBody: z.string().trim().min(1).max(3000).optional(),

  /** What the draft could not know. Cleared by a person, not by Hermes. */
  missing: z.array(Text(300)).max(20).default([]),
  /** Where it is published, once it is. */
  liveUrl: z.string().trim().url().max(300).optional(),
};

/** What Virtec is sending right now, as last published from here. */
export const PublishedMagnetEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
  readUrl: z.string(),
  enabled: z.boolean(),
  at: z.string(),
});

export const LeadMagnetSchema = z.object({
  id: z.string(),
  ...fields,
  emailPublished: PublishedMagnetEmailSchema.optional(),
  draftedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LeadMagnetInputSchema = z.object({
  ...fields,
  status: LeadMagnetStatusSchema.default("draft"),
});

/** Adding one needs only what cannot be drafted: which site, what form, and a working title. */
export const NewLeadMagnetSchema = z
  .object({
    track: LeadMagnetTrackSchema,
    format: LeadMagnetFormatSchema,
    title: Text(120),
    slug: LeadMagnetSlugSchema.optional(),
    offerId: z.string().optional(),
  })
  .strict();

/** How a magnet is doing, counted from Virtec's website leads. Never typed in. */
export const LeadMagnetStatsSchema = z.object({
  /** Signups Virtec sent the magnet's email to. */
  emailed: z.number().int().default(0),
  /** Signups whose email Virtec could not send. */
  emailFailed: z.number().int().default(0),
  /** Signups under `magnet-<slug>`, all time (within what Virtec returned). */
  signups: z.number().int(),
  signupsLast7Days: z.number().int(),
  /** Signups someone has replied to, or taken into Traction. */
  followedUp: z.number().int(),
  /** Signups that became a prospect now in conversation or further. */
  conversations: z.number().int(),
});

// ─── The file a site reads ─────────────────────────────────────────────────

export const LEAD_MAGNET_FILE_VERSION = 1;

export const LeadMagnetFileSchema = z.object({
  version: z.literal(LEAD_MAGNET_FILE_VERSION),
  slug: LeadMagnetSlugSchema,
  track: LeadMagnetTrackSchema,
  format: LeadMagnetFormatSchema,
  title: Text(120),
  promise: Text(200),
  audience: Text(200).optional(),
  landing: z.object({
    headline: Text(120),
    subhead: Text(300).optional(),
    bullets: z.array(Text(160)).min(1).max(6),
    cta: Text(40),
  }),
  seo: z.object({ title: Text(70), description: Text(170) }),
  /** A filename next to the JSON, e.g. `after-hours-intake-cover.png`. */
  cover: z.string().regex(/^[a-z0-9-]+\.(png|jpe?g|webp)$/).optional(),
  sections: z.array(LeadMagnetSectionSchema).min(1).max(MAX_LEAD_MAGNET_SECTIONS),
  nextStep: Text(300).optional(),
});

export type LeadMagnetTrack = z.infer<typeof LeadMagnetTrackSchema>;
export type LeadMagnetFormat = z.infer<typeof LeadMagnetFormatSchema>;
export type LeadMagnetStatus = z.infer<typeof LeadMagnetStatusSchema>;
export type LeadMagnetSection = z.infer<typeof LeadMagnetSectionSchema>;
export type LeadMagnet = z.infer<typeof LeadMagnetSchema>;
export type LeadMagnetInput = z.input<typeof LeadMagnetInputSchema>;
export type NewLeadMagnet = z.infer<typeof NewLeadMagnetSchema>;
export type LeadMagnetStats = z.infer<typeof LeadMagnetStatsSchema>;
export type LeadMagnetFile = z.infer<typeof LeadMagnetFileSchema>;
export type PublishedMagnetEmail = z.infer<typeof PublishedMagnetEmailSchema>;

/** The Virtec source a magnet's signups carry. */
export function leadMagnetSource(slug: string): string {
  return `magnet-${slug}`;
}

/** A slug from a title: "The After-Hours Intake Checklist" → `after-hours-intake-checklist`. */
export function slugFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return LeadMagnetSlugSchema.safeParse(slug).success ? slug : "lead-magnet";
}

const GAP = /\[NEEDS DATA/i;

/**
 * What stops a magnet from shipping, in words a person can act on.
 *
 * Empty means it can be marked ready and exported. A `[NEEDS DATA]` anywhere
 * blocks it: a guide that states a guess as a fact costs more trust than it
 * earns emails.
 */
export function leadMagnetBlockers(
  magnet: Pick<LeadMagnet, "promise" | "headline" | "subhead" | "cta" | "seoTitle" | "seoDescription" | "nextStep"> & {
    bullets: readonly string[];
    sections: readonly LeadMagnetSection[];
    missing: readonly string[];
  },
): string[] {
  const blockers: string[] = [];
  if (!magnet.promise) blockers.push("Add the promise (the one-line result)");
  if (!magnet.headline) blockers.push("Add a landing headline");
  if (magnet.bullets.length === 0) blockers.push("Add at least one line on what is inside");
  if (!magnet.cta) blockers.push("Add the button text");
  if (!magnet.seoTitle || !magnet.seoDescription) blockers.push("Add the search title and description");
  if (magnet.sections.filter((section) => section.body.trim()).length < 2) blockers.push("Write at least two sections");
  const text = [magnet.promise, magnet.headline, magnet.subhead, ...magnet.bullets, magnet.nextStep, ...magnet.sections.flatMap((section) => [section.heading, section.body])];
  if (text.some((entry) => entry && GAP.test(entry))) blockers.push("Resolve every [NEEDS DATA] marker");
  if (magnet.missing.length > 0) blockers.push("Clear the missing-facts list");
  return blockers;
}

/** Where the email links to: the read page next to the live landing page. */
export function leadMagnetReadUrl(liveUrl: string | undefined): string | undefined {
  if (!liveUrl) return undefined;
  try {
    const url = new URL(liveUrl);
    if (url.protocol !== "https:") return undefined;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/read`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * What stops the signup email from being switched on. It links to the live
 * page, so the magnet must be live somewhere first.
 */
export function leadMagnetEmailBlockers(magnet: Pick<LeadMagnet, "emailSubject" | "emailBody" | "liveUrl">): string[] {
  const blockers: string[] = [];
  if (!magnet.emailSubject) blockers.push("Add the email subject");
  if (!magnet.emailBody) blockers.push("Write the email");
  else if (!magnet.emailBody.includes("{{link}}")) blockers.push("Put {{link}} in the email where the link goes");
  if ([magnet.emailSubject, magnet.emailBody].some((entry) => entry && GAP.test(entry))) blockers.push("Resolve the [NEEDS DATA] in the email");
  if (!leadMagnetReadUrl(magnet.liveUrl)) blockers.push("Add the https address it is live at");
  return blockers;
}

/** Whether the email Virtec sends differs from what is written here. */
export function emailChangedSincePublish(magnet: Pick<LeadMagnet, "emailSubject" | "emailBody" | "liveUrl" | "emailPublished">): boolean {
  const published = magnet.emailPublished;
  if (!published) return false;
  return published.subject !== magnet.emailSubject || published.body !== magnet.emailBody || published.readUrl !== leadMagnetReadUrl(magnet.liveUrl);
}

/** The magnet a website lead signed up through, if its source is `magnet-<slug>`. */
export function magnetForSource<T extends Pick<LeadMagnet, "slug">>(magnets: readonly T[], source: string | undefined): T | undefined {
  return source?.startsWith("magnet-") ? magnets.find((magnet) => leadMagnetSource(magnet.slug) === source) : undefined;
}
