import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Paperclip, Sparkles, Undo2, X } from "lucide-react";
import {
  MAIL_ATTACHMENT_MAX_COUNT,
  MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
  isBlockedAttachment,
  type MailAttachment,
  type MailSendTag,
} from "@shared/mail-compose-types";
import type { MailAccountId } from "@shared/mail-account-types";
import { useComposeMail, useMailReplyContext, useMailStatus, usePolishMail } from "@/lib/agentos/queries";
import { formatBytes, replySubjectFor, splitAddresses } from "./mail-compose-model";
import { MailTagPicker } from "./mail-tag-picker";

/** What the composer was opened for: a new email, or a reply to one Inbox thread. */
export type ComposerTarget =
  | { kind: "new" }
  | { kind: "reply"; threadId: string; to?: string; subject: string; account?: MailAccountId };

interface PendingAttachment extends MailAttachment {
  id: string;
  size: number;
}

interface MailComposerProps {
  target: ComposerTarget;
  onClose: () => void;
  /** Reports what happened, for the page to show once the composer has closed. */
  onDone: (message: string) => void;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * Writing an email in the Inbox: a new one, or a reply to a thread.
 *
 * Send and Save draft are the only things that reach a mailbox. Polish
 * rewrites the text in place for review and can be undone; it never sends.
 * The tag (Normal, Business, Virtara) is also a Gmail label on email sent
 * from Gmail. With the Virtara mailbox linked, From picks the mailbox: a
 * reply starts from the one it arrived in, and choosing the Virtara tag
 * switches to the Virtara mailbox until From is changed by hand.
 */
export function MailComposer({ target, onClose, onDone }: MailComposerProps) {
  const titleId = useId();
  const replyThreadId = target.kind === "reply" ? target.threadId : undefined;
  const replyContext = useMailReplyContext(replyThreadId);
  const compose = useComposeMail();
  const polish = usePolishMail();
  const status = useMailStatus();
  const titan = status.data?.accounts.find((account) => account.id === "titan" && account.connected);
  const gmailCanSend = status.data?.canModify ?? false;
  const fallbackFrom: MailAccountId = target.kind === "reply" && target.account ? target.account : gmailCanSend || !titan ? "gmail" : "titan";

  const [to, setTo] = useState(target.kind === "reply" ? (target.to ?? "") : "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCopies, setShowCopies] = useState(false);
  const [subject, setSubject] = useState(target.kind === "reply" ? replySubjectFor(target.subject) : "");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState<MailSendTag>("normal");
  const [chosenFrom, setChosenFrom] = useState<MailAccountId | undefined>();
  // Until From is chosen by hand, the Virtara tag means the Virtara mailbox.
  const from: MailAccountId = !titan ? "gmail" : (chosenFrom ?? (tag === "virtara" ? "titan" : fallbackFrom));
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [beforePolish, setBeforePolish] = useState<{ subject: string; body: string } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);

  const prefillTouched = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // The server knows the real reply address (Reply-To, or the other party when the last message was yours).
  useEffect(() => {
    if (replyContext.data && !prefillTouched.current) {
      setTo(replyContext.data.to);
      setSubject(replyContext.data.subject);
    }
  }, [replyContext.data]);

  useEffect(() => {
    (target.kind === "reply" ? bodyField.current : firstField.current)?.focus();
  }, [target.kind]);

  const totalBytes = attachments.reduce((sum, file) => sum + file.size, 0);
  const recipients = [...splitAddresses(to), ...splitAddresses(cc), ...splitAddresses(bcc)];
  const busy = compose.isPending || polish.isPending;
  const dirty = Boolean(body.trim() || attachments.length > 0 || (target.kind === "new" && (to.trim() || subject.trim())));

  const close = () => {
    if (busy) return;
    if (dirty && !window.confirm("Discard this email? It has not been sent or saved.")) return;
    onClose();
  };

  const addFiles = async (files: FileList | File[]) => {
    setProblem(undefined);
    const incoming = [...files];
    let running = totalBytes;
    const accepted: PendingAttachment[] = [];

    for (const file of incoming) {
      if (attachments.length + accepted.length >= MAIL_ATTACHMENT_MAX_COUNT) {
        setProblem(`Up to ${MAIL_ATTACHMENT_MAX_COUNT} attachments per email.`);
        break;
      }
      if (isBlockedAttachment(file.name)) {
        setProblem(`${file.name} is a file type mail servers block. Zip it or share a link instead.`);
        continue;
      }
      if (running + file.size > MAIL_ATTACHMENT_MAX_TOTAL_BYTES) {
        setProblem(`${file.name} would take this email over ${formatBytes(MAIL_ATTACHMENT_MAX_TOTAL_BYTES)}. Share a Drive link instead.`);
        continue;
      }
      try {
        accepted.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          data: await readAsBase64(file),
          size: file.size,
        });
        running += file.size;
      } catch (error) {
        setProblem(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }

    if (accepted.length > 0) setAttachments((current) => [...current, ...accepted]);
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
  };

  const runPolish = () => {
    setProblem(undefined);
    const original = { subject, body };
    polish.mutate(
      { subject: subject || undefined, body },
      {
        onSuccess: (result) => {
          setBeforePolish(original);
          setBody(result.body);
          if (result.subject) setSubject(result.subject);
        },
        onError: (failure) => setProblem(failure instanceof Error ? failure.message : "Polish did not work."),
      },
    );
  };

  const undoPolish = () => {
    if (!beforePolish) return;
    setSubject(beforePolish.subject);
    setBody(beforePolish.body);
    setBeforePolish(undefined);
  };

  const submit = (mode: "send" | "draft") => {
    setProblem(undefined);
    if (recipients.length === 0) return setProblem("Add at least one recipient.");
    if (!subject.trim()) return setProblem("Add a subject.");
    if (mode === "send" && !body.trim() && attachments.length === 0) return setProblem("The email is empty.");

    compose.mutate(
      {
        mode,
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        bcc: splitAddresses(bcc),
        subject: subject.trim(),
        body,
        tag,
        from,
        replyToThreadId: replyThreadId,
        attachments: attachments.map(({ filename, mimeType, data }) => ({ filename, mimeType, data })),
      },
      {
        onSuccess: (result) => {
          const mailbox = from === "titan" ? "Virtara" : "Gmail";
          const where = mode === "send" ? `Sent from ${mailbox}` : `Saved to ${mailbox} Drafts`;
          onDone(result.warning ?? `${where}: ${result.item.subject}`);
          onClose();
        },
        onError: (failure) => setProblem(failure instanceof Error ? failure.message : "That did not work."),
      },
    );
  };

  return (
    <div
      className={`mail-composer${dragging ? " mail-composer--dragging" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="mail-composer-head">
        <h2 id={titleId} className="mail-composer-title">
          {target.kind === "reply" ? "Reply" : "New email"}
        </h2>
        <button type="button" className="mail-quick-btn" aria-label="Close composer" onClick={close} disabled={busy}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <form
        className="mail-composer-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit("send");
        }}
      >
        {titan ? (
          <div className="mail-composer-row">
            <label htmlFor={`${titleId}-from`}>From</label>
            <select
              id={`${titleId}-from`}
              className="mail-composer-from"
              value={from}
              onChange={(event) => setChosenFrom(event.target.value as MailAccountId)}
              disabled={busy}
            >
              <option value="gmail" disabled={!gmailCanSend}>
                Gmail{gmailCanSend ? "" : " (connect Gmail to send)"}
              </option>
              <option value="titan">Virtara ({titan.address})</option>
            </select>
          </div>
        ) : null}
        <div className="mail-composer-row">
          <label htmlFor={`${titleId}-to`}>To</label>
          <input
            id={`${titleId}-to`}
            ref={firstField}
            type="text"
            inputMode="email"
            autoComplete="email"
            value={to}
            placeholder={replyContext.isPending && replyThreadId ? "Loading reply address…" : "name@example.com, another@example.com"}
            onChange={(event) => {
              prefillTouched.current = true;
              setTo(event.target.value);
            }}
          />
          {!showCopies ? (
            <button type="button" className="mail-link-btn mail-composer-cc-toggle" onClick={() => setShowCopies(true)}>
              Cc / Bcc
            </button>
          ) : null}
        </div>
        {showCopies ? (
          <>
            <div className="mail-composer-row">
              <label htmlFor={`${titleId}-cc`}>Cc</label>
              <input id={`${titleId}-cc`} type="text" inputMode="email" value={cc} onChange={(event) => setCc(event.target.value)} />
            </div>
            <div className="mail-composer-row">
              <label htmlFor={`${titleId}-bcc`}>Bcc</label>
              <input id={`${titleId}-bcc`} type="text" inputMode="email" value={bcc} onChange={(event) => setBcc(event.target.value)} />
            </div>
          </>
        ) : null}
        <div className="mail-composer-row">
          <label htmlFor={`${titleId}-subject`}>Subject</label>
          <input
            id={`${titleId}-subject`}
            type="text"
            value={subject}
            maxLength={400}
            onChange={(event) => {
              prefillTouched.current = true;
              setSubject(event.target.value);
            }}
          />
        </div>

        <div className="mail-composer-tag">
          <span className="mail-composer-tag-label" id={`${titleId}-tag`}>
            Tag
          </span>
          <MailTagPicker value={tag} onChange={setTag} labelledBy={`${titleId}-tag`} />
        </div>

        <label htmlFor={`${titleId}-body`} className="mail-visually-hidden">
          Message
        </label>
        <textarea
          id={`${titleId}-body`}
          ref={bodyField}
          className="mail-composer-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write your email…"
          rows={12}
          aria-busy={polish.isPending}
        />

        {attachments.length > 0 ? (
          <ul className="mail-composer-files" aria-label="Attachments">
            {attachments.map((file) => (
              <li key={file.id} className="mail-composer-file">
                <Paperclip size={13} aria-hidden="true" />
                <span className="mail-composer-file-name">{file.filename}</span>
                <span className="mail-composer-file-size">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className="mail-quick-btn"
                  aria-label={`Remove ${file.filename}`}
                  onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== file.id))}
                  disabled={busy}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
            <li className="mail-composer-file-total">
              {formatBytes(totalBytes)} of {formatBytes(MAIL_ATTACHMENT_MAX_TOTAL_BYTES)}
            </li>
          </ul>
        ) : null}

        {problem ? (
          <p className="mail-action-error" role="alert">
            {problem}
          </p>
        ) : null}

        <div className="mail-composer-actions">
          <div className="mail-composer-tools">
            <input ref={fileInput} type="file" multiple hidden onChange={onPickFiles} />
            <button
              type="button"
              className="mail-btn-ghost mail-btn-icon"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              title="Attach files, or drop them onto this window"
            >
              <Paperclip size={15} aria-hidden="true" /> Attach
            </button>
            <button
              type="button"
              className="mail-btn-ghost mail-btn-icon"
              onClick={runPolish}
              disabled={busy || !body.trim()}
              title="Fix grammar and make the tone professional. You review it before sending."
            >
              <Sparkles size={15} aria-hidden="true" /> {polish.isPending ? "Polishing…" : "Polish"}
            </button>
            {beforePolish && !polish.isPending ? (
              <button type="button" className="mail-link-btn mail-btn-icon" onClick={undoPolish}>
                <Undo2 size={14} aria-hidden="true" /> Undo polish
              </button>
            ) : null}
          </div>
          <div className="mail-composer-submit">
            <button type="button" className="mail-btn-ghost" onClick={() => submit("draft")} disabled={busy}>
              {compose.isPending && compose.variables?.mode === "draft" ? "Saving…" : "Save draft"}
            </button>
            <button type="submit" className="mail-btn-amber" disabled={busy}>
              {compose.isPending && compose.variables?.mode === "send" ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </form>
      {dragging ? <div className="mail-composer-drop" aria-hidden="true">Drop files to attach</div> : null}
    </div>
  );
}
