import { useCallback, useEffect, useRef, useState } from "react";
import { clampPage, pageCountFor, PAGE_SIZES, sliceForPage, type PageSize } from "./finance-pagination-model";

/**
 * Pagination state for a list. The page resets to the first whenever `resetKey`
 * changes (a filter, say), and is kept inside the list if the list shrinks under
 * it, so a person is never left on a page that no longer exists.
 */
export function usePagination<T>(items: readonly T[], resetKey: string = "", initialSize: PageSize = 25) {
  const [page, setPageState] = useState(1);
  const [size, setSizeState] = useState<PageSize>(initialSize);
  const [lastKey, setLastKey] = useState(resetKey);

  // Adjusting state while rendering, from a changed key, is React's own pattern for "reset when a prop changes".
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setPageState(1);
  }

  const current = clampPage(page, items.length, size);
  const total = items.length;

  return {
    pageItems: sliceForPage(items, current, size),
    page: current,
    pageCount: pageCountFor(total, size),
    size,
    total,
    from: total === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(total, current * size),
    sizes: PAGE_SIZES,
    setPage: (next: number) => setPageState(clampPage(next, total, size)),
    setSize: (next: PageSize) => {
      setSizeState(next);
      setPageState(1);
    },
  };
}

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
