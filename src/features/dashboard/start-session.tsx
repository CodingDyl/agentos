import { ArrowRight } from "lucide-react";
import { CommandButton } from "@/components/os";
import { cn } from "@/lib/utils";

export interface StartSessionProps {
  /** The Hermes command the agent console will prepare. */
  command?: string;
  onStart: (command: string) => void;
  className?: string;
}

/**
 * The dashboard's primary action. Opens the agent console with the focused
 * project in context — the command is prepared there, never sent from here.
 */
export function StartSession({ command, onStart, className }: StartSessionProps) {
  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      <CommandButton
        variant="primary"
        icon={ArrowRight}
        disabled={!command}
        onClick={() => command && onStart(command)}
      >
        Start session
      </CommandButton>
      {/* Space is reserved so the disabled explanation never shifts layout. */}
      <p className="os-meta min-h-4 text-os-subtle">
        {command ? null : "No project available"}
      </p>
    </div>
  );
}
