import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AutomationHealth } from "../../shared/agentos-types";
import type {
  SystemComponent,
  SystemStatus,
} from "../../shared/mission-control-types";
import type { WorkerSummary } from "../../shared/worker-types";
import { agentOSRoot, listDirectory } from "../agentos/filesystem";
import { getHermesStatus, hermesFetch } from "../hermes/client";

/**
 * Whether the parts of the system are actually working.
 *
 * A healthy Mission Control should be quiet: every row says `READY` and
 * explains nothing. Detail appears only when something is wrong, because a
 * panel that always has something to say trains an operator to stop reading it.
 *
 * Everything here fails to `unknown` or `offline` rather than to `ready`. A
 * check that could not be run has not passed.
 */

const run = promisify(execFile);

/**
 * How long a probe's answer is reused.
 *
 * Mission Control polls every ten seconds. Shelling out to `git` and opening a
 * socket to Hermes on every one of those would make an operations screen a load
 * source, so the two external probes are memoised — long enough to be cheap,
 * short enough that an outage surfaces while the operator is still looking.
 */
const PROBE_TTL_MS = 30_000;

/** Long enough for a local service, short enough not to hold up the page. */
const PROBE_TIMEOUT_MS = 3_000;

interface CachedProbe<T> {
  value: T;
  at: number;
}

function fresh<T>(cache: CachedProbe<T> | undefined, now: number): T | undefined {
  return cache && now - cache.at < PROBE_TTL_MS ? cache.value : undefined;
}

interface Probe {
  status: SystemStatus;
  detail?: string;
}

let hermesProbe: CachedProbe<Probe> | undefined;
let gitProbe: CachedProbe<Probe> | undefined;

/**
 * Whether Hermes is actually answering.
 *
 * Any HTTP reply counts, including a 404: what is being established is that
 * something is listening and speaking HTTP at that address, not that a
 * particular endpoint exists. Being configured is checked first, because "no
 * API key" and "the service is down" are different problems with different
 * fixes and only one of them is an outage.
 */
export async function probeHermes(now = Date.now()): Promise<Probe> {
  const cached = fresh(hermesProbe, now);
  if (cached) return cached;

  const status = getHermesStatus();

  const result: Probe = !status.configured
    ? {
        status: "offline",
        detail: "HERMES_API_KEY is not set, so Hermes cannot be reached.",
      }
    : await hermesFetch("/models", {
        method: "GET",
        timeoutMs: PROBE_TIMEOUT_MS,
      }).then(
        () => ({ status: "ready" as const }),
        (error: unknown) => ({
          status: "offline" as const,
          detail:
            error instanceof Error
              ? error.message
              : "Hermes did not answer.",
        }),
      );

  hermesProbe = { value: result, at: now };
  return result;
}

/**
 * Whether git is usable.
 *
 * Worth a row of its own because it is load-bearing rather than incidental: no
 * git means no isolated worktree, which means no coding job can be delegated at
 * all. That is better learned here than from a job failing to start.
 */
export async function probeGit(now = Date.now()): Promise<Probe> {
  const cached = fresh(gitProbe, now);
  if (cached) return cached;

  const result: Probe = await run("git", ["--version"], {
    timeout: PROBE_TIMEOUT_MS,
  }).then(
    () => ({ status: "ready" as const }),
    () => ({
      status: "offline" as const,
      detail: "git is not on the PATH, so no work can be isolated.",
    }),
  );

  gitProbe = { value: result, at: now };
  return result;
}

/** Whether the vault is there and readable. */
export async function probeVault(): Promise<Probe> {
  try {
    await listDirectory("");
    return { status: "ready" };
  } catch {
    return {
      status: "offline",
      detail: `${agentOSRoot()} could not be read. Set AGENTOS_ROOT if the vault lives elsewhere.`,
    };
  }
}

/** A worker's own account of itself, in the shared vocabulary. */
export function workerStatus(
  worker: WorkerSummary,
  activeJobs: number,
): SystemStatus {
  if (!worker.available) return "offline";
  return activeJobs > 0 ? "running" : "ready";
}

/**
 * Cron's health, as `cron doctor` reported it.
 *
 * `unknown` when it could not be asked — never `ready`, because a scheduler
 * nobody could reach is not a scheduler known to be fine.
 */
export function cronStatus(health: AutomationHealth | undefined): Probe {
  if (!health) {
    return {
      status: "unknown",
      detail: "Hermes' cron could not be reached, so its health is unknown.",
    };
  }

  if (health.issues.length > 0) {
    return { status: "attention", detail: health.issues.join(" ") };
  }

  return { status: "ready" };
}

export interface HealthInput {
  workers: readonly WorkerSummary[];
  /** Active job counts by worker id, so a busy worker reads as running. */
  jobsByWorker: Map<string, number>;
  automationHealth?: AutomationHealth;
}

/**
 * Every system row, in the order they are read.
 *
 * Infrastructure first, then the things that run on it. An operator scanning
 * this wants to know whether the floor is solid before they care which worker
 * is free.
 */
export async function buildSystemHealth(
  input: HealthInput,
): Promise<SystemComponent[]> {
  const [hermes, vault, git] = await Promise.all([
    probeHermes(),
    probeVault(),
    probeGit(),
  ]);

  const cron = cronStatus(input.automationHealth);

  return [
    { id: "hermes", label: "Hermes API", ...hermes },
    { id: "vault", label: "AgentOS filesystem", ...vault },
    { id: "git", label: "Git", ...git },
    ...input.workers.map((worker) => ({
      id: `worker-${worker.id}`,
      label: worker.name,
      status: workerStatus(worker, input.jobsByWorker.get(worker.id) ?? 0),
      // Only when it cannot be used. A healthy row explains nothing.
      detail: worker.available ? undefined : worker.unavailableReason,
    })),
    { id: "cron", label: "Cron", ...cron },
  ];
}
