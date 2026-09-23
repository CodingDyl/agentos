import type { WorkSessionSummary } from "@shared/agentos-types";
import { EmptyState, HairlineCard, SectionLabel } from "@/components/os";

export interface ProjectSessionsProps {
  sessions: WorkSessionSummary[];
}

interface SessionListProps {
  label: string;
  items?: string[];
  tone?: "muted" | "danger";
}

function SessionList({ label, items, tone = "muted" }: SessionListProps) {
  if (!items || items.length === 0) return null;

  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className={
              tone === "danger"
                ? "text-[15px] leading-6 text-os-danger"
                : "text-[15px] leading-6 text-os-muted"
            }
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The most recent `/stop-work` sessions. Recent history, not an archive. */
export function ProjectSessions({ sessions }: ProjectSessionsProps) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        label="No sessions recorded"
        description="Stopping a work session writes a log here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="os-meta text-os-subtle">
        {sessions.length} recent {sessions.length === 1 ? "session" : "sessions"}
      </p>

      {sessions.map((session) => (
        <HairlineCard key={session.date} className="p-5 md:p-6">
          <h3 className="os-meta text-foreground">{session.date}</h3>

          <div className="mt-6 space-y-6">
            <SessionList label="Completed" items={session.completed} />
            <SessionList label="Still open" items={session.stillOpen} />
            <SessionList label="Blockers" items={session.blockers} tone="danger" />

            {session.resumeHere ? (
              <div>
                <SectionLabel>Resume here</SectionLabel>
                <p className="mt-3 max-w-[68ch] text-[15px] leading-6 text-foreground">
                  {session.resumeHere}
                </p>
              </div>
            ) : null}
          </div>
        </HairlineCard>
      ))}
    </div>
  );
}
