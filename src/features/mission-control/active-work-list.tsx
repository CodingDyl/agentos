import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import { EmptyState, Section } from "@/components/os";
import { elapsed } from "./mission-control-model";
import { cn } from "@/lib/utils";

/**
 * What is executing right now.
 *
 * The bar for appearing here is that something is genuinely running — not that
 * a project exists, or that a job finished this morning. The section's only
 * value is being true at the moment it is read, and padding it with recent
 * things would make it one more list nobody trusts.
 *
 * The elapsed time ticks. A page that says "running 06m 32s" and then sits
 * frozen for ten seconds is claiming to be live while demonstrably not being;
 * a second-by-second counter is the cheapest possible proof that the screen is
 * still watching.
 */

export interface ActiveWorkListProps {
  items: ActiveWorkItem[];
  className?: string;
}

export function ActiveWorkList({ items, className }: ActiveWorkListProps) {
  return (
    <Section id="active-work" label="Active now" className={cn("scroll-mt-8", className)}>
      {items.length === 0 ? (
        <EmptyState
          variant="inline"
          description="No agents are running."
        />
      ) : (
        <ul className="space-y-6">
          {items.map((item) => (
            <li key={item.id}>
              <ActiveWorkRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </Section>
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
      className="os-focus-ring group flex min-w-0 items-start gap-4 rounded-md py-1 transition-colors duration-150"
    >
      {/* Pulsing only while the claim is confident. An inferred run gets a
          still dot: a pulse is an assertion that something is happening. */}
      <span
        className={
          item.uncertain
            ? "mt-2 size-1.5 shrink-0 rounded-full bg-os-subtle"
            : "mt-2 size-1.5 shrink-0 rounded-full bg-os-amber motion-safe:animate-pulse"
        }
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="os-meta text-foreground">{item.actor}</span>
          {item.project ? (
            <span className="os-meta text-os-subtle">{item.project}</span>
          ) : null}
        </div>

        <p className="mt-1.5 max-w-[62ch] text-[15px] leading-6 text-os-muted transition-colors duration-150 group-hover:text-foreground">
          {item.title}
        </p>

        <p className="os-meta mt-2 text-os-subtle tabular-nums">
          {item.uncertain ? (
            // Said outright rather than shown as certain. A run whose ending
            // was never reported is not evidence that it is still going.
            <>Started {elapsed(item.startedAt, now)} ago · may have finished</>
          ) : (
            <>{item.detail ? `${item.detail} · ` : ""}Running {elapsed(item.startedAt, now)}</>
          )}
        </p>
      </div>

      <ArrowUpRight
        className="mt-1 size-3.5 shrink-0 text-os-subtle transition-colors duration-150 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}
