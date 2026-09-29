import type { MailThread } from "../../shared/mail-types";
import type { TractionData } from "../../shared/traction-types";
import type { VirtecSnapshot } from "../../shared/virtec-types";
import { readMailData } from "../mail/store";
import { isVirtecConfigured, isVirtecWritable, virtecConfigurationProblem } from "../virtec/client";
import { getVirtecSnapshot } from "../virtec/snapshot";
import type { ProjectSummary } from "../../shared/agentos-types";
import { getProjects } from "../agentos/projects";
import { buildOpportunities, caseStudyQueueItems } from "./case-studies";
import { buildCrmView, crmAttention, crmQueueItems, inboundQueueItems } from "./crm";
import { leadMagnetStats } from "./lead-magnets";
import { crmProvider } from "./crm-provider";
import {
  addDays,
  buildAttention,
  buildExperimentProgress,
  buildPipeline,
  buildQueue,
  buildReview,
  buildWeek,
  chaseDate,
  countDoneToday,
  isoDate,
  linkedThreads,
  outreachGaps,
  suggestMailLinks,
  unansweredReplies,
} from "./engine";
import { readEvents, readState } from "./store";

/**
 * The Inbox's cached threads, read locally — never a Gmail call.
 *
 * Mail is optional: with Gmail never connected there is simply nothing to
 * match, and Traction must not fail because of it.
 */
function cachedThreads(): MailThread[] {
  try {
    const mail = readMailData();
    return [...mail.needsYou, ...mail.fyi, ...mail.lowPriority];
  } catch (error) {
    console.error("[agentos] traction: the mail cache could not be read:", error);
    return [];
  }
}

/** The portfolio, for finished workspaces. A vault that cannot be read costs the opportunities, not the screen. */
async function portfolio(): Promise<ProjectSummary[]> {
  try {
    return await getProjects();
  } catch (error) {
    console.error("[agentos] traction: the portfolio could not be read:", error);
    return [];
  }
}

/**
 * Case-study opportunities as they stand now — also used to start one from
 * the queue, so the queue and the screen agree on what an opportunity is.
 */
export async function currentOpportunities() {
  const [state, virtec, projects] = await Promise.all([readState(), virtecWithin(VIRTEC_BUDGET_MS), portfolio()]);
  return buildOpportunities(virtec, projects, state.caseStudies, state.dismissedOpportunities);
}

/** How long Traction waits for Virtec before answering without it. */
const VIRTEC_BUDGET_MS = 4_000;

/**
 * Virtec's snapshot, if it arrives within the budget.
 *
 * A slow Virtec must not hold the Traction screen hostage: past the budget the
 * screen is answered without it (marked pending), and the read carries on in
 * the background and fills the cache for the next poll.
 */
async function virtecWithin(budgetMs: number): Promise<VirtecSnapshot | undefined> {
  if (!isVirtecConfigured()) return { configured: false, leads: [], inbound: [], clients: [], quotes: [], projects: [], followUps: [] };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
  });

  try {
    return await Promise.race([getVirtecSnapshot(), timeout]);
  } catch (error) {
    console.error("[agentos] traction: Virtec could not be read:", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Everything the Traction screen shows, in one read.
 *
 * One request rather than several for the same reason as Mission Control: the
 * queue, the pipeline and the warnings have to agree with each other, and
 * independently-timed reads would let a done item sit beside a count that has
 * not noticed.
 *
 * Prospects are AgentOS's working set, from the local store. Virtec — money,
 * quotes, projects, its follow-ups and its leads — is read live alongside and
 * never copied, except for a lead or client a person chooses to import.
 */
export async function getTraction(now = new Date()): Promise<TractionData> {
  const today = isoDate(now);
  const provider = crmProvider();
  const [state, events, prospects, virtec, projects] = await Promise.all([
    readState(),
    readEvents(),
    provider.getProspects(),
    virtecWithin(VIRTEC_BUDGET_MS),
    portfolio(),
  ]);
  const opportunities = buildOpportunities(virtec, projects, state.caseStudies, state.dismissedOpportunities);
  const threads = cachedThreads();
  const mailSuggestions = suggestMailLinks(threads, prospects, state.mailLinks, state.dismissedMail);
  // Linking a thread acknowledges it; answering is what clears it. So the
  // queue looks at linked threads too, and only "not theirs" ones are out.
  const replies = unansweredReplies(suggestMailLinks(threads, prospects, [], state.dismissedMail), prospects, today).map((reply) => reply.suggestion);
  const crm = buildCrmView(virtec, prospects, now, virtecConfigurationProblem(), isVirtecWritable());
  const open = state.waiting.filter((item) => !item.resolvedAt).sort((a, b) => chaseDate(a).localeCompare(chaseDate(b)));

  return {
    generatedAt: now.toISOString(),
    today,
    provider: provider.name,
    icp: state.icp,
    offers: state.offers,
    prospects,
    experiments: state.experiments,
    targets: state.targets,
    queue: buildQueue(prospects, state.snoozes, today, open, crmQueueItems(crm.followUps, today), [...inboundQueueItems(crm.inbound, prospects, today, state.leadMagnets, threads), ...caseStudyQueueItems(opportunities)], replies),
    doneToday: countDoneToday(events, today),
    attention: [...crmAttention(virtec), ...buildAttention(prospects, today)],
    pipeline: buildPipeline(prospects),
    week: buildWeek(events, today),
    experimentProgress: buildExperimentProgress(state.experiments, prospects),
    outreachGaps: Object.fromEntries(prospects.map((prospect) => [prospect.id, outreachGaps(prospect, state.icp, state.offers)])),
    waiting: open,
    mailSuggestions,
    replies,
    mailThreads: linkedThreads(state.mailLinks, threads),
    reviews: {
      thisWeek: buildReview(events, prospects, state.experiments, today),
      lastWeek: buildReview(events, prospects, state.experiments, addDays(today, -7)),
    },
    crm,
    caseStudies: [...state.caseStudies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    caseStudyOpportunities: opportunities,
    leadMagnets: [...state.leadMagnets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    leadMagnetStats: leadMagnetStats(state.leadMagnets, virtec?.inbound ?? [], prospects, now),
  };
}
