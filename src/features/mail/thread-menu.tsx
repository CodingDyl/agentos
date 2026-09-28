import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Archive, Check, EyeOff, Mail, MailOpen, MoreHorizontal, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { MailCategorySchema, type MailBucket, type MailCategory, type MailThread } from "@shared/mail-types";
import { CATEGORY_LABEL, isCorrected, threadCategory } from "./mail-model";

const STATUS_OPTIONS: readonly { value: MailBucket; label: string; hint: string; key: string }[] = [
  { value: "needs_you", label: "Needs you", hint: "I have to reply or act", key: "1" },
  { value: "fyi", label: "FYI", hint: "Worth knowing, nothing to do", key: "2" },
  { value: "low_priority", label: "Low priority", hint: "Goes to Gmail Trash after 24 hours", key: "3" },
];

const CATEGORIES: readonly MailCategory[] = MailCategorySchema.options;

interface ThreadMenuProps {
  thread: MailThread;
  /** The bucket the row is shown in right now — Jev's, or the person's correction. */
  bucket: MailBucket;
  /** Jev is the active classifier, so re-asking it is possible. */
  canReprofile: boolean;
  /** The Gmail grant allows marking read and moving to Trash. */
  canModify: boolean;
  busy: boolean;
  onCorrect: (correction: { bucket?: MailBucket; category?: MailCategory }) => void;
  onResetCorrection: () => void;
  onReprofile: () => void;
  onSetRead: (read: boolean) => void;
  onArchive: () => void;
  onTrash: () => void;
  onHide: () => void;
}

const READ_ONLY_HINT = "Reconnect Gmail to allow this";

/**
 * The ⋯ menu on each row: correct what Jev decided, ask it again, or act on
 * the thread. Corrections take effect at once and are remembered — later Jev
 * calls get them as worked examples.
 */
export function ThreadMenu({
  thread,
  bucket,
  canReprofile,
  canModify,
  busy,
  onCorrect,
  onResetCorrection,
  onReprofile,
  onSetRead,
  onArchive,
  onTrash,
  onHide,
}: ThreadMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const category = threadCategory(thread);
  const corrected = isCorrected(thread);

  const close = (refocus = true) => {
    setOpen(false);
    setConfirmTrash(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("[role^='menuitem']:not(:disabled)")?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) {
        setOpen(false);
        setConfirmTrash(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(panel.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not(:disabled)") ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const act = (run: () => void) => {
    run();
    close();
  };

  return (
    <div className="mail-menu-anchor" onClick={(event) => event.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        className={`mail-menu-trigger${open ? " mail-menu-trigger--open" : ""}`}
        aria-label="Thread actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {open ? (
        <div ref={panel} className="mail-menu" role="menu" aria-label="Thread actions" onKeyDown={onPanelKeyDown}>
          <div className="mail-menu-group" role="group" aria-labelledby={`status-${thread.threadId}`}>
            <p className="mail-menu-heading" id={`status-${thread.threadId}`}>
              Belongs in
            </p>
            {STATUS_OPTIONS.map((option) => {
              const checked = option.value === bucket;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  className="mail-menu-item mail-menu-item--status"
                  disabled={busy}
                  onClick={() => act(() => !checked && onCorrect({ bucket: option.value }))}
                >
                  <span className="mail-menu-check" aria-hidden="true">
                    {checked ? <Check size={14} strokeWidth={2.5} /> : null}
                  </span>
                  <span className="mail-menu-label">
                    {option.label}
                    <span className="mail-menu-hint">{option.hint}</span>
                  </span>
                  <kbd className="mail-kbd">{option.key}</kbd>
                </button>
              );
            })}
          </div>

          <div className="mail-menu-group" role="group" aria-labelledby={`category-${thread.threadId}`}>
            <p className="mail-menu-heading" id={`category-${thread.threadId}`}>
              Category
            </p>
            <div className="mail-menu-chips">
              {CATEGORIES.map((value) => {
                const checked = value === category;
                return (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    className={`mail-menu-chip${checked ? " mail-menu-chip--on" : ""}`}
                    disabled={busy}
                    onClick={() => act(() => !checked && onCorrect({ category: value }))}
                  >
                    {CATEGORY_LABEL[value].toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mail-menu-group">
            {corrected ? (
              <button
                type="button"
                role="menuitem"
                className="mail-menu-item"
                disabled={busy}
                onClick={() => act(onResetCorrection)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Use Jev's answer instead
              </button>
            ) : null}
            {canReprofile ? (
              <button
                type="button"
                role="menuitem"
                className="mail-menu-item"
                disabled={busy}
                onClick={() => act(onReprofile)}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Ask Jev again
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="mail-menu-item"
              disabled={busy || !canModify}
              title={canModify ? undefined : READ_ONLY_HINT}
              onClick={() => act(() => onSetRead(thread.unread))}
            >
              {thread.unread ? <MailOpen size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
              {thread.unread ? "Mark as read" : "Mark as unread"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="mail-menu-item"
              disabled={busy || !canModify}
              title={canModify ? undefined : READ_ONLY_HINT}
              onClick={() => act(onArchive)}
            >
              <Archive size={14} aria-hidden="true" />
              Done (archive in Gmail)
              <kbd className="mail-kbd">e</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className={`mail-menu-item mail-menu-item--danger${confirmTrash ? " mail-menu-item--armed" : ""}`}
              disabled={busy || !canModify}
              title={canModify ? undefined : READ_ONLY_HINT}
              onClick={() => (confirmTrash ? act(onTrash) : setConfirmTrash(true))}
            >
              <Trash2 size={14} aria-hidden="true" />
              {confirmTrash ? "Click again to move to Trash" : "Move to Gmail Trash"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="mail-menu-item"
              disabled={busy}
              onClick={() => act(onHide)}
            >
              <EyeOff size={14} aria-hidden="true" />
              Hide from AgentOS only
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
