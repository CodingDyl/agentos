import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AppShell,
  EmptyState,
  ErrorState,
  HairlineCard,
  LoadingState,
  PageHeader,
  SectionLabel,
  SystemIndicator,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useActivity, useProjects } from "@/lib/agentos/queries";
import {
  ActivityFilters,
  type ProjectFilter,
  type SourceFilter,
} from "./activity-filters";
import { groupByDay, sourceLabel } from "./activity-model";
import { ActivityRow } from "./activity-row";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

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
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Activity"
            message="Assembling the timeline…"
            detail="Vault / Hermes / automations"
          />
        ) : !data ? (
          <ErrorState
            label="Timeline unavailable"
            title="Could not assemble the activity timeline."
            detail={error?.message}
            hint="The adapter reads the vault, Hermes and its cron history. Check that it is running."
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <PageHeader
              title="Activity"
              description="Everything you, Hermes, and its automations have done, in one order."
              actions={
                <SystemIndicator
                  state={data.events.length > 0 ? "online" : "idle"}
                  label={`${data.events.length} event${data.events.length === 1 ? "" : "s"}`}
                />
              }
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
              <HairlineCard
                className="mt-8 flex max-w-[72ch] gap-3 p-5 md:p-6"
                role="status"
              >
                <Info
                  className="mt-0.5 size-4 shrink-0 text-os-subtle"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <p className="text-[15px] leading-6 text-os-muted">
                  {data.unavailable.map(sourceLabel).join(" and ")} could not be
                  read, so this timeline is incomplete.
                </p>
              </HairlineCard>
            ) : null}

            {days.length === 0 ? (
              <EmptyState
                label="No activity"
                description={
                  isFiltered
                    ? "Nothing matches these filters."
                    : "Nothing has happened yet. Runs, automations and vault changes appear here."
                }
                className="mt-10"
              />
            ) : (
              <div className="mt-10 space-y-8 pb-4">
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
          </>
        )}
      </div>
    </AppShell>
  );
}
