import { Check, ChevronDown, CircleDot, Circle, X } from "lucide-react";
import { useState } from "react";
import { SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import type { ActivityState, RunState } from "./run-events";

const STEP_ICON = {
  running: CircleDot,
  complete: Check,
  error: X,
} as const;

const STEP_TONE: Record<ActivityState, string> = {
  running: "text-os-amber",
  complete: "text-os-success",
  error: "text-os-danger",
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
    <li
      className={cn(
        "flex min-h-8 items-center gap-3 text-[13px] leading-5",
        nested && "ps-5",
      )}
    >
      {nested ? (
        <span className="font-mono text-os-subtle" aria-hidden="true">
          └
        </span>
      ) : null}
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          STEP_TONE[state],
          state === "running" && "motion-safe:animate-pulse",
        )}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          state === "running" ? "text-foreground" : "text-os-muted",
        )}
      >
        {label}
      </span>
      <span className="os-meta shrink-0 text-os-subtle">{state}</span>
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
export function AgentActivityPanel({
  state,
  isRunning,
  showUnrecognised = false,
  className,
}: AgentActivityPanelProps) {
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
    <section className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="os-focus-ring flex w-full cursor-pointer items-center justify-between gap-4 rounded-md py-1"
      >
        <SectionLabel>Activity</SectionLabel>
        <span className="os-meta flex shrink-0 items-center gap-2 text-os-subtle">
          {total} {total === 1 ? "event" : "events"}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
        </span>
      </button>

      {isOpen ? (
        <ul className="mt-3 space-y-0.5 border-t border-os-border pt-3">
          {state.steps.map((step) => (
            <ActivityLine key={step.id} label={step.label} state={step.state} />
          ))}
          {state.subagents.map((agent) => (
            <ActivityLine
              key={agent.name}
              label={agent.name}
              state={agent.state}
              nested
            />
          ))}

          {showUnrecognised && state.unrecognised.length > 0 ? (
            <li className="os-meta pt-3 text-os-subtle">
              {state.unrecognised.length} unrecognised{" "}
              {state.unrecognised.length === 1 ? "event" : "events"}:{" "}
              {[...new Set(state.unrecognised.map((event) => event.type))].join(", ")}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
