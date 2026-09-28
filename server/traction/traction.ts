import type { MailThread } from "../../shared/mail-types";
import type { TractionData } from "../../shared/traction-types";
import { readMailData } from "../mail/store";
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

/**
 * Everything the Traction screen shows, in one read.
 *
 * One request rather than several for the same reason as Mission Control: the
 * queue, the pipeline and the warnings have to agree with each other, and
 * independently-timed reads would let a done item sit beside a count that has
 * not noticed.
 *
 * Prospects come through the CRM provider; the ICP, offers, experiments,
 * targets and Waiting On items are AgentOS's own and come from the local store.
 */
export async function getTraction(now = new Date()): Promise<TractionData> {
  const today = isoDate(now);
  const provider = crmProvider();
  const [state, events, prospects] = await Promise.all([readState(), readEvents(), provider.getProspects()]);
  const threads = cachedThreads();
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
    queue: buildQueue(prospects, state.snoozes, today, open),
    doneToday: countDoneToday(events, today),
    attention: buildAttention(prospects, today),
    pipeline: buildPipeline(prospects),
    week: buildWeek(events, today),
    experimentProgress: buildExperimentProgress(state.experiments, prospects),
    outreachGaps: Object.fromEntries(prospects.map((prospect) => [prospect.id, outreachGaps(prospect, state.icp, state.offers)])),
    waiting: open,
    mailSuggestions: suggestMailLinks(threads, prospects, state.mailLinks, state.dismissedMail),
    mailThreads: linkedThreads(state.mailLinks, threads),
    reviews: {
      thisWeek: buildReview(events, prospects, state.experiments, today),
      lastWeek: buildReview(events, prospects, state.experiments, addDays(today, -7)),
    },
  };
}
