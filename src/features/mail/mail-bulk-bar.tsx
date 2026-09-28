import { useState } from "react";
import { Archive, MailOpen, RefreshCw, Trash2 } from "lucide-react";
import type { MailBulkAction, MailBulkResult } from "@shared/mail-types";
import { useMailBulkAction } from "@/lib/agentos/queries";

interface MailBulkBarProps {
  /** Every thread in the current filter, across all pages. */
  threadIds: string[];
  unreadIds: string[];
  /** e.g. "Low priority" — named in the confirm step so the scope is never a surprise. */
  scopeLabel: string;
  canModify: boolean;
  canReprofile: boolean;
}

function plural(count: number): string {
  return `${count} thread${count === 1 ? "" : "s"}`;
}

function describe(action: MailBulkAction, result: MailBulkResult): string {
  const done =
    action === "mark_read"
      ? `Marked ${plural(result.succeeded)} read.`
      : action === "archive"
        ? `Archived ${plural(result.succeeded)} in Gmail.`
        : action === "trash"
        ? `Moved ${plural(result.succeeded)} to Gmail Trash.`
        : `Jev re-profiled ${plural(result.succeeded)}.`;
  return result.failed > 0 ? `${done} ${result.failed} failed. Try again.` : done;
}

/**
 * Actions over the whole current filter, not just the visible page. Moving
 * to Trash asks once, naming the count and the filter, before it runs. The
 * page keys this by filter, so a half-finished confirm never carries over.
 */
export function MailBulkBar({ threadIds, unreadIds, scopeLabel, canModify, canReprofile }: MailBulkBarProps) {
  const bulk = useMailBulkAction();
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const run = (action: MailBulkAction, ids: string[]) => {
    setConfirmingTrash(false);
    setMessage(undefined);
    bulk.mutate(
      { action, threadIds: ids },
      {
        onSuccess: (result) => setMessage(describe(action, result as MailBulkResult)),
        onError: (error) => setMessage(error instanceof Error ? error.message : "That didn't work."),
      },
    );
  };

  const pending = bulk.isPending ? bulk.variables?.action : undefined;
  const readOnlyHint = canModify ? undefined : "Reconnect Gmail to allow this";

  if (confirmingTrash) {
    return (
      <div className="mail-bulk mail-bulk--confirm" role="alertdialog" aria-label="Confirm move to Trash">
        <span className="mail-bulk-question">
          Move {plural(threadIds.length)} in <strong>{scopeLabel}</strong> to Gmail Trash? They stay recoverable
          there for 30 days.
        </span>
        <div className="mail-bulk-actions">
          <button type="button" className="mail-bulk-btn mail-bulk-btn--danger" onClick={() => run("trash", threadIds)}>
            Move to Trash
          </button>
          <button type="button" className="mail-bulk-btn" onClick={() => setConfirmingTrash(false)} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mail-bulk">
      <div className="mail-bulk-actions">
        <button
          type="button"
          className="mail-bulk-btn"
          disabled={!canModify || unreadIds.length === 0 || bulk.isPending}
          title={readOnlyHint}
          onClick={() => run("mark_read", unreadIds)}
        >
          <MailOpen size={14} aria-hidden="true" />
          {pending === "mark_read" ? "Marking read…" : `Mark all read${unreadIds.length ? ` (${unreadIds.length})` : ""}`}
        </button>
        <button
          type="button"
          className="mail-bulk-btn"
          disabled={!canModify || threadIds.length === 0 || bulk.isPending}
          title={canModify ? "Archive everything in this filter in Gmail" : readOnlyHint}
          onClick={() => run("archive", threadIds)}
        >
          <Archive size={14} aria-hidden="true" />
          {pending === "archive" ? "Archiving…" : "Archive all"}
        </button>
        {canReprofile ? (
          <button
            type="button"
            className="mail-bulk-btn"
            disabled={threadIds.length === 0 || bulk.isPending}
            onClick={() => run("reprofile", threadIds)}
          >
            <RefreshCw size={14} aria-hidden="true" className={pending === "reprofile" ? "mail-spin" : undefined} />
            {pending === "reprofile" ? "Asking Jev…" : "Ask Jev again"}
          </button>
        ) : null}
        <button
          type="button"
          className="mail-bulk-btn mail-bulk-btn--danger"
          disabled={!canModify || threadIds.length === 0 || bulk.isPending}
          title={readOnlyHint}
          onClick={() => setConfirmingTrash(true)}
        >
          <Trash2 size={14} aria-hidden="true" />
          {pending === "trash" ? "Moving to Trash…" : "Delete all"}
        </button>
      </div>
      <span className="mail-bulk-status" role="status" aria-live="polite">
        {message ?? ""}
      </span>
    </div>
  );
}
