import { ArrowRight, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { AttentionItem } from "@shared/mission-control-types";
import { PAPER_FOCUS, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useDismissAttention, useRestoreAttention } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { attentionTag } from "./mission-control-model";

/**
 * What is waiting on you.
 *
 * The most important block on the screen, and the one that has to earn its
 * prominence by disappearing. When nothing is waiting it collapses to a single
 * sentence: no empty card, no placeholder grid, no invented suggestion.
 *
 * Each card can be cleared. Clearing hides that occurrence from Today only:
 * the job, automation or workspace behind it is untouched, and the same thing
 * failing again later comes back as a new card. Cleared cards stay one click
 * away, so nothing is lost by tidying up.
 */

export interface AttentionListProps {
  items: AttentionItem[];
  dismissed: AttentionItem[];
  className?: string;
}

function ref(item: AttentionItem) {
  return { id: item.id, createdAt: item.createdAt };
}

export function AttentionList({ items, dismissed, className }: AttentionListProps) {
  const dismiss = useDismissAttention();
  const restore = useRestoreAttention();
  const [lastCleared, setLastCleared] = useState<AttentionItem[]>([]);
  const [showCleared, setShowCleared] = useState(false);

  const clear = (cleared: AttentionItem[]) => {
    setLastCleared(cleared);
    dismiss.mutate(cleared.map(ref));
  };

  const undo = () => {
    restore.mutate(lastCleared.map((item) => item.id));
    setLastCleared([]);
  };

  return (
    <PaperSection
      id="needs-you"
      label="Needs you"
      count={items.length > 0 ? items.length : undefined}
      className={className}
      action={
        items.length > 1 ? (
          <PaperButton variant="quiet" onClick={() => clear(items)} disabled={dismiss.isPending}>
            Clear all
          </PaperButton>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-[15px] text-paper-char">Nothing waiting on you.</p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
          {items.map((item) => (
            <li key={`${item.id}@${item.createdAt}`}>
              <AttentionCard item={item} onClear={() => clear([item])} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-paper-sage" aria-live="polite">
        {lastCleared.length > 0 ? (
          <span>
            {lastCleared.length === 1 ? "Cleared 1 card." : `Cleared ${lastCleared.length} cards.`}{" "}
            <button
              type="button"
              onClick={undo}
              className={cn("rounded-[2px] font-semibold text-paper-moss underline decoration-paper-gold underline-offset-4", PAPER_FOCUS)}
            >
              Undo
            </button>
          </span>
        ) : null}
        {dismissed.length > 0 ? (
          <button
            type="button"
            aria-expanded={showCleared}
            onClick={() => setShowCleared((open) => !open)}
            className={cn("rounded-[2px] hover:text-paper-moss", PAPER_FOCUS)}
          >
            {showCleared ? "Hide cleared" : `${dismissed.length} cleared`}
          </button>
        ) : null}
      </div>

      {showCleared && dismissed.length > 0 ? (
        <div className="mt-2 rounded-[4px] bg-paper-linen px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-medium text-paper-sage">Cleared from Today, still current</p>
            <PaperButton variant="quiet" className="-mr-2" onClick={() => restore.mutate(undefined)} disabled={restore.isPending}>
              Restore all
            </PaperButton>
          </div>
          <ul className="mt-1 space-y-1">
            {dismissed.map((item) => (
              <li key={`${item.id}@${item.createdAt}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13.5px] text-paper-char">{item.title}</span>
                <PaperButton
                  variant="quiet"
                  className="-mr-2 shrink-0"
                  onClick={() => restore.mutate([item.id])}
                  disabled={restore.isPending}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Restore
                </PaperButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </PaperSection>
  );
}

/** One decision, where to go and make it, and a way to clear it. */
function AttentionCard({ item, onClear }: { item: AttentionItem; onClear: () => void }) {
  const tag = attentionTag(item);

  return (
    <div className="group flex min-w-0 gap-4 px-5 py-4 transition-colors duration-150 hover:bg-paper-cream">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Tag tone={tag.tone}>{tag.label}</Tag>
          {item.project ? <span className="text-[12.5px] font-medium text-paper-sage">{item.project}</span> : null}
        </div>

        <Link
          to={item.action.href}
          className={cn(
            "mt-2 block max-w-[70ch] rounded-[2px] text-[15px] leading-6 font-semibold [overflow-wrap:anywhere] text-paper-moss underline-offset-4 hover:underline",
            PAPER_FOCUS,
          )}
        >
          {item.title}
        </Link>

        {item.description ? (
          <p className="mt-1 line-clamp-2 max-w-[80ch] text-[13.5px] leading-5 break-words text-paper-char">
            {item.description}
          </p>
        ) : null}

        <Link
          to={item.action.href}
          tabIndex={-1}
          className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-paper-blue hover:underline"
        >
          {item.action.label}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear "${item.title}" from Today`}
        title="Clear from Today"
        className={cn(
          "-mr-2 flex size-8 shrink-0 items-center justify-center rounded-[4px] text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
          PAPER_FOCUS,
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
