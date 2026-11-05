import { ArrowRightLeft, Check, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { FocusToday } from "@shared/focus-types";
import { ActionMenu, ActionMenuItem } from "@/components/os";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection } from "@/components/paper";
import { useMarkDone, useSwapPick } from "@/lib/agentos/focus";
import { cn } from "@/lib/utils";

/**
 * The dominant panel: today's three. Tick one off and it is ticked in its
 * workspace or area too; swap any of them for something else on the shortlist.
 * The title links to the task, and the checkbox and menu are separate controls
 * beside it, never nested inside the link.
 */
export function YourThree({ today, onCheckIn, className }: { today: FocusToday; onCheckIn: () => void; className?: string }) {
  const done = useMarkDone();
  const swap = useSwapPick();
  const [swapping, setSwapping] = useState<number>();
  const { day, shortlist } = today;
  const finished = day.picks.filter((entry) => day.done.includes(entry.candidate.id)).length;

  if (day.picks.length === 0) {
    return (
      <PaperSection label="Your three" className={className}>
        <p className="max-w-[62ch] text-[14px] leading-[22px] text-paper-char">
          {day.skipped ? "You skipped this morning's check-in." : "No plan for today yet."} Thirty seconds, and Hermes picks the three things that matter most today.
        </p>
        <PaperButton variant="ghost" className="mt-3" onClick={onCheckIn}>
          Check in
        </PaperButton>
      </PaperSection>
    );
  }

  const others = shortlist.filter((candidate) => !day.picks.some((entry) => entry.candidate.id === candidate.id));

  return (
    <PaperSection
      label="Your three"
      className={className}
      action={
        <span className="text-[13px] leading-5 text-paper-sage tabular-nums" aria-live="polite">
          {finished} of {day.picks.length} done
        </span>
      }
    >
      <ol className="divide-y divide-paper-mist">
        {day.picks.map((entry, index) => {
          const isDone = day.done.includes(entry.candidate.id);
          return (
            <li key={entry.candidate.id} className="py-4 first:pt-0">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`${isDone ? "Not done" : "Done"}: ${entry.candidate.title}`}
                  disabled={done.isPending}
                  onClick={() => done.mutate({ candidateId: entry.candidate.id, done: !isDone })}
                  className={cn(
                    "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors duration-150 disabled:cursor-not-allowed",
                    isDone ? "border-paper-green bg-paper-green text-[var(--on-accent)]" : "border-paper-ash hover:bg-paper-linen",
                    PAPER_FOCUS,
                  )}
                >
                  {isDone ? <Check className="size-4" aria-hidden="true" /> : null}
                </button>
                <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-paper-mist text-[13px] leading-5 font-medium text-paper-char tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[14px] leading-[22px] font-medium break-words", isDone ? "text-paper-sage line-through" : "text-paper-moss")}>
                    <span className="sr-only">Priority {index + 1}: </span>
                    {entry.candidate.href ? (
                      <Link to={entry.candidate.href} className={cn("rounded-sm no-underline hover:underline", PAPER_FOCUS)}>
                        {entry.candidate.title}
                      </Link>
                    ) : (
                      entry.candidate.title
                    )}
                  </p>
                  <p className="mt-0.5 max-w-[70ch] text-[14px] leading-[22px] text-paper-char">{entry.why}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-paper-sage">
                    <span>{entry.candidate.source}</span>
                    {isDone ? <span>Done</span> : null}
                    {entry.candidate.goalId ? <span className="os-mono">{entry.candidate.goalId}</span> : null}
                  </p>
                  {swapping === index ? (
                    <label className="mt-2 block max-w-[480px]">
                      <span className="sr-only">Swap {entry.candidate.title} for</span>
                      <select
                        autoFocus
                        defaultValue=""
                        disabled={swap.isPending}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setSwapping(undefined);
                        }}
                        onChange={(event) => {
                          if (event.target.value) swap.mutate({ slot: index, candidateId: event.target.value }, { onSuccess: () => setSwapping(undefined) });
                        }}
                        className={cn(PAPER_INPUT, "w-full")}
                      >
                        <option value="">Swap for…</option>
                        {others.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.title} ({candidate.source})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {others.length > 0 && !isDone ? (
                  <ActionMenu
                    trigger={
                      <button
                        type="button"
                        aria-label={`Actions for ${entry.candidate.title}`}
                        className={cn("-mt-2 -mr-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
                      >
                        <MoreHorizontal className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    }
                  >
                    <ActionMenuItem onSelect={() => setSwapping(swapping === index ? undefined : index)}>
                      <ArrowRightLeft className="size-[18px] shrink-0 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
                      {swapping === index ? "Keep this one" : "Swap for something else"}
                    </ActionMenuItem>
                  </ActionMenu>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[13px] leading-5 text-paper-sage">
        {day.pickedBy === "hermes" ? "Picked by Hermes from AgentOS' shortlist." : (day.pickNote ?? "Picked by AgentOS' rules.")}
      </p>
      {done.error ?? swap.error ? (
        <p role="alert" className="mt-1 text-[13px] leading-5 text-paper-flame-deep">
          {(done.error ?? swap.error)?.message}
        </p>
      ) : null}
    </PaperSection>
  );
}
