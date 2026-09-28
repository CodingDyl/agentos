import { MAIL_THREAD_LIMIT, type MailClassifier, type MailSyncResult } from "../../shared/mail-types";
import {
  getThreadSummary,
  listInboxThreadIds,
  listUnreadInboxThreadIds,
  type GmailThreadSummary,
} from "./gmail-client";
import { startProgress } from "./progress";
import { classifyThread, type ClassificationResult, type ClassifyThreadInput } from "./jev-client";
import {
  existingThreadIds,
  insertThreadIfNew,
  listCorrectionExamples,
  listUnclassifiedThreadIds,
  readThreadSummary,
  storeClassification,
  syncUnreadState,
} from "./store";

/** How many of the person's past corrections travel with each Jev call. */
const CORRECTION_EXAMPLES = 8;

/**
 * The calls a sync needs, injected so tests can exercise the real store
 * against fake Gmail/Jev instead of mocking module internals.
 */
export interface MailSyncDeps {
  listInboxThreadIds: () => Promise<string[]>;
  getThreadSummary: (threadId: string) => Promise<GmailThreadSummary>;
  /** Absent in tests that don't care about read state: it is then left as stored. */
  listUnreadInboxThreadIds?: () => Promise<Set<string>>;
  /** Absent when no classifier is active: threads are stored unsorted. */
  classifyThread?: (input: ClassifyThreadInput) => Promise<ClassificationResult>;
}

const defaultDeps: MailSyncDeps = {
  listInboxThreadIds,
  getThreadSummary,
  listUnreadInboxThreadIds,
  classifyThread,
};

/** Sync with whichever classifier is active — or none, under `manual`. */
export function syncDepsFor(classifier: MailClassifier): MailSyncDeps {
  return classifier === "jev" ? defaultDeps : { ...defaultDeps, classifyThread: undefined };
}

/**
 * Asks Jev about one cached thread and stores the answer, sending the
 * person's most relevant past corrections along as worked examples. Throws
 * on failure and leaves the stored profile untouched.
 */
export async function profileThread(
  threadId: string,
  classify: (input: ClassifyThreadInput) => Promise<ClassificationResult> = classifyThread,
): Promise<void> {
  const summary = readThreadSummary(threadId);
  if (!summary) throw new Error(`Thread ${threadId} is not cached.`);

  // A thread's own correction is not an example for itself.
  const corrections = listCorrectionExamples(summary.fromEmail, CORRECTION_EXAMPLES, threadId).map((example) => ({
      from: example.fromEmail ?? example.fromName ?? "unknown",
      subject: example.subject,
      snippet: example.snippet,
      bucket: example.bucket,
      category: example.category,
    }));

  const result = await classify({
    from: summary.fromEmail ?? summary.fromName ?? "unknown",
    subject: summary.subject,
    snippet: summary.snippet,
    date: summary.messageDate,
    corrections,
  });
  storeClassification(threadId, result);
}

/**
 * Fetches new INBOX threads, mirrors read state, and classifies anything not
 * yet classified.
 *
 * Two passes, deliberately: diffing against what is already stored costs one
 * Gmail list call, but classifying costs a Jev call per thread — so only
 * threads that are genuinely new or previously failed ever reach Jev. One
 * failed classification never aborts the sync; it is counted and left for
 * the next Refresh to retry.
 */
export async function runMailSync(deps: MailSyncDeps = defaultDeps): Promise<MailSyncResult> {
  const progress = startProgress("sync");
  try {
    return await syncWithProgress(deps, progress);
  } finally {
    progress.finish();
  }
}

async function syncWithProgress(
  deps: MailSyncDeps,
  progress: ReturnType<typeof startProgress>,
): Promise<MailSyncResult> {
  // Defensive: whatever the lister returns, only the newest window is fetched.
  const remoteIds = (await deps.listInboxThreadIds()).slice(0, MAIL_THREAD_LIMIT);
  const known = existingThreadIds();
  const newIds = remoteIds.filter((id) => !known.has(id));

  progress.phase("fetching", newIds.length);
  for (const threadId of newIds) {
    const summary = await deps.getThreadSummary(threadId);
    insertThreadIfNew(summary);
    progress.advance(true);
  }

  if (deps.listUnreadInboxThreadIds) {
    syncUnreadState(remoteIds, await deps.listUnreadInboxThreadIds());
  }

  const classify = deps.classifyThread;
  if (!classify) return { added: newIds.length, classified: 0, failed: 0 };

  let classified = 0;
  let failed = 0;

  const pending = listUnclassifiedThreadIds();
  progress.phase("profiling", pending.length);

  for (const threadId of pending) {
    try {
      await profileThread(threadId, classify);
      classified += 1;
      progress.advance(true);
    } catch (error) {
      console.error(`[agentos] Jev classification failed for thread ${threadId}:`, error);
      failed += 1;
      progress.advance(false);
    }
  }

  return { added: newIds.length, classified, failed };
}
