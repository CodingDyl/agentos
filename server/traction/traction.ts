import type { TractionData } from "../../shared/traction-types";
import { crmProvider } from "./crm-provider";
import {
  buildAttention,
  buildExperimentProgress,
  buildPipeline,
  buildQueue,
  buildWeek,
  countDoneToday,
  isoDate,
  outreachGaps,
} from "./engine";
import { readEvents, readState } from "./store";

/**
 * Everything the Traction screen shows, in one read.
 *
 * One request rather than several for the same reason as Mission Control: the
 * queue, the pipeline and the warnings have to agree with each other, and
 * independently-timed reads would let a done item sit beside a count that has
 * not noticed.
 *
 * Prospects come through the CRM provider; the ICP, offers, experiments and
 * targets are AgentOS's own and always come from the local store.
 */
export async function getTraction(now = new Date()): Promise<TractionData> {
  const today = isoDate(now);
  const provider = crmProvider();
  const [state, events, prospects] = await Promise.all([readState(), readEvents(), provider.getProspects()]);

  return {
    generatedAt: now.toISOString(),
    today,
    provider: provider.name,
    icp: state.icp,
    offers: state.offers,
    prospects,
    experiments: state.experiments,
    targets: state.targets,
    queue: buildQueue(prospects, state.snoozes, today),
    doneToday: countDoneToday(events, today),
    attention: buildAttention(prospects, today),
    pipeline: buildPipeline(prospects),
    week: buildWeek(events, today),
    experimentProgress: buildExperimentProgress(state.experiments, prospects),
    outreachGaps: Object.fromEntries(prospects.map((prospect) => [prospect.id, outreachGaps(prospect, state.icp, state.offers)])),
  };
}
