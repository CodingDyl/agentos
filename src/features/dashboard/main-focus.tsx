import { Section, StatusPill } from "@/components/os";
import { cn } from "@/lib/utils";
import type { FocusSummary, ProjectState } from "./dashboard-model";

export interface MainFocusProps {
  focus: FocusSummary;
  /** State of the project the focus belongs to, when it resolves to one. */
  state?: ProjectState;
  className?: string;
}

/**
 * The loudest thing on the screen: one outcome, at display scale, attributed to
 * the project that owns it.
 */
export function MainFocus({ focus, state, className }: MainFocusProps) {
  return (
    <Section label="Primary focus" className={className}>
      <p className="max-w-[20ch] text-[clamp(2.25rem,3.6vw,3.5rem)] leading-[1.02] font-normal tracking-[-0.03em] text-balance">
        {focus.outcome}
      </p>
      {focus.project ? (
        <div
          className={cn(
            "mt-6 flex flex-wrap items-center gap-x-4 gap-y-2",
            "border-t border-os-border pt-5",
          )}
        >
          <span className="text-[15px] leading-6 text-os-muted">
            {focus.project}
          </span>
          {state ? <StatusPill status={state} /> : null}
        </div>
      ) : null}
    </Section>
  );
}
