import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";
import { MORE_TABS, PRIMARY_TABS, type TractionTab } from "./traction-model";

/**
 * Traction's tabs: the four steps of getting a customer in a row, and
 * everything else under More.
 *
 * A tab opened from More (or from an old link) joins the row while it is
 * open, so the active tab is always visible and underlined, the same way a
 * workspace's tabs behave.
 */
export function TractionTabs({ tab, onTab, badges = {} }: { tab: TractionTab; onTab: (tab: TractionTab) => void; badges?: Partial<Record<TractionTab, number>> }) {
  const opened = MORE_TABS.find((candidate) => candidate.value === tab);
  const visible = opened ? [...PRIMARY_TABS, opened] : PRIMARY_TABS;
  const hidden = MORE_TABS.filter((candidate) => candidate.value !== tab);

  return (
    <div className="flex items-end gap-1 shadow-[inset_0_-1px_0_var(--paper-mist)]">
      <div role="tablist" aria-label="Traction sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {visible.map((option) => {
          const selected = option.value === tab;
          const badge = badges[option.value];
          return (
            <button
              key={option.value}
              id={`tab-${option.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${option.value}`}
              onClick={() => onTab(option.value)}
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[6px] border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors duration-150",
                PAPER_FOCUS,
                selected ? "border-paper-blue bg-paper-white text-paper-blue" : "border-transparent text-paper-sage hover:bg-paper-linen hover:text-paper-moss",
              )}
            >
              {option.label}
              {badge ? <span className="rounded-full bg-paper-stone px-1.5 text-[12px] leading-[17px] text-paper-char tabular-nums">{badge}</span> : null}
            </button>
          );
        })}
      </div>
      <MoreMenu items={hidden} onSelect={onTab} />
    </div>
  );
}

/** Click to open, Escape or an outside click to close. */
function MoreMenu({ items, onSelect }: { items: readonly { value: TractionTab; label: string }[]; onSelect: (tab: TractionTab) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0 pb-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More sections"
        onClick={() => setOpen((current) => !current)}
        className={cn("inline-flex cursor-pointer items-center gap-1 rounded-[4px] px-2.5 py-1.5 text-[13.5px] font-medium text-paper-sage hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
      >
        More
        <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label="More sections" className="absolute right-0 z-20 mt-1 min-w-[12rem] border border-paper-mist bg-paper-white py-1 shadow-md">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(item.value);
              }}
              className={cn("block w-full cursor-pointer px-3.5 py-2 text-left text-[13.5px] text-paper-char hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
