import path from "node:path";
import {
  LEAD_MAGNET_FILE_VERSION,
  leadMagnetBlockers,
  LeadMagnetFileSchema,
  leadMagnetSource,
  magnetForSource,
  MAX_LEAD_MAGNET_SECTIONS,
  type LeadMagnet,
  type LeadMagnetFile,
  type LeadMagnetStats,
} from "../../shared/lead-magnet-types";
import type { Icp, Offer, Prospect, ProspectStage } from "../../shared/traction-types";
import { VIRTEC_INBOUND_PREFIX, type VirtecInboundLead } from "../../shared/virtec-types";
import { findStoredAsset } from "../designs/library";
import { ORIGINALS, readImage } from "../designs/media";
import type { LeadMagnetDraft } from "./lead-magnet-store";
import type { ZipEntry } from "./zip";

/**
 * Lead magnets, as plain functions: how each is doing, what Hermes is told,
 * how its reply is read, and the files a site receives. The one Hermes call
 * is in `lead-magnet-draft.ts`; the store is `lead-magnet-store.ts`.
 */

// ─── Stats ─────────────────────────────────────────────────────────────────

const PAST_FIRST_REPLY = new Set(["replied", "won"]);
const CONVERSATION_OR_LATER = new Set<ProspectStage>(["conversation", "proposal", "won"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Each magnet's signups and what became of them, from Virtec's website leads
 * and Traction's prospects. Counted, never typed in, so the numbers cannot
 * drift from what actually happened.
 */
export function leadMagnetStats(
  magnets: readonly LeadMagnet[],
  inbound: readonly VirtecInboundLead[],
  prospects: readonly Prospect[],
  now: Date,
): Record<string, LeadMagnetStats> {
  const byCrmId = new Map(prospects.filter((prospect) => prospect.crmId).map((prospect) => [prospect.crmId as string, prospect]));

  return Object.fromEntries(
    magnets.map((magnet) => {
      const signups = inbound.filter((lead) => lead.source === leadMagnetSource(magnet.slug));
      const prospectOf = (lead: VirtecInboundLead) => byCrmId.get(`${VIRTEC_INBOUND_PREFIX}${lead.id}`);
      return [
        magnet.id,
        {
          emailed: signups.filter((lead) => lead.nurtureSentAt).length,
          emailFailed: signups.filter((lead) => !lead.nurtureSentAt && lead.nurtureError).length,
          signups: signups.length,
          signupsLast7Days: signups.filter((lead) => lead.createdAt && now.getTime() - Date.parse(lead.createdAt) <= WEEK_MS).length,
          followedUp: signups.filter((lead) => PAST_FIRST_REPLY.has(lead.status ?? "") || prospectOf(lead)).length,
          conversations: signups.filter((lead) => {
            const prospect = prospectOf(lead);
            return prospect ? CONVERSATION_OR_LATER.has(prospect.stage) : lead.status === "won";
          }).length,
        },
      ];
    }),
  );
}

/** The magnet a website lead came from, if it came from one. */
export function magnetForLead(magnets: readonly LeadMagnet[], lead: Pick<VirtecInboundLead, "source">): LeadMagnet | undefined {
  return magnetForSource(magnets, lead.source);
}

// ─── Hermes ────────────────────────────────────────────────────────────────

/** What each site is, so a draft is written for the right reader. */
const SITE_CONTEXT: Record<LeadMagnet["track"], string> = {
  virtara: "Virtara: a South African web design and development studio. Readers are owners and marketers of small and mid-sized businesses.",
  jurivo: "Jurivo: legal intake software for South African law firms (lead capture, qualification, follow-up). Readers are partners and practice managers.",
};

const FORMAT_GUIDE: Record<LeadMagnet["format"], string> = {
  checklist: "A checklist: 4 to 6 sections, each a short intro line then 4 to 8 items written as `- [ ] ` lines a reader can tick today.",
  guide: "A short guide: 4 to 6 sections of 2 to 4 short paragraphs, with a bullet list where it helps. Practical, no theory.",
  template: "A template: 3 to 6 sections, each a fill-in-the-blanks block the reader copies, with one line on how to use it.",
  scorecard: "A scorecard: 4 to 6 sections, each 3 to 6 `- [ ] ` questions answered yes or no, ending with how to read the score.",
};

/**
 * What Hermes is told about one magnet.
 *
 * Only what AgentOS holds: the site, the ICP, the linked offer, and what the
 * person already wrote. The rules are the case-study rules: nothing invented,
 * and a fact that needs a number becomes a visible gap.
 */
export function buildLeadMagnetPacket(context: { magnet: LeadMagnet; icp?: Icp; offer?: Offer }): string {
  const { magnet, icp, offer } = context;
  const written = [
    magnet.promise && `Promise: ${magnet.promise}`,
    magnet.audience && `Audience: ${magnet.audience}`,
    magnet.headline && `Headline: ${magnet.headline}`,
    magnet.bullets.length > 0 && `Inside:\n${magnet.bullets.map((bullet) => `- ${bullet}`).join("\n")}`,
    magnet.sections.length > 0 && `Sections:\n${magnet.sections.map((section) => `## ${section.heading}\n${section.body}`).join("\n\n")}`,
  ].filter(Boolean);

  return [
    "DRAFT A LEAD MAGNET",
    "",
    "Write a free resource a prospect gets in exchange for their email, plus the landing page that offers it.",
    "It must be useful on its own, even to someone who never buys: that is what makes them trust the offer after it.",
    "",
    "Rules:",
    "- Practical and specific to the reader's situation. Every item is something they can check or do this week.",
    "- Never invent statistics, studies, client results, quotes or prices. A point that needs a number becomes `[NEEDS DATA: what number]` and is listed in `missing`.",
    "- Plain, direct English. No hype (\"revolutionary\", \"seamless\", \"unlock\", \"game-changer\").",
    "- Section bodies are plain text: blank lines between paragraphs, `- ` bullets, `- [ ] ` checklist items, `**bold**` sparingly. No HTML, no headings inside a body.",
    "- Mention the product at most once, in `nextStep`, as the natural next step, not a pitch.",
    "- The email goes out the moment someone signs up. Under 100 words, plain text, from Dylan in the first person: the link, one sentence on how to get the most from it, and one easy question they can answer by replying. Use `{{firstName}}` for their name and `{{link}}` exactly once where the link goes. No sales pitch, no second link.",
    "",
    `SITE: ${SITE_CONTEXT[magnet.track]}`,
    `FORMAT: ${FORMAT_GUIDE[magnet.format]}`,
    `WORKING TITLE: ${magnet.title}`,
    icp ? `IDEAL CUSTOMER: ${icp.name}. ${icp.offer}` : undefined,
    icp && icp.idealProspect.length > 0 ? `THEY LOOK LIKE:\n${icp.idealProspect.map((line) => `- ${line}`).join("\n")}` : undefined,
    offer ? `THE OFFER IT LEADS TO: ${offer.name}: ${offer.offer}` : undefined,
    written.length > 0 ? `--- ALREADY WRITTEN BY DYLAN (keep it; stay consistent with it) ---\n${written.join("\n")}` : undefined,
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "promise": "the one-line result the reader gets, under 20 words",',
    '  "audience": "who it is for, in their own words",',
    '  "headline": "landing page headline naming the outcome, under 12 words",',
    '  "subhead": "one or two sentences",',
    '  "bullets": ["3 to 5 lines on what is inside, concrete"],',
    '  "cta": "button text, 2 to 5 words",',
    '  "seoTitle": "under 60 characters",',
    '  "seoDescription": "under 155 characters",',
    '  "sections": [{ "heading": "…", "body": "…" }],',
    '  "nextStep": "one or two sentences pointing at the offer",',
    '  "emailSubject": "the signup email subject, under 8 words",',
    '  "emailBody": "the signup email, plain text, with {{firstName}} and {{link}}",',
    '  "missing": ["each fact the resource needs and nobody has given yet"]',
    "}",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function asText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function asList(value: unknown, max: number, limit: number): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asText(entry, max))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

/** Hermes' reply, read defensively. A reply with no sections is no draft. */
export function readLeadMagnetDraft(payload: unknown): LeadMagnetDraft | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;

  const sections = (Array.isArray(record.sections) ? record.sections : [])
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return undefined;
      const heading = asText((entry as Record<string, unknown>).heading, 120);
      const body = asText((entry as Record<string, unknown>).body, 4000);
      return heading && body ? { heading, body } : undefined;
    })
    .filter((entry): entry is { heading: string; body: string } => Boolean(entry))
    .slice(0, MAX_LEAD_MAGNET_SECTIONS);

  if (sections.length === 0) return undefined;

  return {
    promise: asText(record.promise, 200),
    audience: asText(record.audience, 200),
    headline: asText(record.headline, 120),
    subhead: asText(record.subhead, 300),
    cta: asText(record.cta, 40),
    seoTitle: asText(record.seoTitle, 70),
    seoDescription: asText(record.seoDescription, 170),
    nextStep: asText(record.nextStep, 300),
    emailSubject: asText(record.emailSubject, 150)?.replace(/[\r\n]+/g, " "),
    // Without the link placeholder the email cannot go out; better empty than wrong.
    emailBody: asText(record.emailBody, 3000)?.includes("{{link}}") ? asText(record.emailBody, 3000) : undefined,
    bullets: asList(record.bullets, 160, 6),
    sections,
    missing: asList(record.missing, 300, 20),
  };
}

// ─── Export ────────────────────────────────────────────────────────────────

export class LeadMagnetNotReadyError extends Error {}

/** Where each site keeps its magnets, relative to the repository root. */
export const SITE_PATHS: Record<LeadMagnet["track"], { content: string; images: string }> = {
  virtara: { content: "src/content/lead-magnets", images: "public/lead-magnets" },
  jurivo: { content: "content/lead-magnets", images: "public/lead-magnets" },
};

/** Both sites serve a magnet at the same path. */
export function leadMagnetPath(slug: string): string {
  return `/guides/${slug}`;
}

const COVER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * The files a site receives: `<slug>.json`, the cover image if there is one,
 * and a README saying where each goes. Refused while anything blocks the
 * magnet, so a gap can never reach a live page.
 */
export async function leadMagnetFiles(magnet: LeadMagnet): Promise<{ file: LeadMagnetFile; entries: ZipEntry[]; coverSkipped: boolean }> {
  const blockers = leadMagnetBlockers(magnet);
  if (blockers.length > 0) throw new LeadMagnetNotReadyError(`Not ready to export: ${blockers.join("; ")}`);

  let cover: { name: string; data: Buffer } | undefined;
  let coverSkipped = false;
  if (magnet.coverAssetId) {
    const asset = await findStoredAsset(magnet.coverAssetId);
    const extension = asset ? path.extname(asset.storedName).toLowerCase() : "";
    const data = asset && COVER_EXTENSIONS.has(extension) ? await readImage(ORIGINALS, asset.storedName) : undefined;
    if (data) cover = { name: `${magnet.slug}-cover${extension === ".jpeg" ? ".jpg" : extension}`, data };
    else coverSkipped = true;
  }

  const file = LeadMagnetFileSchema.parse({
    version: LEAD_MAGNET_FILE_VERSION,
    slug: magnet.slug,
    track: magnet.track,
    format: magnet.format,
    title: magnet.title,
    promise: magnet.promise,
    audience: magnet.audience,
    landing: { headline: magnet.headline, subhead: magnet.subhead, bullets: magnet.bullets, cta: magnet.cta },
    seo: { title: magnet.seoTitle, description: magnet.seoDescription },
    cover: cover?.name,
    sections: magnet.sections.filter((section) => section.body.trim()),
    nextStep: magnet.nextStep,
  });

  const where = SITE_PATHS[magnet.track];
  const readme = [
    `# ${magnet.title}`,
    "",
    `For the ${magnet.track === "jurivo" ? "Jurivo" : "Virtara"} site repository:`,
    "",
    `- \`${magnet.slug}.json\` goes in \`${where.content}/\``,
    cover ? `- \`${cover.name}\` goes in \`${where.images}/\`` : undefined,
    "",
    `Commit and deploy, and the page is live at \`${leadMagnetPath(magnet.slug)}\` on the site.`,
    `Signups reach Virtec as source \`${leadMagnetSource(magnet.slug)}\` and show up in Traction.`,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return {
    file,
    coverSkipped,
    entries: [
      { name: `${magnet.slug}.json`, data: Buffer.from(`${JSON.stringify(file, null, 2)}\n`, "utf8") },
      ...(cover ? [cover] : []),
      { name: "README.md", data: Buffer.from(readme, "utf8") },
    ],
  };
}
