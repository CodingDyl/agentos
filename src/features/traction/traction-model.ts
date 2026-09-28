import {
  OUTREACH_GAP_LABELS,
  STAGE_LABELS,
  type Icp,
  type Offer,
  type OutreachGap,
  type Prospect,
  type ProspectStage,
  type QueueItem,
  type TractionData,
  type WaitingOn,
  type WeeklyReview,
  SOURCE_LABELS,
} from "@shared/traction-types";

/**
 * Traction's presentation rules, as plain functions.
 *
 * The one with teeth is `hermesPrompt`: what AgentOS asks Hermes for depends
 * on what is known. With an ICP, an offer, the prospect's website and one
 * specific observation, it asks for a draft. Without them it asks for research
 * — never for a message, because a message with nothing specific in it is the
 * generic spam that burns the brand.
 */

export type TractionTab = "overview" | "prospects" | "pipeline" | "waiting" | "clients" | "offers" | "experiments" | "review";

export const TRACTION_TABS: readonly { value: TractionTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "prospects", label: "Prospects" },
  { value: "pipeline", label: "Pipeline" },
  { value: "waiting", label: "Waiting on" },
  { value: "clients", label: "Clients & referrals" },
  { value: "offers", label: "Offers" },
  { value: "experiments", label: "Experiments" },
  { value: "review", label: "Weekly review" },
];

export function isTractionTab(value: string | null): value is TractionTab {
  return TRACTION_TABS.some((tab) => tab.value === value);
}

/** The stages a prospect moves through, in order. `lost` sits apart. */
export const PIPELINE_STAGES: readonly ProspectStage[] = ["target", "contacted", "conversation", "proposal", "won"];

export function stageLabel(stage: ProspectStage): string {
  return STAGE_LABELS[stage];
}

export function gapLabels(gaps: readonly OutreachGap[]): string[] {
  return gaps.map((gap) => OUTREACH_GAP_LABELS[gap]);
}

export function prospectHref(prospectId: string): string {
  return `/traction?tab=prospects&prospect=${encodeURIComponent(prospectId)}`;
}

/** Where a queue item opens: its prospect, or the Waiting On list. */
export function queueItemHref(item: QueueItem): string {
  return item.prospectId ? prospectHref(item.prospectId) : "/traction?tab=waiting";
}

/** Hands a prompt to the agent console, which runs it once on arrival. */
export function hermesHref(prompt: string): string {
  return `/agent?run=${encodeURIComponent(prompt)}`;
}

/** How far through today's queue — done items over done plus open. */
export function queueProgress(data: Pick<TractionData, "queue" | "doneToday">): { done: number; total: number } {
  return { done: data.doneToday, total: data.doneToday + data.queue.length };
}

function lines(entries: (string | false | undefined)[]): string {
  return entries.filter((entry): entry is string => Boolean(entry)).join("\n");
}

function prospectFacts(prospect: Prospect): string {
  return lines([
    `Company: ${prospect.company}`,
    prospect.contact && `Contact: ${prospect.contact}`,
    prospect.website && `Website: ${prospect.website}`,
    prospect.segment && `Segment: ${prospect.segment}`,
    `Stage: ${STAGE_LABELS[prospect.stage]}`,
    prospect.lastTouchAt && `Last contacted: ${prospect.lastTouchAt.slice(0, 10)}`,
    prospect.reasons.length > 0 && `Why this lead:\n${prospect.reasons.map((reason) => `- ${reason}`).join("\n")}`,
    prospect.observation && `Specific observation: ${prospect.observation}`,
    prospect.angle && `Suggested angle: ${prospect.angle}`,
    prospect.notes && `Notes: ${prospect.notes}`,
  ]);
}

function icpFacts(icp: Icp | undefined): string | undefined {
  if (!icp) return undefined;
  return lines([
    `Active ICP: ${icp.name}`,
    `ICP offer: ${icp.offer}`,
    icp.geography && `Geography: ${icp.geography}`,
    icp.idealProspect.length > 0 && `Ideal prospect: ${icp.idealProspect.join("; ")}`,
  ]);
}

function offerFacts(offer: Offer | undefined): string | undefined {
  if (!offer) return undefined;
  return lines([
    `Offer: ${offer.name} — ${offer.offer}`,
    offer.problem && `Problem it solves: ${offer.problem}`,
    offer.startingPrice && `Starting price: ${offer.startingPrice}`,
  ]);
}

/** The rule Hermes is held to on every Traction request. */
export const NO_GENERIC_OUTREACH_RULE =
  'Rules: draft only — never send anything. Every claim must be specific to this company and verifiable from the facts above or their website. If you cannot identify something genuinely specific, reply exactly "NOT ENOUGH CONTEXT FOR PERSONALIZED OUTREACH" and list what is missing. No flattery, no "I came across your amazing company".';

/**
 * What to ask Hermes about a prospect.
 *
 * Research when the specifics are missing; a draft when they are present. The
 * choice is made here, deterministically, rather than left to the model.
 */
export function hermesPrompt({
  prospect,
  item,
  icp,
  offers,
  gaps,
}: {
  prospect: Prospect;
  item?: QueueItem;
  icp: Icp | undefined;
  offers: readonly Offer[];
  gaps: readonly OutreachGap[];
}): { kind: "research" | "draft" | "referral"; prompt: string } {
  const offer = offers.find((entry) => entry.id === prospect.offerId);
  const context = lines([prospectFacts(prospect), icpFacts(icp), offerFacts(offer)]);

  if (item?.kind === "referral") {
    return {
      kind: "referral",
      prompt: lines([
        `Help me prepare a referral ask for an existing client. Draft a short, warm, personal message asking whether they know one or two businesses who would benefit from similar work. Keep it easy to say no to.`,
        "",
        context,
        "",
        NO_GENERIC_OUTREACH_RULE,
      ]),
    };
  }

  const needsResearch = gaps.includes("website") || gaps.includes("observation");

  if (needsResearch) {
    return {
      kind: "research",
      prompt: lines([
        `Research ${prospect.company} as a prospect${prospect.website ? ` (${prospect.website})` : " — find their website first"}.`,
        "Review: website, mobile UX, conversion paths and calls to action, SEO basics, performance, content.",
        "Give me exactly 3 concrete, verifiable opportunities I could mention in outreach — each one sentence, each something I could check myself. Not a report.",
        "",
        context,
        "",
        NO_GENERIC_OUTREACH_RULE,
      ]),
    };
  }

  const followUp = item?.kind === "follow_up" || (prospect.stage !== "target" && item?.kind !== "contact");

  return {
    kind: "draft",
    prompt: lines([
      followUp
        ? `Draft a short, specific follow-up to ${prospect.contact ?? prospect.company}. Reference the earlier contact and add one new piece of value; do not just "check in".`
        : `Draft a short, personalised first outreach message to ${prospect.contact ?? prospect.company}. Lead with the specific observation, connect it to the offer, and end with one low-friction question.`,
      "Under 120 words. Plain text. I will review and send it myself.",
      "",
      context,
      "",
      NO_GENERIC_OUTREACH_RULE,
    ]),
  };
}

/** Splits a textarea into a list: one entry per non-empty line. */
export function toList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/** A trimmed value, or undefined for an empty field. */
export function optional(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A trimmed value, or null — the prospect patch's way of clearing a field. */
export function nullable(text: string): string | null {
  return optional(text) ?? null;
}

/** The suggested starting ICP from the Step 60 brief: one vertical, one city. */
export const SUGGESTED_ICP = {
  name: "Real estate agencies",
  offer: "High-performing website + ongoing content / SEO / lead generation",
  geography: "Johannesburg initially",
  idealProspect: ["5–50 agents", "Existing website", "Visible digital activity", "Weak conversion experience"],
};

export function formatShortDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A short, specific chase for something owed. Drafted, never sent. */
export function waitingPrompt(item: WaitingOn, today: string, prospect?: Prospect): string {
  return lines([
    `Draft a short, polite chase to ${item.who} about: ${item.what}.`,
    `We have been waiting since ${item.since}${item.since < today ? "" : " (today)"}. Keep it warm, specific and easy to answer in one line. Under 80 words.`,
    prospect && `Context:\n${prospectFacts(prospect)}`,
    "",
    "Rules: draft only — never send anything. No guilt-tripping, no generic filler.",
  ]);
}

/** A share as a whole percentage, or an em dash when nobody can say. */
export function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * The numbers, handed to Hermes to read. It interprets; it does not count.
 */
export function reviewPrompt(review: WeeklyReview, targets: TractionData["targets"]): string {
  const week = review.week;
  return lines([
    `Here is my traction review for the week of ${week.weekOf}. The numbers are counted, not estimated — interpret them, do not recalculate them.`,
    "",
    `New prospects: ${week.newProspects} (target ${targets.newProspects})`,
    `Personal outreach: ${week.outreach} (target ${targets.outreach})`,
    `Follow-ups: ${week.followUps} (target ${targets.followUps})`,
    `Conversations started: ${week.conversations} (target ${targets.conversations})`,
    `Proposals: ${week.proposals} (target ${targets.proposals})`,
    `Won: ${week.won} · Lost: ${week.lost} · Referrals asked: ${week.referralsAsked}`,
    "",
    review.sources.length > 0 &&
      `Leads by source, last four weeks:\n${review.sources
        .map((source) => `- ${SOURCE_LABELS[source.source]}: ${source.leads} leads → ${source.conversations} conversations → ${source.proposals} proposals`)
        .join("\n")}`,
    review.experiments.length > 0 &&
      `Experiments:\n${review.experiments
        .map((experiment) => `- ${experiment.name}: ${experiment.contacted} contacted, conversation rate ${percent(experiment.conversationRate)}, proposal rate ${percent(experiment.proposalRate)}`)
        .join("\n")}`,
    "",
    "Give me: what worked, what didn't, and at most three concrete changes for next week — for each experiment, continue, change or stop. Be blunt. Small samples are small; say so rather than over-reading them.",
  ]);
}
