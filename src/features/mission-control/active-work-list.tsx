import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import { PAPER_FOCUS, PaperSection } from "@/components/paper";
import { cn } from "@/lib/utils";
import { elapsed } from "./mission-control-model";

/**
 * What is executing right now. The bar for appearing is that something is
 * genuinely running, and the elapsed time ticks: a counter that froze would be
 * a screen claiming to be live while demonstrably not being.
 */
export function ActiveWorkList({ items, className }: { items: ActiveWorkItem[]; className?: string }) {
  return (
    <PaperSection id="active-work" label="Active now" count={items.length > 0 ? items.length : undefined} className={className}>
      {items.length === 0 ? (
        <p className="text-[14px] text-paper-char">No agents are running.</p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
          {items.map((item) => (
            <li key={item.id}>
              <ActiveWorkRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

/** Re-renders once a second, so the counter beside "running" means something. */
function useTicker(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

function ActiveWorkRow({ item }: { item: ActiveWorkItem }) {
  const now = useTicker(!item.uncertain);

  return (
    <Link
      to={item.href}
      className={cn("group flex min-w-0 items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}
    >
      {/* Pulsing only while the claim is confident; a pulse asserts something is happening. */}
      <span
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          item.uncertain ? "bg-paper-ash" : "bg-paper-green motion-safe:animate-pulse",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-paper-sage">
          <span className="text-paper-moss">{item.actor}</span>
          {item.project ? ` · ${item.project}` : ""}
        </p>
        <p className="mt-0.5 text-[14px] leading-6 text-paper-moss">{item.title}</p>
        <p className="mt-0.5 text-[12.5px] text-paper-sage tabular-nums">
          {item.uncertain ? (
            <>Started {elapsed(item.startedAt, now)} ago · may have finished</>
          ) : (
            <>
              {item.detail ? `${item.detail} · ` : ""}Running {elapsed(item.startedAt, now)}
            </>
          )}
        </p>
      </div>
      <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-paper-sage group-hover:text-paper-moss" aria-hidden="true" />
    </Link>
  );
}
