import { Check, Circle, CircleAlert, X } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-label";
import { StatusPill } from "./status-pill";

export type AgentActivityStepState =
  | "complete"
  | "current"
  | "pending"
  | "error";

export interface AgentActivityStep {
  id: string;
  label: string;
  detail?: string;
  state: AgentActivityStepState;
}

export interface AgentActivityProps extends HTMLAttributes<HTMLDivElement> {
  steps: AgentActivityStep[];
  title?: string;
  running?: boolean;
}

const stepIcons = {
  complete: Check,
  current: CircleAlert,
  pending: Circle,
  error: X,
};

const stepColors: Record<AgentActivityStepState, string> = {
  complete: "text-os-success",
  current: "text-os-amber",
  pending: "text-os-subtle",
  error: "text-os-danger",
};

export function AgentActivity({
  steps,
  title = "Agent activity",
  running = false,
  className,
  ...props
}: AgentActivityProps) {
  return (
    <div className={cn("p-5 md:p-6", className)} {...props}>
      <div className="flex items-center justify-between gap-4">
        <SectionLabel>{title}</SectionLabel>
        <StatusPill status={running ? "running" : "paused"} />
      </div>
      <ol className="mt-6 space-y-1" aria-label={title}>
        {steps.map((step) => {
          const StepIcon = stepIcons[step.state];
          return (
            <li
              key={step.id}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-sm px-2 text-[13px]",
                step.state === "current" && "bg-os-amber/5",
              )}
            >
              <StepIcon
                className={cn(
                  "size-3.5 shrink-0",
                  stepColors[step.state],
                  step.state === "current" && "motion-safe:animate-pulse",
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 text-os-muted",
                  step.state === "current" && "text-foreground",
                  step.state === "error" && "text-os-danger",
                )}
              >
                {step.label}
              </span>
              {step.detail ? (
                <span className="os-meta hidden text-os-subtle sm:inline">
                  {step.detail}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
