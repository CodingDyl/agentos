import { ArrowRightLeft, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { FocusToday } from "@shared/focus-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useMarkDone, useSwapPick } from "@/lib/agentos/focus";
import { cn } from "@/lib/utils";

/**
 * Today's three, at the top of Today. Tick one off and it is ticked in its
 * workspace or area too; swap any of them for something else on the
 * shortlist.
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
        <div className="border border-dashed border-paper-mist bg-paper-cream px-5 py-5">
          <p className="text-[14px] leading-6 text-paper-char">
            {day.skipped ? "You skipped this morning's check-in." : "No plan for today yet."} Thirty seconds, and Hermes picks the three things that matter most today.
          </p>
          <PaperButton variant="amber" className="mt-3" onClick={onCheckIn}>
            Check in
          </PaperButton>
        </div>
      </PaperSection>
    );
  }

  const others = shortlist.filter((candidate) => !day.picks.some((entry) => entry.candidate.id === candidate.id));

  return (
    <PaperSection
      label="Your three"
      className={className}
      action={
        <span className="text-[12.5px] font-medium tracking-[0.04em] text-paper-sage uppercase tabular-nums" aria-live="polite">
          {finished} / {day.picks.length} done
        </span>
      }
    >
      <ol className="divide-y divide-paper-mist border-y border-paper-mist">
        {day.picks.map((entry, index) => {
          const isDone = day.done.includes(entry.candidate.id);
          return (
            <li key={entry.candidate.id} className="py-3.5">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`${isDone ? "Not done" : "Done"}: ${entry.candidate.title}`}
                  disabled={done.isPending}
                  onClick={() => done.mutate({ candidateId: entry.candidate.id, done: !isDone })}
                  className={cn(
                    "mt-0.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-none border-[1.5px] transition-colors duration-150",
                    isDone ? "border-paper-green bg-paper-green text-paper-white" : "border-paper-blue hover:bg-paper-linen",
                    PAPER_FOCUS,
                  )}
                >
                  {isDone ? <Check className="size-4" aria-hidden="true" /> : <span className="text-[12px] font-bold text-paper-blue tabular-nums">{index + 1}</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[15.5px] leading-6 font-semibold", isDone ? "text-paper-sage line-through" : "text-paper-moss")}>
                    {entry.candidate.href ? (
                      <Link to={entry.candidate.href} className={cn("hover:underline", PAPER_FOCUS)}>
                        {entry.candidate.title}
                      </Link>
                    ) : (
                      entry.candidate.title
                    )}
                  </p>
                  <p className="text-[13.5px] leading-5 text-paper-char">{entry.why}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-paper-sage">
                    <Tag>{entry.candidate.source}</Tag>
                    {entry.candidate.goalId ? <span>{entry.candidate.goalId}</span> : null}
                    {others.length > 0 && !isDone ? (
                      <button
                        type="button"
                        onClick={() => setSwapping(swapping === index ? undefined : index)}
                        className={cn("inline-flex cursor-pointer items-center gap-1 hover:text-paper-moss hover:underline", PAPER_FOCUS)}
                      >
                        <ArrowRightLeft className="size-3" aria-hidden="true" />
                        Swap
                      </button>
                    ) : null}
                  </p>
                  {swapping === index ? (
                    <label className="mt-2 block max-w-[480px]">
                      <span className="sr-only">Swap for</span>
                      <select
                        defaultValue=""
                        disabled={swap.isPending}
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
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[12px] text-paper-sage">
        {day.pickedBy === "hermes" ? "Picked by Hermes from AgentOS' shortlist." : (day.pickNote ?? "Picked by AgentOS' rules.")}
      </p>
      {done.error ?? swap.error ? (
        <p role="alert" className="mt-1 text-[13px] text-paper-flame-deep">
          {(done.error ?? swap.error)?.message}
        </p>
      ) : null}
    </PaperSection>
  );
}
