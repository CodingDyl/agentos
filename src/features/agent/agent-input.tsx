import { useState } from "react";
import type { AgentSkill } from "@shared/agentos-types";
import { AgentCommandInput } from "@/components/os";
import { buildCommands, searchCommands } from "./command-catalog";

export interface AgentInputProps {
  onSubmit: (message: string) => void;
  /** Skills discovered from Hermes. The baseline is used when absent. */
  skills?: AgentSkill[];
  /** Project slug shown as the input's active context. */
  projectSlug?: string;
  projectName?: string;
  running?: boolean;
  /** A run is live and accepting guidance, so input steers instead of sending. */
  isSteering?: boolean;
  disabled?: boolean;
  className?: string;
}

/** How many suggestions the input offers before the palette is the better tool. */
const MAX_SUGGESTIONS = 6;

/**
 * The console's command line. Wraps the design system's `AgentCommandInput` and
 * offers the skills Hermes reported as slash suggestions, narrowed as you type.
 */
export function AgentInput({
  onSubmit,
  skills,
  projectSlug,
  projectName,
  running = false,
  isSteering = false,
  disabled = false,
  className,
}: AgentInputProps) {
  const [value, setValue] = useState("");

  const typed = value.trimStart();
  const isCommand = typed.startsWith("/");

  const suggestions = isCommand
    ? searchCommands(buildCommands(skills, projectSlug), typed, {
        project: projectSlug,
      })
        .slice(0, MAX_SUGGESTIONS)
        .map((command) => ({
          command: command.command,
          description: command.description ?? command.label,
        }))
    : [];

  return (
    <AgentCommandInput
      className={className}
      value={value}
      onValueChange={setValue}
      onSubmit={(submitted) => {
        onSubmit(submitted);
        setValue("");
      }}
      placeholder={
        isSteering ? "Steer the active run…" : "Ask Hermes or run a command…"
      }
      activeContext={
        isSteering ? `Steering / ${projectName ?? "active run"}` : projectName
      }
      suggestions={isSteering ? [] : suggestions}
      showSuggestions={!isSteering && isCommand}
      running={running}
      disabled={disabled}
    />
  );
}
