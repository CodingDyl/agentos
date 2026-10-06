import { useState } from "react";
import { Archive, Reply, Trash2 } from "lucide-react";
import type { MailBucket, MailThread } from "@shared/mail-types";
import { Link } from "react-router-dom";
import { useClientMatcher } from "@/lib/agentos/business";
import { formatRelativeTime } from "@/lib/format";
import {
  useClearMailCorrection,
  useCorrectMailThread,
  useMailBulkAction,
  useMailThreadBody,
  useRemoveMailThread,
  useSetMailThreadRead,
} from "@/lib/agentos/queries";
import {
  TONE_BUCKET,
  lowPriorityCountdown,
  threadInitial,
  threadSender,
  threadTags,
  type MailBucketTone,
} from "./mail-model";
import { ThreadMenu } from "./thread-menu";

/**
 * The actions that take a thread off the list. Owned by the page, which
 * hides the row at once and restores it only if Gmail refuses — so clearing
 * mail feels instant instead of waiting on a round trip per row.
 */
export interface ThreadRowActions {
  archive: (threadId: string) => void;
  trash: (threadId: string) => void;
  setBucket: (threadId: string, bucket: MailBucket) => void;
  /** Opens the composer on this thread. Absent when the Gmail grant cannot send. */
  reply?: (thread: MailThread) => void;
}

interface ThreadRowProps {
  thread: MailThread;
  tone: MailBucketTone;
  canModify: boolean;
  canReprofile: boolean;
  actions: ThreadRowActions;
}

const READ_ONLY_HINT = "Reconnect Gmail to allow this";

/**
 * One thread. Clicking it expands the row in place to fetch and show the
 * full body — and, like Gmail, opening an unread thread marks it read.
 */
export function ThreadRow({ thread, tone, canModify, canReprofile, actions }: ThreadRowProps) {
  const client = useClientMatcher()(thread.fromEmail);
  const [expanded, setExpanded] = useState(false);
  const mailbox = thread.account === "titan" ? "Virtara" : "Gmail";
  const body = useMailThreadBody(thread.threadId, expanded);
  const correct = useCorrectMailThread();
  const clearCorrection = useClearMailCorrection();
  const setRead = useSetMailThreadRead();
  const reprofile = useMailBulkAction();
  const removeThread = useRemoveMailThread();

  const busy =
    correct.isPending ||
    clearCorrection.isPending ||
    setRead.isPending ||
    reprofile.isPending ||
    removeThread.isPending;
  const failure = [correct, clearCorrection, setRead, reprofile, removeThread].find((mutation) => mutation.isError)
    ?.error;
  const countdown = tone === "low" ? lowPriorityCountdown(thread) : undefined;

  const toggle = () => {
    const opening = !expanded;
    setExpanded(opening);
    if (opening && thread.unread && canModify) {
      setRead.mutate({ threadId: thread.threadId, read: true });
    }
  };

  const quick = (run: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    run();
  };

  return (
    <div
      className={`mail-thread mail-thread--${tone}${thread.unread ? " mail-thread--unread" : ""}`}
      data-thread-id={thread.threadId}
      data-unread={thread.unread}
      onClick={toggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " " || event.key === "o") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <div className="mail-thread-avatar">{threadInitial(thread)}</div>
      <div className="mail-thread-body">
        <div className="mail-thread-sender">
          {thread.unread ? <span className="mail-unread-dot" aria-label="Unread" /> : null}
          {threadSender(thread)}
        </div>
        <div className="mail-thread-subject">{thread.subject}</div>
        <div className="mail-thread-snippet">{thread.snippet}</div>
        <div className="mail-tags">
          {thread.account === "titan" ? (
            <span className="mail-tag mail-tag--account" title="Arrived in the Virtara mailbox">
              VIRTARA
            </span>
          ) : null}
          {reprofile.isPending ? (
            <span className="mail-tag mail-tag--muted">ASKING JEV…</span>
          ) : (
            threadTags(thread).map((tag) => (
              <span key={tag.label} className={`mail-tag mail-tag--${tag.tone}`}>
                {tag.label}
              </span>
            ))
          )}
          {client ? (
            <Link
              to={`/business?tab=clients&client=${encodeURIComponent(client.id)}`}
              onClick={(event) => event.stopPropagation()}
              className="mail-tag mail-tag--client"
              title="Open this client in Business"
            >
              {(client.companyName ?? client.name).toUpperCase()}
            </Link>
          ) : null}
          {countdown ? (
            <span className="mail-tag mail-tag--countdown" title="Low priority mail moves to Trash after 24 hours">
              {countdown}
            </span>
          ) : null}
        </div>
        {failure ? (
          <p className="mail-thread-error" role="alert">
            {failure instanceof Error ? failure.message : "That didn't work."}
          </p>
        ) : null}
        {expanded ? (
          <>
            <div className="mail-thread-expanded-body">
              {body.isPending
                ? "Loading the full message…"
                : body.isError
                  ? "Could not load the full message."
                  : body.data?.body}
            </div>
            {actions.reply ? (
              <div className="mail-thread-reply">
                <button
                  type="button"
                  className="mail-btn-ghost mail-btn-icon"
                  onClick={quick(() => actions.reply?.(thread))}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Reply size={15} aria-hidden="true" /> Reply
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="mail-thread-actions">
        <div className="mail-thread-when">{formatRelativeTime(thread.messageDate)}</div>
        <div className="mail-quick">
          {tone === "low" ? (
            <button
              type="button"
              className="mail-quick-btn mail-quick-btn--text"
              title="Keep: move to FYI so it isn't cleared (2)"
              onClick={quick(() => actions.setBucket(thread.threadId, "fyi"))}
            >
              Keep
            </button>
          ) : null}
          <button
            type="button"
            className="mail-quick-btn"
            aria-label={`Done: archive in ${mailbox}`}
            title={canModify ? `Done: archive in ${mailbox} (e)` : READ_ONLY_HINT}
            disabled={!canModify}
            onClick={quick(() => actions.archive(thread.threadId))}
          >
            <Archive size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mail-quick-btn mail-quick-btn--danger"
            aria-label={`Delete: move to ${mailbox} Trash`}
            title={canModify ? `Delete: move to ${mailbox} Trash (#)` : READ_ONLY_HINT}
            disabled={!canModify}
            onClick={quick(() => actions.trash(thread.threadId))}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
          <ThreadMenu
            thread={thread}
            bucket={TONE_BUCKET[tone]}
            canReprofile={canReprofile}
            canModify={canModify}
            busy={busy}
            onCorrect={(correction) =>
              correction.bucket
                ? actions.setBucket(thread.threadId, correction.bucket)
                : correct.mutate({ threadId: thread.threadId, correction })
            }
            onResetCorrection={() => clearCorrection.mutate(thread.threadId)}
            onReprofile={() => reprofile.mutate({ action: "reprofile", threadIds: [thread.threadId] })}
            onSetRead={(read) => setRead.mutate({ threadId: thread.threadId, read })}
            onArchive={() => actions.archive(thread.threadId)}
            onTrash={() => actions.trash(thread.threadId)}
            onHide={() => removeThread.mutate(thread.threadId)}
          />
        </div>
      </div>
    </div>
  );
}
