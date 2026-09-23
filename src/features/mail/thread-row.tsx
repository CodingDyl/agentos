import { useState } from "react";
import type { MailThread } from "@shared/mail-types";
import { formatRelativeTime } from "@/lib/format";
import { useMailThreadBody } from "@/lib/agentos/queries";
import { threadInitial, threadSender, threadTags } from "./mail-model";
import type { MailBucketTone } from "./bucket-section";

interface ThreadRowProps {
  thread: MailThread;
  tone: MailBucketTone;
}

/** One thread. Clicking it expands the row in place to fetch and show the full body. */
export function ThreadRow({ thread, tone }: ThreadRowProps) {
  const [expanded, setExpanded] = useState(false);
  const body = useMailThreadBody(thread.threadId, expanded);

  const toggle = () => setExpanded((value) => !value);

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
      <div className="mail-thread-when">{formatRelativeTime(thread.messageDate)}</div>
    </div>
  );
}
