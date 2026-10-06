import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageWindow, type PageSize } from "@/lib/pagination-model";
import type { Pager } from "@/lib/use-pagination";
import { PAPER_FOCUS } from "./paper";

/**
 * Page controls for a long list: which rows are showing, previous and next,
 * numbered pages with gaps where pages are skipped, and how many rows to show.
 *
 * Hidden when everything fits on one page of the smallest size, because a
 * pager over ten rows is noise. Every button is at least 36px tall and the
 * current page is marked with `aria-current`, not only with colour.
 */
export function PaperPagination<T>({ pager, label, className }: { pager: Pager<T>; label: string; className?: string }) {
  const { page, pageCount, from, to, total, size, sizes, setPage: onPage, setSize: onSize } = pager;
  if (total <= sizes[0]) return null;

  const button = "inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-none border px-2 text-[13px] font-medium tabular-nums transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <nav aria-label={label} className={cn("mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      <p className="text-[13px] text-paper-char tabular-nums" aria-live="polite">
        Showing <span className="font-semibold text-paper-moss">{from}-{to}</span> of {total}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-[13px] text-paper-char">
          Rows
          <select
            value={size}
            onChange={(event) => onSize(Number(event.target.value) as PageSize)}
            className={cn("min-h-9 cursor-pointer rounded-none border border-paper-mist bg-paper-white px-2 text-[13px] text-paper-moss", PAPER_FOCUS)}
          >
            {sizes.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <ul className="flex items-center gap-1">
          <li>
            <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={cn(button, "border-paper-mist bg-paper-white text-paper-moss hover:bg-paper-linen", PAPER_FOCUS)}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
          </li>
          {pageWindow(page, pageCount).map((entry, index) =>
            entry === "gap" ? (
              <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-paper-sage">
                …
              </li>
            ) : (
              <li key={entry}>
                <button
                  type="button"
                  onClick={() => onPage(entry)}
                  aria-label={`Page ${entry}`}
                  aria-current={entry === page ? "page" : undefined}
                  className={cn(button, PAPER_FOCUS, entry === page ? "border-paper-blue bg-paper-blue text-paper-white" : "border-paper-mist bg-paper-white text-paper-moss hover:bg-paper-linen")}
                >
                  {entry}
                </button>
              </li>
            ),
          )}
          <li>
            <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page" className={cn(button, "border-paper-mist bg-paper-white text-paper-moss hover:bg-paper-linen", PAPER_FOCUS)}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
