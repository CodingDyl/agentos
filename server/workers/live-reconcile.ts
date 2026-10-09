import { reconcileAnimateJobs } from "../designs/animate";
import { reconcileMotionJobs } from "../designs/motion";
import { reconcileInterruptedJobs } from "./job-manager";

/**
 * Keeps "what is running" honest after boot.
 *
 * Claude Motion (and the older motion studio) run outside this process. A
 * film that finished, crashed, or whose pid was recycled used to sit in
 * Working On as "may have finished" until the next restart. This sweep
 * settles those first, then interrupts any worker job still recorded as live
 * with nobody executing it.
 */

const SWEEP_MS = 30_000;

let timer: NodeJS.Timeout | undefined;

export async function reconcileDetachedRuns(): Promise<void> {
  await Promise.all([
    reconcileAnimateJobs().catch((error: unknown) => {
      console.error("[agentos] animate reconcile failed:", error);
    }),
    reconcileMotionJobs().catch((error: unknown) => {
      console.error("[agentos] motion reconcile failed:", error);
    }),
  ]);
  const interrupted = await reconcileInterruptedJobs("Nothing is executing this job");
  if (interrupted.length > 0) {
    console.log(
      `[agentos] ${interrupted.length} worker job${interrupted.length === 1 ? "" : "s"} marked interrupted: ${interrupted.map((job) => job.id).join(", ")}`,
    );
  }
}

export function startLiveReconcile(): void {
  if (timer) return;
  timer = setInterval(() => void reconcileDetachedRuns(), SWEEP_MS);
  timer.unref?.();
}
