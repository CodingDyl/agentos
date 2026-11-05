import { useEffect, useState, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/** Hide the loader for this long so a fast read does not flash one. */
export const PAGE_LOADER_SHOW_DELAY_MS = 150;

export type PageLoaderVariant = "page" | "compact";

export interface PageLoaderProps extends HTMLAttributes<HTMLDivElement> {
  /** `page` fills a route or stage; `compact` sits inside a card or panel. */
  variant?: PageLoaderVariant;
  /** Override the flash-avoidance delay. `0` shows the loader immediately. */
  delayMs?: number;
  /** What is being waited for, in plain words. */
  label?: string;
}

/**
 * The wait for a page or a panel: a labelled line of text at a stable size, so
 * the layout does not jump when the content lands. Button-sized spinners stay
 * as they are; this is not for a control.
 */
export function PageLoader({
  variant = "page",
  delayMs = PAGE_LOADER_SHOW_DELAY_MS,
  label = "Loading…",
  className,
  ...props
}: PageLoaderProps) {
  const [shown, setShown] = useState(false);
  const visible = delayMs <= 0 || shown;

  useEffect(() => {
    if (delayMs <= 0) return;
    const id = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);

  return (
    <div
      role="status"
      aria-busy="true"
      data-variant={variant}
      className={cn(
        "flex w-full items-center text-[13px] leading-5 text-os-subtle",
        variant === "page" ? "min-h-40 justify-center" : "min-h-10",
        className,
      )}
      {...props}
    >
      {visible ? label : <span className="sr-only">{label}</span>}
    </div>
  );
}
