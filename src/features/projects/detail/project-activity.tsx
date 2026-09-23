import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { WorkSessionSummary } from "@shared/agentos-types";
import { EmptyState, HairlineCard, Section, SectionLabel } from "@/components/os";
import { ActivityRow, groupByDay } from "@/features/activity";
import { useActivity } from "@/lib/agentos/queries";
import { ProjectSessions } from "./project-sessions";

/**
 * What has happened on this project — the global timeline, filtered, with the
 * work-session logs beneath it.
 *
 * The same rows as the Activity screen, so an event reads identically in both
 * places; the only thing added is the scope. Sessions sit below because they
 * are activity too, just written by `/stop-work` rather than emitted live.
 */
export function ProjectActivity({ slug, sessions }: { slug: string; sessions: WorkSessionSummary[] }) {
  const { data, isPending, error } = useActivity({ project: slug, limit: 60 });

  const days = useMemo(() => groupByDay(data?.events ?? []), [data]);

  return (
    <div className="space-y-12">
      <Section
        label="Timeline"
        action={
          <Link
            to={`/activity?project=${encodeURIComponent(slug)}`}
            className="os-focus-ring os-meta -mx-1 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            All activity →
          </Link>
        }
      >
        {isPending ? (
          <p className="text-[15px] leading-6 text-os-muted">Assembling the timeline…</p>
        ) : error ? (
          <EmptyState variant="inline" description={error.message} />
        ) : days.length === 0 ? (
          <EmptyState
            variant="inline"
            description="Nothing recorded for this project yet. Edits, runs and worker jobs appear here."
          />
        ) : (
          <div className="space-y-8">
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <SectionLabel>{day.label}</SectionLabel>
                <HairlineCard className="mt-4 overflow-hidden">
                  <ul className="divide-y divide-os-border">
                    {day.events.map((event) => (
                      <ActivityRow key={event.id} event={event} />
                    ))}
                  </ul>
                </HairlineCard>
              </section>
            ))}
          </div>
        )}
      </Section>

      <Section label="Work sessions">
        <ProjectSessions sessions={sessions} />
      </Section>
    </div>
  );
}
