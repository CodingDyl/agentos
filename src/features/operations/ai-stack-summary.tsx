import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Section } from "@/components/os";
import { useAiStack } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_LABELS, summarise } from "./ai-stack-model";

/**
 * The AI stack, on Mission Control.
 *
 * One line of names and dots, and a link. The question here is small — *is
 * everything AgentOS depends on switched on and reachable?* — and anything
 * more (usage, plans, evidence) belongs to the AI Stack tab it points at.
 *
 * Amber only when something connected is actually unavailable; a switch the
 * operator turned off on purpose is not asking for anything.
 */
export function AiStackSummary() {
  const { data } = useAiStack();

  if (!data || data.entries.length === 0) return null;

  const counts = summarise(data.entries);
  const connected = data.entries.filter((entry) => entry.toggleable);

  return (
    <Section
      label="AI stack"
      action={
        <Link
          to="/operations?tab=stack"
          className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-2 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          AI Stack
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <ul className="flex flex-wrap gap-x-6 gap-y-3">
        {connected.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 text-[15px] leading-6" title={entry.statusReason}>
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[entry.status])} aria-hidden="true" />
            <span className={entry.status === "live" ? "text-foreground" : "text-os-muted"}>{entry.name}</span>
            {entry.status !== "live" ? (
              <span className={cn("os-meta", entry.status === "unavailable" ? "text-os-warning" : "text-os-subtle")}>
                {STATUS_LABELS[entry.status]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[13px] leading-5 text-os-subtle">
        {counts.live} of {connected.length} live in AgentOS
        {counts.notConnected > 0 ? ` · ${counts.notConnected} more on this machine, not connected` : ""}
      </p>
    </Section>
  );
}
