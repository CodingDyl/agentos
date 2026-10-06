import { useEffect, useState } from "react";
import type { MailBucket } from "@shared/mail-types";
import { useCorrectMailThread, useMailBulkAction, useSetMailThreadRead } from "@/lib/agentos/queries";
import type { ThreadRowActions } from "./thread-row";

const STATUS_KEYS: Record<string, MailBucket> = { "1": "needs_you", "2": "fyi", "3": "low_priority" };

function focusThread(threadId: string | undefined) {
  if (!threadId) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(threadId)}"] [data-thread-toggle]`)?.focus();
  });
}

/** Rows in on-screen order, read from the page itself so it always matches what's drawn. */
function rowIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".mail-thread[data-thread-id]")].map(
    (row) => row.dataset.threadId ?? "",
  );
}

function focusedThreadId(): string | undefined {
  const active = document.activeElement;
  return active instanceof HTMLElement
    ? (active.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId ?? undefined)
    : undefined;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
      target.closest(".mail-menu, .mail-composer") !== null)
  );
}


/**
 * Fast triage for the Inbox: Done (archive) and Delete hide a row at once
 * and put it back only if Gmail refuses; focus moves to the next row so a
 * run of `e e e #` clears mail without touching the mouse.
 *
 * Shortcuts (Gmail's where Gmail has one): j/k move, e done, # or Delete
 * trash, 1/2/3 Needs you / FYI / Low priority, u read/unread. Enter or o
 * opens, handled by the row itself.
 */
export function useMailTriage(canModify: boolean) {
  const bulk = useMailBulkAction();
  const correct = useCorrectMailThread();
  const setRead = useSetMailThreadRead();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();

  const neighbourOf = (threadId: string): string | undefined => {
    const ids = rowIds();
    const index = ids.indexOf(threadId);
    return ids[index + 1] ?? ids[index - 1];
  };

  const restore = (threadId: string, message: string) => {
    setGone((current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
    setError(message);
  };

  const leave = (threadId: string, action: "archive" | "trash") => {
    if (!canModify) return;
    const wasFocused = focusedThreadId() === threadId;
    const next = neighbourOf(threadId);

    setError(undefined);
    setGone((current) => new Set(current).add(threadId));
    if (wasFocused) focusThread(next);

    const verb = action === "archive" ? "archive" : "move to Trash";
    bulk.mutate(
      { action, threadIds: [threadId] },
      {
        onSuccess: (result) => {
          if (result && typeof result === "object" && "failed" in result && Number(result.failed) > 0) {
            restore(threadId, `Gmail wouldn't ${verb} that thread. It's back in the list.`);
          }
        },
        onError: (failure) =>
          restore(threadId, failure instanceof Error ? failure.message : `Couldn't ${verb} that thread.`),
      },
    );
  };

  const actions: ThreadRowActions = {
    archive: (threadId) => leave(threadId, "archive"),
    trash: (threadId) => leave(threadId, "trash"),
    setBucket: (threadId, bucket) => {
      setError(undefined);
      correct.mutate(
        { threadId, correction: { bucket } },
        { onError: (failure) => setError(failure instanceof Error ? failure.message : "Couldn't move that thread.") },
      );
    },
  };

  // Rebound every render so the handler always sees the current grant and
  // handlers; one listener, so this costs nothing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;

      const ids = rowIds();
      const focused = focusedThreadId();
      const index = focused ? ids.indexOf(focused) : -1;
      const move = (step: number) => {
        event.preventDefault();
        focusThread(index === -1 ? ids[0] : ids[Math.min(Math.max(index + step, 0), ids.length - 1)]);
      };

      if (event.key === "j") return move(1);
      if (event.key === "k") return move(-1);
      if (!focused) return;
      if (event.key === "ArrowDown") return move(1);
      if (event.key === "ArrowUp") return move(-1);

      if (event.key === "e") {
        event.preventDefault();
        actions.archive(focused);
      } else if (event.key === "#" || event.key === "Delete") {
        event.preventDefault();
        actions.trash(focused);
      } else if (event.key in STATUS_KEYS) {
        event.preventDefault();
        actions.setBucket(focused, STATUS_KEYS[event.key]);
      } else if (event.key === "u" && canModify) {
        const row = document.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(focused)}"]`);
        event.preventDefault();
        setRead.mutate({ threadId: focused, read: row?.dataset.unread === "true" });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return { gone, error, dismissError: () => setError(undefined), actions };
}
