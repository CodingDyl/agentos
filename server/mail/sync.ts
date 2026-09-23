import type { MailSyncResult } from "../../shared/mail-types";
import { getThreadSummary, listInboxThreadIds, type GmailThreadSummary } from "./gmail-client";
import { classifyThread, type ClassificationResult, type ClassifyThreadInput } from "./jev-client";
import {
  existingThreadIds,
  insertThreadIfNew,
  listUnclassifiedThreadIds,
  readThreadSummary,
  storeClassification,
} from "./store";

/**
 * The three calls a sync needs, injected so tests can exercise the real
 * store against fake Gmail/Jev instead of mocking module internals.
 */
export interface MailSyncDeps {
  listInboxThreadIds: () => Promise<string[]>;
  getThreadSummary: (threadId: string) => Promise<GmailThreadSummary>;
  classifyThread: (input: ClassifyThreadInput) => Promise<ClassificationResult>;
}

const defaultDeps: MailSyncDeps = { listInboxThreadIds, getThreadSummary, classifyThread };

/**
 * Fetches new INBOX threads and classifies anything not yet classified.
 *
 * Two passes, deliberately: diffing against what is already stored costs one
 * Gmail list call, but classifying costs a Jev call per thread — so only
 * threads that are genuinely new or previously failed ever reach Jev. One
 * failed classification never aborts the sync; it is counted and left for
 * the next Refresh to retry.
 */
export async function runMailSync(deps: MailSyncDeps = defaultDeps): Promise<MailSyncResult> {
  const remoteIds = await deps.listInboxThreadIds();
  const known = existingThreadIds();
  const newIds = remoteIds.filter((id) => !known.has(id));

  for (const threadId of newIds) {
    const summary = await deps.getThreadSummary(threadId);
    insertThreadIfNew(summary);
  }

  const pending = listUnclassifiedThreadIds();
  let classified = 0;
  let failed = 0;

  for (const threadId of pending) {
    const summary = readThreadSummary(threadId);
    if (!summary) continue;

    try {
      const result = await deps.classifyThread({
        from: summary.fromEmail ?? summary.fromName ?? "unknown",
        subject: summary.subject,
        snippet: summary.snippet,
        date: summary.messageDate,
      });
      storeClassification(threadId, result);
      classified += 1;
    } catch {
      failed += 1;
    }
  }

  return { added: newIds.length, classified, failed };
}
