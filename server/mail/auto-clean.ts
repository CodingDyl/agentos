import { LOW_PRIORITY_TTL_HOURS, type MailBulkResult } from "../../shared/mail-types";
import { canModifyGmail } from "./gmail-auth";
import { trashThread } from "./gmail-client";
import { lowPriorityExpiredBefore, refreshLowPriorityClock, removeThread } from "./store";

const HOUR_MS = 60 * 60 * 1000;

export interface AutoCleanDeps {
  canModify: () => Promise<boolean>;
  trashThread: (threadId: string) => Promise<void>;
}

const defaultDeps: AutoCleanDeps = { canModify: canModifyGmail, trashThread };

/**
 * Moves every thread that has sat in Low priority for `LOW_PRIORITY_TTL_HOURS`
 * to Gmail's Trash (recoverable there for 30 days) and drops it from the Inbox.
 *
 * Gmail first, then local — a thread Gmail refuses stays put and is retried
 * next run. Does nothing under a read-only grant: a clean-up that can only
 * hide threads locally would quietly desync AgentOS from Gmail.
 */
export async function cleanExpiredLowPriority(
  now: Date = new Date(),
  deps: AutoCleanDeps = defaultDeps,
): Promise<MailBulkResult> {
  if (!(await deps.canModify())) return { succeeded: 0, failed: 0 };

  refreshLowPriorityClock(now);
  const expired = lowPriorityExpiredBefore(new Date(now.getTime() - LOW_PRIORITY_TTL_HOURS * HOUR_MS));

  let succeeded = 0;
  let failed = 0;
  for (const threadId of expired) {
    try {
      await deps.trashThread(threadId);
      removeThread(threadId);
      succeeded += 1;
    } catch (error) {
      console.error(`[agentos] Low priority clean-up failed for thread ${threadId}:`, error);
      failed += 1;
    }
  }

  if (succeeded > 0 || failed > 0) {
    console.log(`[agentos] Low priority clean-up: ${succeeded} moved to Gmail Trash, ${failed} failed.`);
  }
  return { succeeded, failed };
}

/**
 * Runs the clean-up shortly after start and then hourly, for as long as the
 * server is up. Hourly is plenty against a 24-hour window; a missed hour
 * (laptop asleep) is caught on the next tick. `unref` so it never keeps the
 * process alive on its own.
 */
export function scheduleLowPriorityCleanup(): void {
  const run = () => {
    void cleanExpiredLowPriority().catch((error: unknown) => {
      console.error("[agentos] Low priority clean-up could not run:", error);
    });
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, HOUR_MS).unref();
}
