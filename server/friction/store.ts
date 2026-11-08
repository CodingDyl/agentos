import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  FrictionItemSchema,
  isSafeTestPath,
  type FrictionItem,
  type FrictionStatus,
  type Regression,
  type ReportFrictionRequest,
  type SetRegressionRequest,
} from "../../shared/friction-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The friction inbox, as one small JSON file in AgentOS's UI state.
 *
 * Outside the vault: these are notes about the tool, not about the work.
 * Written atomically and serialised, so two quick reports cannot lose one
 * another; an unreadable item is skipped rather than failing the list.
 */

const MAX_ITEMS = 500;

export function frictionFile(): string {
  return path.join(uiStateDir(), "friction.json");
}

export async function readFriction(): Promise<FrictionItem[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(frictionFile(), "utf8"));
    const items = Array.isArray((parsed as { items?: unknown })?.items) ? (parsed as { items: unknown[] }).items : [];
    return items.flatMap((item) => {
      const result = FrictionItemSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

async function writeFriction(items: FrictionItem[]): Promise<void> {
  const file = frictionFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Only an in-app path is kept: never a full URL that could carry a token. */
function cleanRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const trimmed = route.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  return trimmed.split("#")[0].slice(0, 300);
}

/** Active statuses that should not be pruned. */
const ACTIVE_STATUSES: ReadonlyArray<FrictionStatus> = ["open", "assigned", "in-progress", "needs-review"];

/** Past the cap the oldest closed item goes first; active ones are kept longest. */
function withCap(items: FrictionItem[]): FrictionItem[] {
  const next = [...items];
  while (next.length > MAX_ITEMS) {
    const closed = next.findLastIndex((entry) => !ACTIVE_STATUSES.includes(entry.status));
    next.splice(closed >= 0 ? closed : next.length - 1, 1);
  }
  return next;
}

function newId(): string {
  return `fr-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

export function reportFriction(input: ReportFrictionRequest): Promise<FrictionItem> {
  return serial(async () => {
    const correction = input.kind === "correction";
    if (correction && (input.expected?.trim().length ?? 0) < 3) throw new Error("A correction needs to say what should have happened.");
    const item: FrictionItem = {
      id: newId(),
      description: input.description.trim(),
      route: cleanRoute(input.route),
      frequency: input.frequency,
      severity: input.severity,
      status: "open",
      createdAt: new Date().toISOString(),
      kind: correction ? "correction" : "friction",
      expected: correction ? input.expected?.trim() : undefined,
      source: correction ? (input.source ?? { type: "manual" }) : undefined,
      regression: correction ? { status: "needed" } : undefined,
      project: "agentos",
      repairJobs: [],
    };
    await writeFriction(withCap([item, ...(await readFriction())]));
    return item;
  });
}

/**
 * Records a correction from an owner decision on a job, once per job, source
 * and attempt: pressing the same button twice must not file it twice.
 */
export function recordCorrectionOnce(item: FrictionItem): Promise<FrictionItem> {
  return serial(async () => {
    const items = await readFriction();
    const same = items.find(
      (entry) =>
        entry.kind === "correction" &&
        entry.source?.jobId !== undefined &&
        entry.source.jobId === item.source?.jobId &&
        entry.source.type === item.source?.type &&
        entry.source.attempt === item.source?.attempt,
    );
    if (same) return same;
    await writeFriction(withCap([item, ...items]));
    return item;
  });
}

/** Why a correction can't be closed yet. Plain friction can always be closed. */
export class RegressionRequiredError extends Error {
  constructor() {
    super("This is a correction, so it needs a regression test first. Write the test, mark it covered, or mark it can't be tested with a reason.");
    this.name = "RegressionRequiredError";
  }
}

const SETTLED: ReadonlyArray<Regression["status"]> = ["covered", "not-testable"];

export interface UpdateFrictionOptions {
  status?: FrictionStatus;
  reproduction?: string;
  project?: string;
  failureReason?: string;
}

export function updateFriction(id: string, options: UpdateFrictionOptions): Promise<FrictionItem | undefined> {
  return serial(async () => {
    const items = await readFriction();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const current = items[index];
    
    if (options.status === "fixed" && current.kind === "correction" && !SETTLED.includes(current.regression?.status ?? "needed")) {
      throw new RegressionRequiredError();
    }
    
    const updated = {
      ...current,
      ...(options.status !== undefined && { status: options.status }),
      ...(options.reproduction !== undefined && { reproduction: options.reproduction }),
      ...(options.project !== undefined && { project: options.project }),
      ...(options.failureReason !== undefined && { failureReason: options.failureReason }),
      updatedAt: new Date().toISOString(),
    };
    items[index] = updated;
    await writeFriction(items);
    return updated;
  });
}

export function updateFrictionStatus(id: string, status: FrictionStatus): Promise<FrictionItem | undefined> {
  return updateFriction(id, { status });
}

function changeRegression(id: string, change: (item: FrictionItem) => Regression): Promise<FrictionItem | undefined> {
  return serial(async () => {
    const items = await readFriction();
    const index = items.findIndex((item) => item.id === id && item.kind === "correction");
    if (index < 0) return undefined;
    const updated = { ...items[index], regression: change(items[index]), updatedAt: new Date().toISOString() };
    items[index] = updated;
    await writeFriction(items);
    return updated;
  });
}

/** The owner says a test covers it, or that it can't be tested and why. */
export function setRegression(id: string, request: SetRegressionRequest): Promise<FrictionItem | undefined> {
  if (request.status === "covered" && !(request.testPath && isSafeTestPath(request.testPath))) {
    return Promise.reject(new Error("A test path must be inside the repository: no .. and not absolute."));
  }
  if (request.status === "not-testable" && !request.reason?.trim()) {
    return Promise.reject(new Error("Say why it can't be tested."));
  }
  return changeRegression(id, () =>
    request.status === "covered"
      ? { status: "covered", testPath: request.testPath?.trim() }
      : { status: "not-testable", reason: request.reason?.trim() },
  );
}

/** A job has been started to write the test. */
export function startRegressionTracking(id: string, jobId: string): Promise<FrictionItem | undefined> {
  return changeRegression(id, () => ({ status: "in-progress", jobId }));
}

/** Saves regression changes found by reconciling against jobs. Nothing else is touched. */
export function saveReconciledRegressions(changed: readonly FrictionItem[]): Promise<void> {
  return serial(async () => {
    if (changed.length === 0) return;
    const byId = new Map(changed.map((item) => [item.id, item]));
    const items = await readFriction();
    let touched = false;
    const next = items.map((item) => {
      const replacement = byId.get(item.id);
      if (!replacement || item.kind !== "correction") return item;
      touched = true;
      return { ...item, regression: replacement.regression };
    });
    if (touched) await writeFriction(next);
  });
}

/** Assigns a repair job to a friction item. */
export function assignRepairJob(id: string, jobId: string, worker?: string): Promise<FrictionItem | undefined> {
  return serial(async () => {
    const items = await readFriction();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    
    const repairJob: import("../../shared/friction-types").RepairJob = {
      jobId,
      worker: worker as import("../../shared/worker-types").WorkerId | undefined,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    
    const updated = {
      ...items[index],
      status: "assigned" as FrictionStatus,
      repairJobs: [...(items[index].repairJobs || []), repairJob],
      updatedAt: new Date().toISOString(),
    };
    items[index] = updated;
    await writeFriction(items);
    return updated;
  });
}

/** Updates a repair job status. */
export function updateRepairJob(
  id: string,
  jobId: string,
  update: {
    status: "running" | "completed" | "failed" | "blocked";
    error?: string;
    commitSha?: string;
    completedAt?: string;
  },
): Promise<FrictionItem | undefined> {
  return serial(async () => {
    const items = await readFriction();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    
    const repairJobs = items[index].repairJobs || [];
    const jobIndex = repairJobs.findIndex((job) => job.jobId === jobId);
    if (jobIndex < 0) return undefined;
    
    const updatedJob = {
      ...repairJobs[jobIndex],
      ...update,
      completedAt: update.completedAt ?? (update.status !== "running" ? new Date().toISOString() : undefined),
    };
    
    const newJobs = [...repairJobs];
    newJobs[jobIndex] = updatedJob;
    
    let newStatus = items[index].status;
    if (update.status === "completed") {
      newStatus = "needs-review";
    } else if (update.status === "failed" || update.status === "blocked") {
      newStatus = "open";
    } else if (update.status === "running" && items[index].status === "assigned") {
      newStatus = "in-progress";
    }
    
    const updated = {
      ...items[index],
      status: newStatus,
      repairJobs: newJobs,
      failureReason: update.error,
      updatedAt: new Date().toISOString(),
    };
    items[index] = updated;
    await writeFriction(items);
    return updated;
  });
}

/** Records verification for a friction item. */
export function verifyFriction(
  id: string,
  verification: import("../../shared/friction-types").Verification,
): Promise<FrictionItem | undefined> {
  return serial(async () => {
    const items = await readFriction();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    
    const updated = {
      ...items[index],
      status: "verified" as FrictionStatus,
      verification,
      updatedAt: new Date().toISOString(),
    };
    items[index] = updated;
    await writeFriction(items);
    return updated;
  });
}

/** Migrates legacy fixed items to the new Fixed status. */
export async function migrateLegacyFixedItems(): Promise<void> {
  const items = await readFriction();
  let changed = false;
  const updated = items.map((item) => {
    if (item.status === "fixed" && !item.verification) {
      changed = true;
      return { ...item };
    }
    return item;
  });
  if (changed) await writeFriction(updated);
}
