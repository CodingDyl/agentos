import type {
  ActivityEvent,
  Automation,
  AutomationHealth,
  ProjectSummary,
} from "../../shared/agentos-types";
import type {
  MissionAutomation,
  MissionControlData,
  MissionWorker,
  SystemStatus,
} from "../../shared/mission-control-types";
import type { WorkerJob } from "../../shared/worker-types";
import { getActivity } from "../activity";
import { getDashboardData } from "../agentos/dashboard";
import { getMilestoneSummary } from "../agentos/roadmap";
import { getAutomations } from "../hermes/automations";
import { isRunning } from "../workers/job-manager";
import { listJobs } from "../workers/job-store";
import { describeWorkers } from "../workers/registry";
import { buildActiveWork } from "./active-work";
import { buildAttention } from "./attention";
import { applyDismissals } from "./dismissals";
import { buildSystemHealth } from "./health";

/**
 * Assembling Mission Control from the systems that already exist.
 *
 * Two rules shape this module.
 *
 * **It owns nothing.** Every field is read from a system that already holds it
 * — the vault for focus, the job store for work, Hermes for schedules, the
 * activity log for history. Nothing is written, no parser is reimplemented, and
 * no state lives here. If Mission Control were deleted tomorrow, nothing else
 * would notice.
 *
 * **One source failing is not the page failing.** Five systems are read and any
 * of them can be down. Each is settled independently, a failure degrades its
 * own section, and `sources` says which. An unreachable Hermes must never cost
 * the operator their worker queue — that is exactly the morning when they most
 * need to see it.
 */

/** Enough history to see the shape of the morning, not enough to be a feed. */
const ACTIVITY_LIMIT = 8;

/** Enough jobs to cover everything unfinished, without reading the archive. */
const JOB_LIMIT = 60;

/** Job states that no longer belong to anybody's attention. */
const SETTLED = new Set(["completed", "rejected", "cancelled"]);

interface Settled<T> {
  value?: T;
  error?: string;
}

/**
 * Runs one read and captures its failure instead of propagating it.
 *
 * Every source goes through this. A thrown error anywhere in the aggregation
 * would take the whole screen down, which is the failure mode this design
 * exists to avoid.
 */
async function settle<T>(read: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { value: await read() };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "That source could not be read.",
    };
  }
}

function statusOf<T>(source: Settled<T>): SystemStatus {
  return source.error ? "unknown" : "ready";
}

/** `2 jobs`, or nothing when a worker is idle. */
function jobCountLabel(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1 ? "1 job" : `${count} jobs`;
}

function toMissionWorkers(
  workers: Awaited<ReturnType<typeof describeWorkers>>,
  jobsByWorker: Map<string, number>,
): MissionWorker[] {
  return workers.map((worker) => {
    const active = jobsByWorker.get(worker.id) ?? 0;

    return {
      id: worker.id,
      name: worker.name,
      status: !worker.available
        ? ("offline" as const)
        : active > 0
          ? ("running" as const)
          : ("ready" as const),
      detail: worker.available
        ? jobCountLabel(active)
        : worker.unavailableReason,
      href: "/workers",
    };
  });
}

/**
 * An automation's state, in the shared vocabulary.
 *
 * A job you turned off reads as `ready` rather than as a problem: it is doing
 * exactly what it was told to. Only work that is meant to be happening and is
 * not gets to be loud.
 */
function automationStatus(automation: Automation): SystemStatus {
  if (automation.state === "disabled" || automation.state === "completed") {
    return "ready";
  }

  if (automation.lastRun?.status === "failed") return "failed";
  if ((automation.warnings ?? []).length > 0) return "attention";
  if (automation.lastRun?.status === "running") return "running";

  return "ready";
}

function toMissionAutomations(
  automations: readonly Automation[],
): MissionAutomation[] {
  return automations.map((automation) => ({
    id: automation.id,
    name: automation.name,
    status: automationStatus(automation),
    nextRun: automation.nextRun,
    // Only a problem. A healthy schedule says when it next runs, and that is
    // the browser's sentence to write, not the adapter's.
    detail:
      automation.lastRun?.status === "failed" ? "Last run failed" : undefined,
    href: "/automations",
  }));
}

/**
 * Everything Mission Control shows, read once.
 *
 * Sources are read in parallel and settled independently. The order things are
 * assembled in afterwards is deliberate: attention is computed from whatever
 * actually arrived, so a screen missing its automations still ranks its jobs
 * correctly rather than refusing to rank anything.
 */
export async function getMissionControlData(): Promise<MissionControlData> {
  const [dashboard, jobs, workers, automations, activity] = await Promise.all([
    settle(() => getDashboardData()),
    settle(() => listJobs(JOB_LIMIT)),
    settle(() => describeWorkers()),
    settle(() => getAutomations()),
    settle(() => getActivity({ limit: ACTIVITY_LIMIT })),
  ]);

  const allJobs: WorkerJob[] = jobs.value ?? [];
  const projects: ProjectSummary[] = dashboard.value?.projects ?? [];
  const events: ActivityEvent[] = activity.value?.events ?? [];

  const automationList: Automation[] = automations.value?.automations ?? [];
  const automationHealth: AutomationHealth | undefined =
    automations.value?.health;

  // Only jobs that are still somebody's problem. A completed job is history,
  // and history is what the activity timeline is for.
  const openJobs = allJobs.filter((job) => !SETTLED.has(job.status));

  const jobsByWorker = new Map<string, number>();

  for (const job of openJobs) {
    const worker = job.resolvedWorker ?? job.worker;
    if (worker === "auto") continue;

    // Only work actually executing counts towards a worker looking busy: a job
    // parked for review is the operator's, not the worker's.
    if (!isRunning(job.id)) continue;

    jobsByWorker.set(worker, (jobsByWorker.get(worker) ?? 0) + 1);
  }

  // Named for a person to read, because these become attention items saying
  // which part of the screen they should not trust today.
  const degraded = [
    dashboard.error ? { label: "Projects", detail: dashboard.error } : undefined,
    jobs.error ? { label: "Worker jobs", detail: jobs.error } : undefined,
    automations.error
      ? { label: "Automations", detail: automations.error }
      : undefined,
    activity.error ? { label: "Activity", detail: activity.error } : undefined,
  ].filter((entry): entry is { label: string; detail: string } => Boolean(entry));

  const system = await buildSystemHealth({
    workers: workers.value ?? [],
    jobsByWorker,
    automationHealth,
  }).catch(() => []);

  const hermesRow = system.find((component) => component.id === "hermes");

  // Where the focus project is going, so the block can say "Chef Experience,
  // 68%, 13 days" rather than only a name. Deterministic, from the roadmap.
  const roadmap = dashboard.value?.focusProjectSlug
    ? await getMilestoneSummary(dashboard.value.focusProjectSlug).catch(() => undefined)
    : undefined;

  return {
    generatedAt: new Date().toISOString(),
    focus: dashboard.value
      ? {
          project: dashboard.value.mainFocus.project,
          // Resolved by the dashboard, which already walks the focus file in
          // priority order and falls through infrastructure to the product
          // project underneath it. Re-deriving it here would risk a different
          // answer from the one the focus block is describing.
          projectSlug: dashboard.value.focusProjectSlug,
          outcome: dashboard.value.mainFocus.outcome,
          nextAction: dashboard.value.nextAction,
          watch: dashboard.value.watch,
          inboxCount: dashboard.value.inboxCount,
          ...(roadmap
            ? {
                milestone: roadmap.milestone,
                health: roadmap.health,
                nextReady: roadmap.nextReady
                  ? { id: roadmap.nextReady.id, title: roadmap.nextReady.title }
                  : undefined,
              }
            : {}),
        }
      : undefined,
    ...(await applyDismissals(
      buildAttention({
        jobs: openJobs,
        automations: automationList,
        projects,
        degraded,
      }),
    )),
    activeWork: buildActiveWork(openJobs, events),
    workers: toMissionWorkers(workers.value ?? [], jobsByWorker),
    automations: toMissionAutomations(automationList),
    recentActivity: events,
    system,
    projects,
    sources: {
      vault: statusOf(dashboard),
      workers: statusOf(workers),
      automations: statusOf(automations),
      activity: statusOf(activity),
      // Reachability, not merely whether the read succeeded — the probe is the
      // only thing here that actually talked to Hermes.
      hermes: hermesRow?.status ?? "unknown",
    },
  };
}
