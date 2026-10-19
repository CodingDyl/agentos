import { Link } from "react-router-dom";
import { useAgents } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { PAPER_FOCUS } from "@/components/paper";

/**
 * Which specialist owns this job.
 *
 * Looks the id up on the roster so a card can show a name without each
 * screen fetching the registry itself.
 */
export function AgentChip({
  agentId,
  className,
  tone = "paper",
  linked = true,
}: {
  agentId?: string;
  className?: string;
  tone?: "paper" | "os";
  /** False when this chip sits inside another link. */
  linked?: boolean;
}) {
  const agents = useAgents().data?.agents;
  if (!agentId) return null;
  const agent = agents?.find((entry) => entry.id === agentId);

  const label = agent ? `${agent.avatar} ${agent.name}` : agentId;
  const styles =
    tone === "os"
      ? "os-meta text-os-subtle"
      : "text-paper-sage";

  if (!linked) {
    return (
      <span className={cn(styles, className)} title={agent?.role}>
        {label}
      </span>
    );
  }

  return (
    <Link
      to={`/agents/${agentId}`}
      className={cn(
        styles,
        tone === "os" ? "os-focus-ring rounded-sm hover:text-foreground" : cn("rounded-[2px] hover:text-paper-moss", PAPER_FOCUS),
        className,
      )}
      title={agent?.role}
    >
      {label}
    </Link>
  );
}
