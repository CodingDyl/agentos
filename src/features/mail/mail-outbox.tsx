import { useState } from "react";
import { ExternalLink, Paperclip, Send, Trash2 } from "lucide-react";
import { MailSendTagSchema, type MailOutboxItem, type MailSendTag } from "@shared/mail-compose-types";
import { formatRelativeTime } from "@/lib/format";
import { useDiscardMailDraft, useMailOutbox, useRetagMailOutboxItem, useSendMailDraft } from "@/lib/agentos/queries";
import { TAG_LABEL } from "./mail-compose-model";

type TagFilter = "all" | MailSendTag;

const FILTERS: readonly TagFilter[] = ["all", ...MailSendTagSchema.options];

function gmailLink(item: MailOutboxItem): string {
  if (item.kind === "draft") return "https://mail.google.com/mail/#drafts";
  return item.threadId ? `https://mail.google.com/mail/#all/${encodeURIComponent(item.threadId)}` : "https://mail.google.com/mail/#sent";
}

interface OutboxRowProps {
  item: MailOutboxItem;
  onNotice: (message: string) => void;
}

function OutboxRow({ item, onNotice }: OutboxRowProps) {
  const send = useSendMailDraft();
  const discard = useDiscardMailDraft();
  const retag = useRetagMailOutboxItem();
  const busy = send.isPending || discard.isPending || retag.isPending;
  const failure = [send, discard, retag].find((mutation) => mutation.isError)?.error;

  const when = item.sentAt ?? item.createdAt;
  const virtara = item.account === "titan";
  const mailbox = virtara ? "Virtara" : "Gmail";

  return (
    <li className={`mail-outbox-row mail-outbox-row--${item.tag}`}>
      <div className="mail-outbox-main">
        <div className="mail-outbox-to">To {item.to.length > 0 ? item.to.join(", ") : "(no recipients)"}</div>
        <div className="mail-thread-subject">{item.subject}</div>
        <div className="mail-tags">
          <label className="mail-visually-hidden" htmlFor={`tag-${item.id}`}>
            Tag for {item.subject}
          </label>
          <select
            id={`tag-${item.id}`}
            className={`mail-outbox-tag mail-outbox-tag--${item.tag}`}
            value={item.tag}
            disabled={busy}
            onChange={(event) =>
              retag.mutate(
                { id: item.id, tag: event.target.value as MailSendTag },
                { onSuccess: (result) => result.warning && onNotice(result.warning) },
              )
            }
          >
            {MailSendTagSchema.options.map((tag) => (
              <option key={tag} value={tag}>
                {TAG_LABEL[tag].toUpperCase()}
              </option>
            ))}
          </select>
          {virtara ? (
            <span className="mail-tag mail-tag--account" title="Sent from the Virtara mailbox">
              FROM VIRTARA
            </span>
          ) : null}
          {item.attachmentCount > 0 ? (
            <span className="mail-tag mail-tag--muted">
              <Paperclip size={10} aria-hidden="true" /> {item.attachmentCount}
            </span>
          ) : null}
          {!virtara && item.kind === "sent" && item.tag !== "normal" && !item.labelApplied ? (
            <span className="mail-tag mail-tag--countdown" title="Gmail did not accept the label. Change the tag to try again.">
              NOT LABELLED IN GMAIL
            </span>
          ) : null}
        </div>
        {failure ? (
          <p className="mail-thread-error" role="alert">
            {failure instanceof Error ? failure.message : "That did not work."}
          </p>
        ) : null}
      </div>
      <div className="mail-thread-actions">
        <div className="mail-thread-when">
          <time dateTime={when}>{formatRelativeTime(when)}</time>
        </div>
        <div className="mail-quick">
          {item.kind === "draft" ? (
            <>
              <button
                type="button"
                className="mail-quick-btn"
                aria-label={`Send draft: ${item.subject}`}
                title={`Send this draft as it is in ${mailbox} now`}
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Send "${item.subject}" to ${item.to.join(", ")}?`)) return;
                  send.mutate(item.id, { onSuccess: (result) => onNotice(result.warning ?? `Sent: ${item.subject}`) });
                }}
              >
                <Send size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="mail-quick-btn mail-quick-btn--danger"
                aria-label={`Discard draft: ${item.subject}`}
                title={`Delete this draft from ${mailbox}`}
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Discard the draft "${item.subject}"? This deletes it from ${mailbox}.`)) return;
                  discard.mutate(item.id);
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {virtara ? null : (
            <a
              className="mail-quick-btn"
              href={gmailLink(item)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={item.kind === "draft" ? "Open Drafts in Gmail to edit" : "Open in Gmail"}
              title={item.kind === "draft" ? "Edit in Gmail" : "Open in Gmail"}
            >
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Sent and drafts written in AgentOS, filterable by tag, so Business and
 * Virtara email can be told apart from everyday mail at a glance.
 */
export function MailOutbox({ onNotice }: { onNotice: (message: string) => void }) {
  const [filter, setFilter] = useState<TagFilter>("all");
  const outbox = useMailOutbox(filter === "all" ? undefined : filter);
  const items = outbox.data?.items ?? [];
  const drafts = items.filter((item) => item.kind === "draft");
  const sent = items.filter((item) => item.kind === "sent");

  return (
    <section aria-label="Sent and drafts">
      <div className="mail-filters" role="group" aria-label="Filter by tag">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={`mail-filter${filter === value ? " mail-filter--active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "All" : TAG_LABEL[value]}
          </button>
        ))}
      </div>

      {outbox.isPending ? (
        <p className="mail-meta">Reading sent mail…</p>
      ) : outbox.isError ? (
        <p className="mail-action-error" role="alert">
          {outbox.error instanceof Error ? outbox.error.message : "Could not read sent mail."}
        </p>
      ) : items.length === 0 ? (
        <p className="mail-filter-empty">
          {filter === "all"
            ? "Nothing written in AgentOS yet. Press Compose to write an email."
            : `No ${TAG_LABEL[filter]} email written in AgentOS yet.`}
        </p>
      ) : (
        <>
          {drafts.length > 0 ? (
            <div className="mail-bucket">
              <h2 className="mail-bucket-label">
                Drafts <span className="mail-bucket-count">{drafts.length}</span>
              </h2>
              <ul className="mail-outbox-list">
                {drafts.map((item) => (
                  <OutboxRow key={item.id} item={item} onNotice={onNotice} />
                ))}
              </ul>
            </div>
          ) : null}
          {sent.length > 0 ? (
            <div className="mail-bucket">
              <h2 className="mail-bucket-label">
                Sent <span className="mail-bucket-count">{sent.length}</span>
              </h2>
              <ul className="mail-outbox-list">
                {sent.map((item) => (
                  <OutboxRow key={item.id} item={item} onNotice={onNotice} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <p className="mail-shortcuts">
        Only email written in AgentOS is listed here. Business and Virtara are also Gmail labels, so in Gmail search{" "}
        <code>label:business</code> or <code>label:virtara</code>. Email sent from the Virtara mailbox is filed in its
        own Sent folder, and its tag is kept here.
      </p>
    </section>
  );
}
