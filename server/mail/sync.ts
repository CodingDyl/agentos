import { MAIL_THREAD_LIMIT, type MailClassifier, type MailSyncResult } from "../../shared/mail-types";
import { MAIL_ACCOUNT_LABEL, type MailAccountId } from "../../shared/mail-account-types";
import { isGmailConfigured, isGmailConnected } from "./gmail-auth";
import {
  getThreadSummary,
  listInboxThreadIds,
  listUnreadInboxThreadIds,
  type GmailThreadSummary,
} from "./gmail-client";
import { startProgress } from "./progress";
import { classifyThread, type ClassificationResult, type ClassifyThreadInput } from "./jev-client";
import { getTitanThreadSummary, listTitanInboxThreadIds, listTitanUnreadThreadIds } from "./titan-client";
import { titanAccount } from "./titan-credentials";
import {
  existingThreadIdsFor,
  insertThreadIfNew,
  listCorrectionExamples,
  listUnclassifiedThreadIds,
  readThreadSummary,
  storeClassification,
  syncUnreadState,
  type ThreadSummaryInput,
} from "./store";

/** How many of the person's past corrections travel with each Jev call. */
const CORRECTION_EXAMPLES = 8;

/** One mailbox a sync reads: Gmail, or the Virtara mailbox over IMAP. */
export interface MailSource {
  account?: MailAccountId;
  listInboxThreadIds: () => Promise<string[]>;
  getThreadSummary: (threadId: string) => Promise<GmailThreadSummary | ThreadSummaryInput>;
  /** Absent in tests that don't care about read state: it is then left as stored. */
  listUnreadInboxThreadIds?: () => Promise<Set<string>>;
}

/**
 * The calls a sync needs, injected so tests can exercise the real store
 * against fake Gmail/Jev instead of mocking module internals. Either one
 * mailbox's calls directly, or `sources` for several.
 */
export interface MailSyncDeps extends Partial<MailSource> {
  sources?: MailSource[];
  /** Absent when no classifier is active: threads are stored unsorted. */
  classifyThread?: (input: ClassifyThreadInput) => Promise<ClassificationResult>;
}

const gmailSource: MailSource = { account: "gmail", listInboxThreadIds, getThreadSummary, listUnreadInboxThreadIds };

const titanSource: MailSource = {
  account: "titan",
  listInboxThreadIds: () => listTitanInboxThreadIds(),
  getThreadSummary: getTitanThreadSummary,
  listUnreadInboxThreadIds: () => listTitanUnreadThreadIds(),
};

/**
 * The linked mailboxes. Gmail is always included when nothing else is
 * linked, so an unconnected Inbox still says "Gmail is not connected"
 * rather than quietly syncing nothing.
 */
export async function linkedMailSources(): Promise<MailSource[]> {
  const titan = (await titanAccount()) !== undefined;
  const gmail = isGmailConfigured() && (await isGmailConnected());
  if (!titan) return [gmailSource];
  return gmail ? [gmailSource, titanSource] : [titanSource];
}

/** Sync with whichever classifier is active — or none, under `manual`. */
export async function syncDepsFor(classifier: MailClassifier): Promise<MailSyncDeps> {
  return { sources: await linkedMailSources(), classifyThread: classifier === "jev" ? classifyThread : undefined };
}

function sourcesOf(deps: MailSyncDeps): MailSource[] {
  if (deps.sources) return deps.sources;
  if (!deps.listInboxThreadIds || !deps.getThreadSummary) return [];
  return [{ account: deps.account ?? "gmail", listInboxThreadIds: deps.listInboxThreadIds, getThreadSummary: deps.getThreadSummary, listUnreadInboxThreadIds: deps.listUnreadInboxThreadIds }];
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
export async function runMailSync(deps: MailSyncDeps = { sources: [gmailSource], classifyThread }): Promise<MailSyncResult> {
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
  // Each mailbox is listed first, so the progress bar knows the whole job.
  // One mailbox failing (a changed Titan password, Gmail offline) still lets
  // the others sync; only when every one fails does the Refresh fail.
  const sources = sourcesOf(deps);
  const warnings: string[] = [];
  const listed: { source: MailSource; remoteIds: string[]; newIds: string[] }[] = [];
  let firstError: unknown;

  for (const source of sources) {
    try {
      // Defensive: whatever the lister returns, only the newest window is fetched.
      const remoteIds = (await source.listInboxThreadIds()).slice(0, MAIL_THREAD_LIMIT);
      const known = existingThreadIdsFor(source.account ?? "gmail");
      listed.push({ source, remoteIds, newIds: remoteIds.filter((id) => !known.has(id)) });
    } catch (error) {
      firstError ??= error;
      warnings.push(`${MAIL_ACCOUNT_LABEL[source.account ?? "gmail"]}: ${error instanceof Error ? error.message : "could not be read"}`);
    }
  }
  if (listed.length === 0 && firstError !== undefined) throw firstError;

  let added = 0;
  progress.phase("fetching", listed.reduce((total, entry) => total + entry.newIds.length, 0));
  for (const { source, remoteIds, newIds } of listed) {
    try {
      for (const threadId of newIds) {
        insertThreadIfNew(await source.getThreadSummary(threadId));
        added += 1;
        progress.advance(true);
      }
      if (source.listUnreadInboxThreadIds) syncUnreadState(remoteIds, await source.listUnreadInboxThreadIds());
    } catch (error) {
      // Gmail failing part-way has always failed the Refresh; a second mailbox only warns.
      if (sources.length === 1) throw error;
      console.error(`[agentos] mail sync of ${source.account ?? "gmail"} stopped part-way:`, error);
      warnings.push(`${MAIL_ACCOUNT_LABEL[source.account ?? "gmail"]}: ${error instanceof Error ? error.message : "stopped part-way"}`);
    }
  }

  const classify = deps.classifyThread;
  if (!classify) return { added, classified: 0, failed: 0, ...(warnings.length > 0 ? { warnings } : {}) };

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

  return { added, classified, failed, ...(warnings.length > 0 ? { warnings } : {}) };
}
