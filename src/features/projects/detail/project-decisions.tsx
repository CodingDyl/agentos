import type { ProjectDecision } from "@shared/agentos-types";
import { EmptyState, HairlineCard, SectionLabel } from "@/components/os";

export interface ProjectDecisionsProps {
  decisions: ProjectDecision[];
}

/** Durable decisions, one line each. Never a markdown dump. */
export function ProjectDecisions({ decisions }: ProjectDecisionsProps) {
  if (decisions.length === 0) {
    return (
      <EmptyState
        label="No decisions recorded"
        description="Durable decisions captured in DECISIONS.md will appear here."
      />
    );
  }

  return (
    <HairlineCard className="overflow-hidden">
      <ul className="divide-y divide-os-border">
        {decisions.map((decision) => (
          <li key={decision.title} className="px-5 py-5 md:px-6">
            <SectionLabel>{decision.title}</SectionLabel>
            {decision.detail ? (
              <p className="mt-3 max-w-[72ch] text-[15px] leading-6 text-os-muted">
                {decision.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </HairlineCard>
  );
}
