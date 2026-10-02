import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ENERGY_LABEL, TIME_LABEL, type Energy, type FocusToday, type TimeAvailable } from "@shared/focus-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useCheckIn, useSkipCheckIn } from "@/lib/agentos/focus";
import { cn } from "@/lib/utils";

/**
 * The first open of the day: a full-screen, 30-second check-in. Three taps,
 * then Hermes picks your three from AgentOS' shortlist and says why. It can
 * be skipped, and comes back tomorrow.
 */
export function MorningMode({ today, onClose, onStart }: { today: FocusToday; onClose: () => void; onStart: () => void }) {
  const checkIn = useCheckIn();
  const skip = useSkipCheckIn();
  const [energy, setEnergy] = useState<Energy>();
  const [time, setTime] = useState<TimeAvailable>();
  const [mind, setMind] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  const planned = checkIn.isSuccess ? checkIn.data.day : undefined;

  useEffect(() => {
    first.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="morning-title" className="fixed inset-0 z-50 overflow-y-auto bg-paper-cream">
      <div className="mx-auto flex min-h-full max-w-[640px] flex-col justify-center px-6 py-12">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-paper-sage">{new Date(`${today.day.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
          {planned ? null : (
            <button
              type="button"
              disabled={skip.isPending || checkIn.isPending}
              onClick={() => skip.mutate(undefined, { onSuccess: onClose })}
              className={cn("cursor-pointer text-[13px] text-paper-sage hover:text-paper-moss hover:underline", PAPER_FOCUS)}
            >
              Skip today
            </button>
          )}
        </div>

        {planned ? (
          <>
            <h1 id="morning-title" className="mt-3 font-paper-display text-[32px] leading-[1.1] font-extrabold tracking-[-0.02em] text-paper-moss">
              Your three for today
            </h1>
            {planned.pickNote ? <p className="mt-2 text-[13px] text-paper-sage">{planned.pickNote}</p> : null}
            <ol className="mt-6 space-y-4">
              {planned.picks.map((entry, index) => (
                <li key={entry.candidate.id} className="flex gap-4">
                  <span className="font-paper-display text-[28px] leading-8 font-extrabold text-paper-blue tabular-nums">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[17px] leading-6 font-semibold text-paper-moss">{entry.candidate.title}</span>
                    <span className="block text-[13.5px] leading-5 text-paper-char">{entry.why}</span>
                    <span className="block text-[12.5px] text-paper-sage">{entry.candidate.source}</span>
                  </span>
                </li>
              ))}
            </ol>
            {planned.picks.length === 0 ? <p className="mt-6 text-[15px] text-paper-char">Nothing on the list today. Capture what is on your mind, or add tasks to a workspace.</p> : null}
            <PaperButton variant="amber" className="mt-8 self-start" onClick={onClose}>
              Start the day
            </PaperButton>
          </>
        ) : (
          <>
            <h1 id="morning-title" className="mt-3 font-paper-display text-[32px] leading-[1.1] font-extrabold tracking-[-0.02em] text-paper-moss">
              {greeting()}, Dylan
            </h1>
            <p className="mt-2 text-[14px] text-paper-char">Three quick answers, then your plan for the day.</p>

            <Question label="1. How is your energy?">
              {(Object.keys(ENERGY_LABEL) as Energy[]).map((value, index) => (
                <Choice key={value} buttonRef={index === 0 ? first : undefined} selected={energy === value} onClick={() => setEnergy(value)}>
                  {ENERGY_LABEL[value]}
                </Choice>
              ))}
            </Question>

            <Question label="2. Time for focused work today?">
              {(Object.keys(TIME_LABEL) as TimeAvailable[]).map((value) => (
                <Choice key={value} selected={time === value} onClick={() => setTime(value)}>
                  {TIME_LABEL[value]}
                </Choice>
              ))}
            </Question>

            <label className="mt-7 block">
              <span className="block text-[15px] font-semibold text-paper-moss">3. Anything on your mind? <span className="font-normal text-paper-sage">Optional</span></span>
              <input
                value={mind}
                maxLength={300}
                onChange={(event) => setMind(event.target.value)}
                placeholder="e.g. Client call at 2, want to finish the outreach flow"
                className={cn(PAPER_INPUT, "mt-2 w-full text-[15px]")}
              />
            </label>

            <PaperButton
              variant="amber"
              className="mt-8 self-start"
              disabled={!energy || !time || checkIn.isPending}
              onClick={() => {
                if (!energy || !time) return;
                // Keeps this screen open once the day has a check-in, so the three can be shown here.
                onStart();
                checkIn.mutate({ energy, time, mind });
              }}
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {checkIn.isPending ? "Hermes is picking your three… (usually under a minute)" : "Plan my day"}
            </PaperButton>
            {checkIn.error ?? skip.error ? (
              <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
                {(checkIn.error ?? skip.error)?.message}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function greeting(hour = new Date().getHours()): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-7">
      <legend className="text-[15px] font-semibold text-paper-moss">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Choice({ selected, onClick, children, buttonRef }: { selected: boolean; onClick: () => void; children: React.ReactNode; buttonRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-11 cursor-pointer rounded-none border-[1.5px] px-5 text-[15px] font-semibold transition-colors duration-150",
        selected ? "border-paper-blue bg-paper-blue text-paper-white" : "border-paper-mist bg-paper-white text-paper-moss hover:border-paper-blue",
        PAPER_FOCUS,
      )}
    >
      {children}
    </button>
  );
}
