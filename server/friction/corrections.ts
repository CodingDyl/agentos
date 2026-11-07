import { isSafeTestPath, type FrictionItem } from "../../shared/friction-types";
import type { WorkerJob } from "../../shared/worker-types";
import { recordCorrectionOnce } from "./store";

/**
 * Corrections: when the owner says an agent got something wrong, that becomes
 * a friction item that cannot be called fixed until a test exists that fails on
 * the wrong behaviour.
 *
 * Only the owner's own decisions record one (reject, send back for changes,
 * send visual findings back). The automatic review loop's send-backs are not
 * the owner correcting anything.
 */

type CorrectionSourceType = "job-rejected" | "job-revision" | "visual-revision";

const TEST_FILE = /(^|\/)__tests__\/|\.test\.|\.spec\./;

/** First line of the objective, cut short: what a person would call the job. */
function jobTitle(objective: string): string {
  const line = objective.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 99).trimEnd()}…` : line;
}

const LEAD: Record<CorrectionSourceType, string> = {
  "job-rejected": "An agent's work was rejected",
  "job-revision": "An agent's work was sent back for changes",
  "visual-revision": "An agent's screens were sent back for fixes",
};

export async function recordJobCorrection(
  job: WorkerJob,
  type: CorrectionSourceType,
  note?: string,
): Promise<FrictionItem | undefined> {
  const reason = note?.trim().slice(0, 1000) || undefined;
  const title = jobTitle(job.objective);
  return recordCorrectionOnce({
    id: `fr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    description: `${LEAD[type]}: ${title}`.slice(0, 1000),
    frequency: "once",
    severity: "medium",
    status: "open",
    createdAt: new Date().toISOString(),
    kind: "correction",
    expected: reason,
    source: { type, jobId: job.id, attempt: job.revision ?? 1, project: job.project },
    regression: { status: "needed" },
  });
}

/**
 * Records a correction after the owner's decision has already succeeded. A
 * failure here is logged and swallowed: it must never fail the decision itself.
 */
export async function captureJobCorrection(job: WorkerJob | undefined, type: CorrectionSourceType, note?: unknown): Promise<void> {
  if (!job) return;
  try {
    await recordJobCorrection(job, type, typeof note === "string" ? note : undefined);
  } catch (error) {
    console.error("[friction] could not record a correction:", error);
  }
}

const FAILED = new Set(["failed", "rejected", "cancelled"]);

/**
 * Checks corrections that have a test-writing job against what the job did.
 *
 * A landed job that changed a test file means the regression is covered, at
 * that path. A job that failed, or landed without changing any test, puts the
 * regression back to needed and says why: a "fix" with no test is not one.
 */
export async function reconcileRegressions(
  items: readonly FrictionItem[],
  readJob: (id: string) => Promise<WorkerJob | undefined>,
): Promise<FrictionItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const regression = item.regression;
      if (item.kind !== "correction" || regression?.status !== "in-progress" || !regression.jobId) return item;

      const job = await readJob(regression.jobId).catch(() => undefined);
      if (!job) return { ...item, regression: { status: "needed" as const, reason: "The test-writing job could not be found." } };

      if (FAILED.has(job.status)) {
        return { ...item, regression: { status: "needed" as const, reason: `The test-writing job ${job.status}, so there is still no test.` } };
      }
      if (job.status !== "completed") return item;

      const testPath = (job.result?.changedFiles ?? []).find((file) => TEST_FILE.test(file) && isSafeTestPath(file));
      if (testPath) return { ...item, regression: { status: "covered" as const, testPath, jobId: job.id } };
      return { ...item, regression: { status: "needed" as const, reason: "The job finished but changed no test, so there is still no test." } };
    }),
  );
}
