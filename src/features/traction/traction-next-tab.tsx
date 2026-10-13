import type { ReactNode } from "react";
import { vettingOf, type TractionData } from "@shared/traction-types";
import { PAPER_FOCUS, PaperSection } from "@/components/paper";
import { useFollowUps } from "@/lib/agentos/outreach";
import { cn } from "@/lib/utils";
import { TractionMailSuggestions } from "./traction-mail-suggestions";
import { queueProgress, type TractionTab } from "./traction-model";
import { Goal, NeedsAttention } from "./traction-overview-tab";
import { TractionQueue } from "./traction-queue";

/**
 * Next up: what to do right now, and nothing else.
 *
 * The goal for the week, one line saying where the work is piling up (to
 * check, to write, to follow up), and today's queue. Everything that happened
 * and everything that can be configured lives elsewhere.
 */
export function TractionNextTab({ data, onTab }: { data: TractionData; onTab: (tab: TractionTab) => void }) {
  const followUps = useFollowUps();
  const progress = queueProgress(data);

  const toCheck = data.prospects.filter((prospect) => prospect.stage === "target" && vettingOf(prospect) === undefined).length;
  const toWrite = data.prospects.filter((prospect) => prospect.stage === "target" && vettingOf(prospect) === "can_help").length;
  const due = followUps.data?.filter((row) => row.state === "due").length;

  return (
    <div className="max-w-[60rem] space-y-10">
      <Goal data={data} />

      <div className="grid gap-3 sm:grid-cols-3" aria-label="Where the work is">
        <Step count={toCheck} label="to check" hint="Look at their website, decide if you can help" onClick={() => onTab("find")} />
        <Step count={toWrite} label="ready to email" hint="You said you can help" onClick={() => onTab("outreach")} />
        <Step count={due} label="follow-ups due" hint="Contacted, no answer yet" onClick={() => onTab("follow-ups")} />
      </div>

      <TractionMailSuggestions data={data} />

      <PaperSection
        label="Today"
        count={data.queue.length}
        action={
          progress.total > 0 ? (
            <span className="text-[12.5px] font-medium tracking-[0.04em] text-paper-sage uppercase tabular-nums" aria-live="polite">
              {progress.done} / {progress.total} complete
            </span>
          ) : null
        }
      >
        <TractionQueue data={data} />
      </PaperSection>

      <NeedsAttention data={data} />
    </div>
  );
}

function Step({ count, label, hint, onClick }: { count: number | undefined; label: string; hint: string; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("cursor-pointer border border-paper-mist bg-paper-white px-4 py-3 text-left transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
    >
      <span className="block font-paper-display text-[26px] leading-8 font-bold text-paper-moss tabular-nums">{count ?? "–"}</span>
      <span className="block text-[13.5px] font-semibold text-paper-moss">{label}</span>
      <span className="block text-[12.5px] text-paper-sage">{hint}</span>
    </button>
  );
}
