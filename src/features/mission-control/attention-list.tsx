import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { AttentionItem } from "@shared/mission-control-types";
import { SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import { attentionLabel, severityRule, severityTone } from "./mission-control-model";

/**
 * What is waiting on you.
 *
 * The most important block on the screen, and the one that has to earn its
 * prominence by disappearing. When nothing is waiting it collapses to a single
 * sentence — no empty card, no placeholder grid, no invented suggestion of
 * something to do. A calm system should look calm; that is the result, not a
 * gap to fill.
 *
 * Each item is framed by a severity rule down its left edge rather than a
 * filled card. DESIGN.md §7 is explicit that elevation comes from surface
 * contrast, hairlines and spacing rather than fills, and a stack of coloured
 * panels would turn a queue of three decisions into an alarm board.
 */

export interface AttentionListProps {
  items: AttentionItem[];
  className?: string;
}

export function AttentionList({ items, className }: AttentionListProps) {
  return (
    <section id="needs-you" aria-label="Needs you" className={cn("min-w-0 scroll-mt-8", className)}>
      <SectionLabel
        action={
          items.length > 0 ? (
            <span className="os-meta text-os-warning tabular-nums">
              {items.length}
            </span>
          ) : null
        }
      >
        Needs you
      </SectionLabel>

      {items.length === 0 ? (
        <p className="mt-4 text-[15px] leading-6 text-os-muted">
          Nothing waiting on you.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <AttentionCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One decision, and where to go and make it.
 *
 * The whole card is the link. Mission Control never performs the action — it
 * routes to the screen that owns it — so there is no ambiguity about what
 * clicking does, and no reason to make a person aim at a small button.
 */
function AttentionCard({ item }: { item: AttentionItem }) {
  return (
    <Link
      to={item.action.href}
      className="os-focus-ring group flex min-w-0 gap-4 rounded-lg border border-os-border bg-os-surface/50 p-5 transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised md:p-6"
    >
      {/* The only colour on the card, and the only thing carrying severity
          besides the word beside it. */}
      <span
        className={cn(
          "mt-1 w-px shrink-0 self-stretch rounded-full",
          severityRule(item.severity),
        )}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn("os-meta", severityTone(item.severity))}>
            {attentionLabel(item.type)}
          </span>
          {item.project ? (
            <span className="os-meta text-os-subtle">{item.project}</span>
          ) : null}
        </div>

        <p className="mt-2.5 max-w-[62ch] text-[15px] leading-6 text-foreground">
          {item.title}
        </p>

        {item.description ? (
          <p className="mt-1.5 max-w-[72ch] text-[13px] leading-5 text-os-muted">
            {item.description}
          </p>
        ) : null}

        <span className="os-meta mt-4 inline-flex items-center gap-2 text-os-subtle transition-colors duration-150 group-hover:text-foreground">
          {item.action.label}
          <ArrowRight
            className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </Link>
  );
}
