import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Open and closed state for a list of collapsible cards.
 *
 * `defaultOpen` decides each card's starting state (open what needs attention).
 * A person's own choice is remembered by id and wins over the default, so a
 * refetch that reorders or adds cards never re-collapses one they opened.
 */
export function useFold(ids: readonly string[], defaultOpen: (id: string) => boolean) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isOpen = (id: string) => overrides[id] ?? defaultOpen(id);
  const allOpen = ids.length > 0 && ids.every(isOpen);

  return {
    isOpen,
    allOpen,
    toggle: (id: string) => setOverrides((current) => ({ ...current, [id]: !(current[id] ?? defaultOpen(id)) })),
    /** Opens or closes `subset` (default: every card). Cards outside it keep whatever state they had. */
    setAll: (open: boolean, subset: readonly string[] = ids) => setOverrides((current) => ({ ...current, ...Object.fromEntries(subset.map((id) => [id, open])) })),
  };
}

/** The panels that are open, oldest first. Escape closes the newest, which is the one on top. */
const openPanels: object[] = [];

/**
 * Makes a panel dismissable the way people expect: Escape closes it (only the
 * topmost, if several are open), and when it goes away focus returns to
 * whatever opened it, so a keyboard user is not dropped back at the top of the
 * page.
 *
 * Focus is restored only if the opener is still on the page.
 */
export function useDismiss(onClose: () => void, active = true) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = {};
    openPanels.push(token);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && openPanels[openPanels.length - 1] === token) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const index = openPanels.indexOf(token);
      if (index >= 0) openPanels.splice(index, 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [active]);
}

/** A stable toggle for a boolean, for panels that open and close. */
export function useOpen(initial = false): [boolean, () => void, (value: boolean) => void] {
  const [open, setOpen] = useState(initial);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return [open, toggle, setOpen];
}

/**
 * The alert you just dismissed, kept for a few seconds so it can be undone. A
 * module-level store rather than component state: the alert's own row is gone by
 * the time the bar needs it, and Today, Overview and Insights all show alerts.
 */
export interface DismissedNotice {
  id: string;
  text: string;
}

const UNDO_WINDOW_MS = 10_000;
let lastDismissed: DismissedNotice | undefined;
let undoTimer: ReturnType<typeof setTimeout> | undefined;
const noticeListeners = new Set<() => void>();

const announce = () => noticeListeners.forEach((listener) => listener());

export function rememberDismissed(notice: DismissedNotice): void {
  lastDismissed = notice;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(forgetDismissed, UNDO_WINDOW_MS);
  announce();
}

export function forgetDismissed(): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = undefined;
  lastDismissed = undefined;
  announce();
}

export function useDismissedNotice(): DismissedNotice | undefined {
  return useSyncExternalStore(
    (listener) => {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    () => lastDismissed,
    () => undefined,
  );
}
