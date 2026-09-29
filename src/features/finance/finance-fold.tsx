import { ChevronDown, X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";

/**
 * A close button people can see and hit.
 *
 * A bordered square with an X and, in the larger form, the word "Close" and an
 * Esc hint: an icon on its own is easy to miss, and a word on its own is easy
 * to mistake for text. The hit area is 40px, comfortably above the 24px minimum
 * and near the 44px people are recommended, and it has an accessible name that
 * says what it closes. Panels that use it also close on Escape and hand focus
 * back to whatever opened them (see `useDismiss`).
 */
export function CloseButton({ label, onClick, showLabel = false, className }: { label: string; onClick: () => void; showLabel?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={`${label} (Esc)`}
      className={cn(
        "inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-none border border-paper-mist bg-paper-white px-2.5 text-[13px] font-semibold text-paper-moss transition-colors duration-150 hover:border-paper-char hover:bg-paper-linen active:scale-[0.98]",
        PAPER_FOCUS,
        className,
      )}
    >
      <X className="size-4" aria-hidden="true" />
      {showLabel ? (
        <>
          <span>Close</span>
          <kbd className="hidden rounded-none border border-paper-mist bg-paper-linen px-1 font-paper-ui text-[10.5px] font-medium text-paper-sage sm:inline">Esc</kbd>
        </>
      ) : null}
    </button>
  );
}

const ACCENT = {
  green: "border-l-paper-green",
  amber: "border-l-paper-amber",
  flame: "border-l-paper-flame",
  none: "border-l-paper-mist",
} as const;

/**
 * A card in a list that folds away.
 *
 * The header is one button (a disclosure): it always shows what a person needs
 * to scan (who, how much, what state) and folds the detail away. The stripe
 * down the left edge repeats the state in colour, but never alone: `title`,
 * `meta` and `figure` carry the state in words and icons as well.
 *
 * Their contents must be inline (spans), because they sit inside a button.
 */
export function FoldCard({
  open,
  onToggle,
  accent = "none",
  title,
  meta,
  figure,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  accent?: keyof typeof ACCENT;
  title: ReactNode;
  meta?: ReactNode;
  figure?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const bodyId = useId();

  return (
    <div className={cn("rounded-none border border-l-[3px] border-paper-mist bg-paper-white", ACCENT[accent], className)}>
      <h3 className="m-0 text-[length:inherit] font-normal">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className={cn("flex w-full cursor-pointer items-start gap-3 rounded-none px-4 py-3.5 text-left transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS, "focus-visible:-outline-offset-2")}
        >
          <ChevronDown className={cn("mt-1 size-4 shrink-0 text-paper-sage transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
          <span className="block min-w-0 flex-1">
            <span className="block font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">{title}</span>
            {meta ? <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-paper-sage">{meta}</span> : null}
          </span>
          {figure ? <span className="block shrink-0 text-right">{figure}</span> : null}
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="border-t border-paper-stone px-5 pt-4 pb-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Expand or collapse a whole list at once. Says what it will do, not what state it is in. */
export function FoldControls({ allOpen, onSetAll, count }: { allOpen: boolean; onSetAll: (open: boolean) => void; count: number }) {
  if (count < 2) return null;
  return (
    <button
      type="button"
      onClick={() => onSetAll(!allOpen)}
      className={cn("inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-none px-2 text-[12.5px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
    >
      <ChevronDown className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", allOpen && "rotate-180")} aria-hidden="true" />
      {allOpen ? "Collapse all" : "Expand all"}
    </button>
  );
}
