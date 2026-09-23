import { Command as CommandIcon } from "lucide-react";
import type { AgentSkill } from "@shared/agentos-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import { buildQuickCommands, overflowCount } from "./command-catalog";

export interface AgentQuickActionsProps {
  /** Skills discovered from Hermes. The baseline is used when absent. */
  skills?: AgentSkill[];
  /**
   * False once discovery has settled on nothing — the commands shown are the
   * built-in baseline. Left true while it is still in flight, so the console
   * never claims a failure it has not seen.
   */
  discovered?: boolean;
  project?: string;
  onRun: (command: string) => void;
  /** Opens the command palette, where every other skill lives. */
  onBrowse?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The prominent commands.
 *
 * Which skills exist is Hermes' answer, not this component's — but not every
 * skill earns a permanent button, so the rest stay one keystroke away in the
 * palette.
 */
export function AgentQuickActions({
  skills,
  discovered = true,
  project,
  onRun,
  onBrowse,
  disabled = false,
  className,
}: AgentQuickActionsProps) {
  const commands = buildQuickCommands(skills, project);
  const overflow = overflowCount(skills);

  return (
    <div className={cn("min-w-0", className)}>
      <SectionLabel
        action={
          discovered ? null : (
            // Said plainly rather than implied: Hermes named none of these.
            <span className="text-os-subtle">Baseline commands</span>
          )
        }
      >
        Quick commands
      </SectionLabel>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {commands.map((quick) => (
          <CommandButton
            key={quick.command}
            variant="secondary"
            disabled={disabled || quick.disabled}
            title={
              quick.disabled
                ? "Select a project context first"
                : (quick.description ?? `Runs ${quick.command}`)
            }
            onClick={() => onRun(quick.command)}
          >
            {quick.label}
          </CommandButton>
        ))}

        {onBrowse ? (
          <CommandButton
            variant="quiet"
            icon={CommandIcon}
            iconPosition="start"
            onClick={onBrowse}
            title="Open the command palette (⌘K)"
          >
            {overflow > 0 ? `${overflow} more` : "All commands"}
          </CommandButton>
        ) : null}
      </div>
    </div>
  );
}
