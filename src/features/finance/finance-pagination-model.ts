/** Pagination arithmetic, kept apart from the component so it can be tested on its own. */

export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const pageCountFor = (total: number, size: number) => Math.max(1, Math.ceil(total / Math.max(1, size)));

/** A page number that exists: never below 1, never past the last page. */
export const clampPage = (page: number, total: number, size: number) => Math.min(Math.max(1, page), pageCountFor(total, size));

export function sliceForPage<T>(items: readonly T[], page: number, size: number): T[] {
  const current = clampPage(page, items.length, size);
  return items.slice((current - 1) * size, current * size);
}

/**
 * The page buttons to show: the first, the last, the current page and one
 * either side, with an ellipsis where pages are skipped. Never more than seven
 * entries, so the control does not grow with the list.
 */
export function pageWindow(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const pages = new Set([1, count, current - 1, current, current + 1].filter((page) => page >= 1 && page <= count));
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((page) => pages.add(page));

  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("gap");
    result.push(page);
  });
  return result;
}
