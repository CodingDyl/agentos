import { useMemo, useState } from "react";
import { AppShell } from "@/components/os";
import {
  PaperEmpty,
  PaperError,
  PaperLoading,
  PaperNotice,
  PaperPageHeader,
  PaperSection,
  PaperStage,
} from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useActivity, useProjects } from "@/lib/agentos/queries";
import {
  ActivityFilters,
  type ProjectFilter,
  type SourceFilter,
} from "./activity-filters";
import { groupByDay, sourceLabel } from "./activity-model";
import { ActivityRow } from "./activity-row";

/** One screenful of history. The timeline is a recent view, not an archive. */
const ACTIVITY_LIMIT = 50;

/**
 * What happened across AgentOS.
 *
 * One timeline over four sources: the vault, Hermes, its automations, and the
 * decisions recorded in the UI event store. Nothing here reasons about the
 * events — assembling this costs no model call.
 */
export function ActivityPage() {
  const navigationItems = useNavigationItems();
  const [source, setSource] = useState<SourceFilter>("all");
  const [project, setProject] = useState<ProjectFilter>("all");

  const query = useMemo(
    () => ({
      limit: ACTIVITY_LIMIT,
      source: source === "all" ? undefined : source,
      project: project === "all" ? undefined : project,
    }),
    [source, project],
  );

  const { data, isPending, isFetching, error, refetch } = useActivity(query);
  const { data: projectsData } = useProjects();

  const days = useMemo(() => groupByDay(data?.events ?? []), [data]);
  const isFiltered = source !== "all" || project !== "all";

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="activity"
      activeHref="/activity"
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        {isPending ? (
          <PaperLoading title="Activity" message="Assembling the timeline from the vault, Hermes and automations…" />
        ) : !data ? (
          <PaperError
            title="The activity timeline could not be assembled."
            detail={error?.message}
            hint="The adapter reads the vault, Hermes and its cron history. Check that it is running."
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <PaperPageHeader
              title="Activity"
              description={`Everything you, Hermes, and its automations have done, in one order · ${data.events.length} event${
                data.events.length === 1 ? "" : "s"
              }`}
            />

            <ActivityFilters
              source={source}
              onSourceChange={setSource}
              project={project}
              onProjectChange={setProject}
              projects={projectsData?.projects ?? []}
              className="mt-8"
            />

            {/* A partial timeline says so. Silence would read as "nothing
                happened", which is a different claim entirely. */}
            {data.unavailable.length > 0 ? (
              <PaperNotice className="mt-6 max-w-[72ch]">
                {data.unavailable.map(sourceLabel).join(" and ")} could not be read, so this timeline is incomplete.
              </PaperNotice>
            ) : null}

            {days.length === 0 ? (
              <PaperEmpty
                title="No activity"
                description={
                  isFiltered
                    ? "Nothing matches these filters."
                    : "Nothing has happened yet. Runs, automations and vault changes appear here."
                }
                className="mt-10"
              />
            ) : (
              <div className="mt-10 space-y-10 pb-4">
                {days.map((day) => (
                  <PaperSection key={day.key} label={day.label}>
                    <ul className="divide-y divide-paper-mist overflow-hidden rounded-[4px] border border-paper-mist">
                      {day.events.map((event) => (
                        <ActivityRow key={event.id} event={event} />
                      ))}
                    </ul>
                  </PaperSection>
                ))}
              </div>
            )}
          </>
        )}
      </PaperStage>
    </AppShell>
  );
}
