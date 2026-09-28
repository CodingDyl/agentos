import type { MailBulkAction, MailBulkResult } from "../../shared/mail-types";
import { canModifyGmail, GmailAuthError } from "./gmail-auth";
import { archiveThread, setThreadRead, trashThread } from "./gmail-client";
import { removeThread, setUnread, visibleThreadIds } from "./store";
import { startProgress } from "./progress";
import { profileThread } from "./sync";

/**
 * Mail's write actions. Gmail stays the source of truth: each change is made
 * in Gmail first and mirrored into `mail.db` only once Gmail accepts it, so
 * the Inbox never shows a thread as read or deleted when Gmail disagrees.
 */

export interface MailActionDeps {
  canModify: () => Promise<boolean>;
  setThreadRead: (threadId: string, read: boolean) => Promise<void>;
  trashThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  profileThread: (threadId: string) => Promise<void>;
}

const defaultDeps: MailActionDeps = {
  canModify: canModifyGmail,
  setThreadRead,
  trashThread,
  archiveThread,
  profileThread: (threadId) => profileThread(threadId),
};

/** Gmail and Jev both tolerate a few calls at once; 150 in a row would be slow. */
const CONCURRENCY = 4;

async function forEachLimited(
  ids: readonly string[],
  run: (id: string) => Promise<void>,
  onEach?: (ok: boolean) => void,
): Promise<MailBulkResult> {
  let succeeded = 0;
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next];
      next += 1;
      try {
        await run(id);
        succeeded += 1;
        onEach?.(true);
      } catch (error) {
        console.error(`[agentos] mail action failed for thread ${id}:`, error);
        failed += 1;
        onEach?.(false);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return { succeeded, failed };
}

async function requireModify(deps: MailActionDeps): Promise<void> {
  if (!(await deps.canModify())) {
    throw new GmailAuthError(
      "Gmail is connected read-only. Reconnect Gmail to allow marking read and moving to Trash.",
      "unauthorized",
    );
  }
}

export async function markThreadsRead(
  threadIds: readonly string[],
  read: boolean,
  deps: MailActionDeps = defaultDeps,
): Promise<MailBulkResult> {
  await requireModify(deps);
  return forEachLimited(visibleThreadIds(threadIds), async (threadId) => {
    await deps.setThreadRead(threadId, read);
    setUnread([threadId], !read);
  });
}

/** Moves threads to Gmail's Trash (recoverable for 30 days) and drops them from the Inbox. */
export async function trashThreads(
  threadIds: readonly string[],
  deps: MailActionDeps = defaultDeps,
): Promise<MailBulkResult> {
  await requireModify(deps);
  return forEachLimited(visibleThreadIds(threadIds), async (threadId) => {
    await deps.trashThread(threadId);
    removeThread(threadId);
  });
}

/** "Done": archives in Gmail (out of the inbox, kept in All Mail) and drops the thread from AgentOS. */
export async function archiveThreads(
  threadIds: readonly string[],
  deps: MailActionDeps = defaultDeps,
): Promise<MailBulkResult> {
  await requireModify(deps);
  return forEachLimited(visibleThreadIds(threadIds), async (threadId) => {
    await deps.archiveThread(threadId);
    removeThread(threadId);
  });
}

/** Asks Jev again, with the person's latest corrections as examples. A thread they corrected keeps their answer on screen. */
export async function reprofileThreads(
  threadIds: readonly string[],
  deps: MailActionDeps = defaultDeps,
): Promise<MailBulkResult> {
  const ids = visibleThreadIds(threadIds);
  const progress = startProgress("reprofile");
  progress.phase("profiling", ids.length);
  try {
    return await forEachLimited(ids, deps.profileThread, progress.advance);
  } finally {
    progress.finish();
  }
}

export function runBulkAction(
  action: MailBulkAction,
  threadIds: readonly string[],
  deps: MailActionDeps = defaultDeps,
): Promise<MailBulkResult> {
  switch (action) {
    case "mark_read":
      return markThreadsRead(threadIds, true, deps);
    case "archive":
      return archiveThreads(threadIds, deps);
    case "trash":
      return trashThreads(threadIds, deps);
    case "reprofile":
      return reprofileThreads(threadIds, deps);
  }
}
