import type { CrmView, ProspectFit, ProspectInput, ProspectStage, QueueItem, TractionAttention } from "../../shared/traction-types";
import { WebsiteSchema } from "../../shared/traction-types";
import {
  formatRand,
  VIRTEC_CLIENT_PREFIX,
  VIRTEC_INBOUND_PREFIX,
  VIRTEC_LEAD_PREFIX,
  inboundOrigin,
  type VirtecClient,
  type VirtecFollowUp,
  type VirtecInboundLead,
  type VirtecLead,
  type VirtecSnapshot,
} from "../../shared/virtec-types";
import type { Prospect } from "../../shared/traction-types";
import { daysBetween, isoDate } from "../../shared/traction-dates";
import type { LeadMagnet } from "../../shared/lead-magnet-types";
import type { MailThread } from "../../shared/mail-types";
import { magnetForLead } from "./lead-magnets";

export { formatRand, inboundOrigin };

/**
 * Virtec, turned into Traction's terms. Plain functions, no I/O.
 *
 * Virtec stays the owner of its records. What happens here is reading: which
 * follow-ups are due today, which leads are worth importing, what a lead
 * looks like as a prospect. Nothing here writes to Virtec.
 */

/** Leads Virtec has already ruled out, or already turned into customers. */
const SETTLED_LEAD_STATUSES = new Set(["disqualified", "converted"]);
/** How many importable leads the screen gets — the best, not all 500. */
export const IMPORTABLE_LEAD_LIMIT = 40;

function localDate(iso: string | undefined): string | undefined {
  return iso ? isoDate(new Date(iso)) : undefined;
}

/** Open follow-ups, and snoozed ones whose snooze has run out. */
function isLive(followUp: VirtecFollowUp, now: Date): boolean {
  if (followUp.status === "open") return true;
  if (followUp.status === "snoozed") return !followUp.snoozedUntil || Date.parse(followUp.snoozedUntil) <= now.getTime();
  return false;
}

export function buildCrmView(
  snapshot: VirtecSnapshot | undefined,
  prospects: readonly Prospect[],
  now: Date,
  problem?: string,
  writable = false,
): CrmView {
  if (!snapshot) {
    // Configured, but the first read has not come back inside the budget.
    return { configured: true, writable, pending: true, followUps: [], quotes: [], projects: [], leads: [], inbound: [], clients: [] };
  }

  if (!snapshot.configured) {
    return { configured: false, writable: false, problem, pending: false, followUps: [], quotes: [], projects: [], leads: [], inbound: [], clients: [] };
  }

  const imported = new Map(prospects.filter((prospect) => prospect.crmId).map((prospect) => [prospect.crmId as string, prospect.id]));
  const clientName = new Map(snapshot.clients.map((client) => [client.id, client.companyName ?? client.name]));

  return {
    configured: true,
    writable,
    pending: false,
    fetchedAt: snapshot.fetchedAt,
    sources: snapshot.sources,
    revenue: snapshot.revenue,
    followUps: snapshot.followUps
      .filter((followUp) => isLive(followUp, now))
      .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999")),
    quotes: snapshot.quotes
      .filter((quote) => quote.status === "pending")
      .map((quote) => ({ ...quote, clientName: quote.clientId ? clientName.get(quote.clientId) : undefined }))
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")),
    projects: snapshot.projects
      .filter((project) => project.status !== "completed" && project.status !== "cancelled")
      .sort((a, b) => (a.completion ?? 0) - (b.completion ?? 0)),
    leads: snapshot.leads
      .filter((lead) => !imported.has(`${VIRTEC_LEAD_PREFIX}${lead.id}`) && !SETTLED_LEAD_STATUSES.has(lead.status ?? ""))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, IMPORTABLE_LEAD_LIMIT),
    inbound: snapshot.inbound
      .filter(isOpenInbound)
      .map((lead) => ({ ...lead, prospectId: imported.get(`${VIRTEC_INBOUND_PREFIX}${lead.id}`) }))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    clients: snapshot.clients.map((client) => ({ ...client, prospectId: imported.get(`${VIRTEC_CLIENT_PREFIX}${client.id}`) })),
  };
}

// ─── Website leads ─────────────────────────────────────────────────────────

/** Still waiting on us: nobody has replied, ruled it out, or called it spam. */
function isOpenInbound(lead: VirtecInboundLead): boolean {
  return lead.status === undefined || lead.status === "new" || lead.status === "reviewing";
}

/** Where a lead came from, naming the lead magnet when it was one. */
function originOf(lead: VirtecInboundLead, magnets: readonly LeadMagnet[]): string {
  const magnet = magnetForLead(magnets, lead);
  return magnet ? `${magnet.track === "jurivo" ? "Jurivo" : "Virtara"} "${magnet.title}"` : inboundOrigin(lead);
}

/** A lead magnet signup who got the guide email is left alone this long before a personal follow-up. */
export const SECOND_TOUCH_AFTER_DAYS = 3;

/**
 * A message from the lead since they signed up, in the Inbox's cached
 * threads. Local only: it sees what Gmail sync has already pulled, never
 * Gmail itself, so a reply that has not synced yet is not seen yet.
 */
export function replyFrom(lead: Pick<VirtecInboundLead, "email" | "createdAt">, threads: readonly MailThread[]): MailThread | undefined {
  const email = lead.email?.toLowerCase();
  if (!email) return undefined;
  const since = lead.createdAt ? Date.parse(lead.createdAt) : 0;
  return threads
    .filter((thread) => thread.fromEmail?.toLowerCase() === email && Date.parse(thread.messageDate) >= since)
    .sort((a, b) => b.messageDate.localeCompare(a.messageDate))[0];
}

function daysSince(iso: string | undefined, today: string): number {
  return iso ? Math.max(0, daysBetween(isoDate(new Date(iso)), today)) : 0;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function who(lead: VirtecInboundLead): string {
  return lead.company ? `${lead.name} (${lead.company})` : lead.name;
}

/**
 * Website leads nobody has handled yet, as queue items.
 *
 * - **They wrote back** (a message from them since signing up): reply, at
 *   the very top. Someone answering is the warmest lead there is.
 * - **A form enquiry, or a magnet signup whose guide email failed**: reply,
 *   at the top. A person asked to hear from us and has heard nothing.
 * - **A magnet signup who got the guide email**: nothing for
 *   `SECOND_TOUCH_AFTER_DAYS`, then a second touch: one short, personal
 *   note from Dylan. Written and sent by a person, never automated.
 *
 * A lead already imported is left to its prospect's own queue item, so it
 * never shows twice.
 */
export function inboundQueueItems(
  inbound: readonly VirtecInboundLead[],
  prospects: readonly Prospect[],
  today: string,
  magnets: readonly LeadMagnet[] = [],
  threads: readonly MailThread[] = [],
): (QueueItem & { rank: number })[] {
  const imported = new Set(prospects.map((prospect) => prospect.crmId).filter(Boolean));
  const items: (QueueItem & { rank: number })[] = [];

  for (const lead of inbound) {
    if ((lead.status !== undefined && lead.status !== "new") || imported.has(`${VIRTEC_INBOUND_PREFIX}${lead.id}`)) continue;

    const origin = originOf(lead, magnets);
    const reply = replyFrom(lead, threads);
    if (reply) {
      items.push({
        id: `inbound:${lead.id}`,
        kind: "inbound",
        inboundLeadId: lead.id,
        title: `Reply to ${who(lead)}`,
        detail: [`${origin} · they wrote back ${daysSince(reply.messageDate, today) === 0 ? "today" : plural(daysSince(reply.messageDate, today), "day") + " ago"}`, reply.subject],
        rank: -1.5,
      });
      continue;
    }

    const waited = daysSince(lead.createdAt, today);
    const magnet = magnetForLead(magnets, lead);

    if (magnet && lead.nurtureSentAt) {
      const since = daysSince(lead.nurtureSentAt, today);
      if (since < SECOND_TOUCH_AFTER_DAYS) continue;
      items.push({
        id: `second_touch:${lead.id}`,
        kind: "second_touch",
        inboundLeadId: lead.id,
        title: `Second touch: ${who(lead)}`,
        detail: [`${origin} · guide emailed ${plural(since, "day")} ago`, "No reply yet"],
        rank: 1.4 + Math.min(since, 30) / 1000,
      });
      continue;
    }

    const firstLine = lead.message?.split("\n").find((line) => line.trim())?.trim();
    items.push({
      id: `inbound:${lead.id}`,
      kind: "inbound",
      inboundLeadId: lead.id,
      title: `Reply to ${who(lead)}`,
      detail: [
        `${origin} · ${waited === 0 ? "arrived today" : `waiting ${plural(waited, "day")}`}`,
        magnet && lead.nurtureError
          ? "The guide email did not send; send it yourself"
          : firstLine
            ? firstLine.length > 120
              ? `${firstLine.slice(0, 117)}...`
              : firstLine
            : lead.email ?? "No message",
      ],
      rank: -1 - waited / 100,
    });
  }

  return items;
}

/**
 * A website lead as a prospect.
 *
 * They came to us, so they start in conversation, from the website, with the
 * form they used as the reason. Their message and answers go in the notes as
 * they wrote them. `replied` says whether the first reply has already gone:
 * if not, replying is the prospect's next action, due today.
 */
export function inboundToProspect(lead: VirtecInboundLead, today: string, replied: boolean, magnet?: LeadMagnet): ProspectInput {
  const answers = Object.entries(lead.details).map(([key, value]) => `${key}: ${value}`);
  const notes = [
    `From the ${originOf(lead, magnet ? [magnet] : [])} form${lead.createdAt ? ` on ${isoDate(new Date(lead.createdAt))}` : ""}.`,
    lead.phone ? `Phone: ${lead.phone}` : undefined,
    ...answers,
    lead.message ? `\nTheir message:\n${lead.message}` : undefined,
  ].filter(Boolean);

  return {
    company: clip(lead.company ?? lead.name, 120) as string,
    contact: lead.company ? clip(lead.name, 120) : undefined,
    email: validEmail(lead.email),
    website: validWebsite(lead.website),
    segment: clip(lead.details.practiceArea ?? lead.details.industry, 80),
    stage: "conversation",
    source: "website",
    reasons: [clip(magnet ? `Downloaded "${magnet.title}"` : `Asked us through the ${inboundOrigin(lead)} form`, 200) as string],
    // A magnet's signups count toward its experiment, and point at its offer.
    experimentId: magnet?.experimentId,
    offerId: magnet?.offerId,
    nextAction: replied ? undefined : "Reply to their enquiry",
    nextActionDate: replied ? undefined : today,
    notes: clip(notes.join("\n"), 4000),
    crmId: `${VIRTEC_INBOUND_PREFIX}${lead.id}`,
  };
}

const FOLLOW_UP_TITLES: Record<string, string> = {
  quote_pending: "Follow up on quote",
  agreement_pending: "Chase agreement",
  invoice_overdue: "Chase overdue invoice",
  maintenance_renewal: "Maintenance renewal",
  project_stale: "Nudge stalled project",
};

/** Money owed first, then money waiting to be agreed. */
const FOLLOW_UP_RANK: Record<string, number> = {
  invoice_overdue: 0.5,
  quote_pending: 1,
  agreement_pending: 1.2,
};

/**
 * Virtec's follow-ups due by the end of today, as queue items.
 *
 * Only ever *surfaced*: Virtec already decided these are due, with its own
 * reason and a suggested message. AgentOS puts them in the same queue as
 * everything else so there is one list, not two.
 */
export function crmQueueItems(followUps: readonly VirtecFollowUp[], today: string): (QueueItem & { rank: number; customerId?: string })[] {
  return followUps
    .filter((followUp) => {
      const due = localDate(followUp.dueAt);
      return due === undefined || due <= today;
    })
    .map((followUp) => {
      const who = followUp.companyName ?? followUp.customerName ?? "a client";
      const detail = [followUp.reason, formatRand(followUp.amount), followUp.projectName].filter((entry): entry is string => Boolean(entry));
      return {
        id: `crm:${followUp.id}`,
        kind: "crm" as const,
        crmFollowUpId: followUp.id,
        title: `${FOLLOW_UP_TITLES[followUp.type ?? ""] ?? "Follow up"}: ${who}`,
        detail: detail.length > 0 ? detail.slice(0, 2) : ["From Virtec"],
        rank: FOLLOW_UP_RANK[followUp.type ?? ""] ?? 1.8,
        customerId: followUp.customerId,
      };
    });
}

/** The CRM's own warnings, in Traction's vocabulary. Counts from Virtec, not recomputed. */
export function crmAttention(snapshot: VirtecSnapshot | undefined): TractionAttention[] {
  const revenue = snapshot?.revenue;
  if (!revenue) return [];
  const flags: TractionAttention[] = [];

  if ((revenue.overdueInvoiceCount ?? 0) > 0) {
    const count = revenue.overdueInvoiceCount as number;
    flags.push({
      kind: "crm_overdue_invoices",
      count,
      message: `${count} ${count === 1 ? "invoice is" : "invoices are"} overdue by 7+ days (Virtec)`,
      prospectIds: [],
    });
  }

  if ((revenue.stalePendingQuoteCount ?? 0) > 0) {
    const count = revenue.stalePendingQuoteCount as number;
    flags.push({
      kind: "crm_stale_quotes",
      count,
      message: `${count} ${count === 1 ? "quote has" : "quotes have"} had no answer in 3+ days (Virtec)`,
      prospectIds: [],
    });
  }

  return flags;
}

function fitFromScore(score: number | undefined): ProspectFit | undefined {
  if (score === undefined) return undefined;
  return score >= 70 ? "high" : score >= 40 ? "medium" : "low";
}

/** Virtec's outreach sequence, in pipeline stages. */
function stageFromLead(lead: VirtecLead): ProspectStage {
  if (lead.outreachStage === "replied") return "conversation";
  if (lead.outreachStage === "stopped") return "lost";
  if (lead.outreachStage && /^o\d$/.test(lead.outreachStage)) return "contacted";
  return "target";
}

function validWebsite(url: string | undefined): string | undefined {
  return url && WebsiteSchema.safeParse(url).success ? url : undefined;
}

function validEmail(email: string | undefined): string | undefined {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200 ? email : undefined;
}

const clip = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined);

/**
 * A Virtec lead as a Traction prospect.
 *
 * Virtec's score and reasons become the fit and "why this lead"; its pitch
 * becomes the angle. The observation is left empty on purpose: a scraped
 * signal ("weak website") is not a specific thing noticed by a person, and
 * the outreach guard should keep asking for one.
 */
export function leadToProspect(lead: VirtecLead): ProspectInput {
  const facts = [
    lead.score !== undefined ? `Virtec score ${lead.score}` : undefined,
    lead.websiteSignal ? `website signal: ${lead.websiteSignal}` : undefined,
    lead.rating !== undefined ? `rating ${lead.rating}${lead.reviewCount !== undefined ? ` (${lead.reviewCount} reviews)` : ""}` : undefined,
    lead.address,
  ].filter(Boolean);

  return {
    company: clip(lead.name, 120) as string,
    email: validEmail(lead.ownerEmail),
    website: validWebsite(lead.websiteUrl),
    segment: clip(lead.category, 80),
    fit: fitFromScore(lead.score),
    stage: stageFromLead(lead),
    source: "outbound",
    reasons: lead.scoreReasons.slice(0, 6).map((reason) => reason.slice(0, 200)),
    angle: clip(lead.outreachPitch, 300),
    notes: clip(`Imported from Virtec${lead.track ? ` (${lead.track})` : ""}. ${facts.join(" · ")}`, 4000),
    crmId: `${VIRTEC_LEAD_PREFIX}${lead.id}`,
  };
}

/** A Virtec client as a won prospect — so referrals and Waiting On can point at them. */
export function clientToProspect(client: VirtecClient): ProspectInput {
  const spent = formatRand(client.totalSpent);
  return {
    company: clip(client.companyName ?? client.name, 120) as string,
    contact: client.companyName ? clip(client.name, 120) : undefined,
    email: validEmail(client.email),
    stage: "won",
    source: "other",
    reasons: [],
    notes: clip(`Imported from Virtec.${spent ? ` Total spent ${spent}.` : ""}${client.maintenance ? " On maintenance." : ""}`, 4000),
    crmId: `${VIRTEC_CLIENT_PREFIX}${client.id}`,
  };
}
