import { useEffect, useState } from "react";
import { clampPage, pageCountFor, PAGE_SIZES, sliceForPage, type PageSize } from "./pagination-model";

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
 * Turns to the page holding the item `focusId` names whenever `focusId`
 * changes, so an item just opened or created (an inline editor, say) is never
 * hidden on another page. Paging away afterwards is left alone.
 */
export function useRevealOnPage<T>(pager: Pager<T>, items: readonly T[], idOf: (item: T) => string, focusId: string | undefined) {
  const { setPage, size } = pager;
  useEffect(() => {
    if (!focusId) return;
    const index = items.findIndex((item) => idOf(item) === focusId);
    if (index >= 0) setPage(Math.floor(index / size) + 1);
    // Only a change of focus moves the page; the list and size changing does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
}

export type Pager<T> = ReturnType<typeof usePagination<T>>;
