import { ActionLink, EmptyState, Section } from "@/components/os";
import type { NextAction as NextActionModel } from "./dashboard-model";

export interface NextActionProps {
  /** Absent when no project surfaces a concrete next task. */
  action?: NextActionModel;
  onRun: (command: string) => void;
  className?: string;
}

/**
 * One concrete thing to do next. The sentence itself is the control, and it
 * names the command it will run — second in hierarchy only to the primary focus.
 */
export function NextAction({ action, onRun, className }: NextActionProps) {
  return (
    <Section label="Next action" className={className}>
      {action ? (
        <ActionLink
          size="lg"
          tone="strong"
          variant="block"
          hint={<>Runs {action.command}</>}
          onClick={() => onRun(action.command)}
        >
          {action.label}
        </ActionLink>
      ) : (
        <EmptyState
          variant="inline"
          description="No task is queued. Promote one into a project's Now list."
        />
      )}
    </Section>
  );
}
