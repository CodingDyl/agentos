import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { MailThread } from "@shared/mail-types";
import { formatRelativeTime } from "@/lib/format";
import { useMailThreadBody, useRemoveMailThread } from "@/lib/agentos/queries";
import { threadInitial, threadSender, threadTags } from "./mail-model";
import type { MailBucketTone } from "./bucket-section";

interface ThreadRowProps {
  thread: MailThread;
  tone: MailBucketTone;
}

/** How long a first click on Remove stays armed before it quietly stands down. */
const REMOVE_CONFIRM_WINDOW_MS = 4000;

/** One thread. Clicking it expands the row in place to fetch and show the full body. */
export function ThreadRow({ thread, tone }: ThreadRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const body = useMailThreadBody(thread.threadId, expanded);
  const removeThread = useRemoveMailThread();

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const toggle = () => {
    // A click anywhere else on the row while Remove is armed stands it down
    // instead of also expanding the thread.
    if (confirmingRemove) {
      clearTimeout(confirmTimer.current);
      setConfirmingRemove(false);
      return;
    }
    setExpanded((value) => !value);
  };

  const handleRemoveClick = (event: MouseEvent) => {
    event.stopPropagation();

    if (!confirmingRemove) {
      setConfirmingRemove(true);
      confirmTimer.current = setTimeout(() => setConfirmingRemove(false), REMOVE_CONFIRM_WINDOW_MS);
      return;
    }

    clearTimeout(confirmTimer.current);
    removeThread.mutate(thread.threadId);
  };

  return (
    <div
      className={`mail-thread mail-thread--${tone}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <div className="mail-thread-avatar">{threadInitial(thread)}</div>
      <div className="mail-thread-body">
        <div className="mail-thread-sender">{threadSender(thread)}</div>
        <div className="mail-thread-snippet">{thread.subject}</div>
        <div className="mail-thread-snippet">{thread.snippet}</div>
        <div className="mail-tags">
          {threadTags(thread).map((tag) => (
            <span key={tag.label} className={`mail-tag mail-tag--${tag.tone}`}>
              {tag.label}
            </span>
          ))}
        </div>
        {expanded ? (
          <div className="mail-thread-expanded-body">
            {body.isPending
              ? "Loading the full message…"
              : body.isError
                ? "Could not load the full message."
                : body.data?.body}
          </div>
        ) : null}
      </div>
      <div className="mail-thread-actions">
        <div className="mail-thread-when">{formatRelativeTime(thread.messageDate)}</div>
        <button
          type="button"
          className={`mail-remove-btn${confirmingRemove ? " mail-remove-btn--confirm" : ""}`}
          onClick={handleRemoveClick}
          disabled={removeThread.isPending}
          aria-label={confirmingRemove ? "Click again to remove this thread" : "Remove thread from Mail"}
          title={confirmingRemove ? "Click again to remove" : "Remove from Mail"}
        >
          {confirmingRemove ? "Remove?" : "×"}
        </button>
      </div>
    </div>
  );
}
