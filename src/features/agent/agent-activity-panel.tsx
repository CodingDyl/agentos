import { Check, ChevronDown, CircleDot, Circle, X } from "lucide-react";
import { useState } from "react";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";
import type { ActivityState, RunState } from "./run-events";

const STEP_ICON = {
  running: CircleDot,
  complete: Check,
  error: X,
} as const;

const STEP_TONE: Record<ActivityState, string> = {
  running: "text-paper-amber-deep",
  complete: "text-paper-char",
  error: "text-paper-flame-deep",
};

interface ActivityLineProps {
  label: string;
  state: ActivityState;
  /** Draws the tree connector used for delegated subagents. */
  nested?: boolean;
}

function ActivityLine({ label, state, nested = false }: ActivityLineProps) {
  const Icon = STEP_ICON[state] ?? Circle;

  return (
    <li className={cn("flex min-h-8 items-center gap-3 text-[13.5px] leading-5", nested && "ps-5")}>
      {nested ? (
        <span className="font-mono text-paper-sage" aria-hidden="true">
          └
        </span>
      ) : null}
      <Icon
        className={cn("size-3.5 shrink-0", STEP_TONE[state], state === "running" && "motion-safe:animate-pulse")}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className={cn("min-w-0 flex-1 truncate", state === "running" ? "font-medium text-paper-moss" : "text-paper-char")}>
        {label}
      </span>
      <span className="shrink-0 text-[12.5px] text-paper-sage">{state}</span>
    </li>
  );
}

export interface AgentActivityPanelProps {
  state: RunState;
  isRunning: boolean;
  /** Shows events the console has no specific handling for. */
  showUnrecognised?: boolean;
  className?: string;
}

/**
 * What Hermes is doing. Expanded while a run is live, collapsed once it ends so
 * a finished transcript does not stay noisy.
 */
export function AgentActivityPanel({ state, isRunning, showUnrecognised = false, className }: AgentActivityPanelProps) {
  // Expanded while running, collapsed when the run ends — but a manual toggle
  // still wins until the run state changes again. Adjusted during render rather
  // than in an effect, so there is no extra pass.
  const [isOpen, setIsOpen] = useState(isRunning);
  const [wasRunning, setWasRunning] = useState(isRunning);

  if (wasRunning !== isRunning) {
    setWasRunning(isRunning);
    setIsOpen(isRunning);
  }

  const total = state.steps.length + state.subagents.length;
  if (total === 0) return null;

  return (
    <section aria-label="Activity" className={cn("min-w-0 rounded-[4px] border border-paper-mist", className)}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-4 rounded-[4px] px-4 py-2.5 transition-colors duration-150 hover:bg-paper-cream",
          PAPER_FOCUS,
        )}
      >
        <span className="text-[13.5px] font-semibold text-paper-moss">Activity</span>
        <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-paper-sage">
          {total} {total === 1 ? "event" : "events"}
          <ChevronDown className={cn("size-3.5 transition-transform duration-150", isOpen && "rotate-180")} aria-hidden="true" />
        </span>
      </button>

      {isOpen ? (
        <ul className="space-y-0.5 border-t border-paper-mist px-4 py-3">
          {state.steps.map((step) => (
            <ActivityLine key={step.id} label={step.label} state={step.state} />
          ))}
          {state.subagents.map((agent) => (
            <ActivityLine key={agent.name} label={agent.name} state={agent.state} nested />
          ))}

          {showUnrecognised && state.unrecognised.length > 0 ? (
            <li className="pt-3 text-[12.5px] text-paper-sage">
              {state.unrecognised.length} unrecognised {state.unrecognised.length === 1 ? "event" : "events"}:{" "}
              {[...new Set(state.unrecognised.map((event) => event.type))].join(", ")}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
