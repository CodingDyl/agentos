import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/os";
import { navigationItems } from "@/config/navigation";
import { RecentActivity } from "@/features/activity";
import { describeAlert, selectAlerts } from "@/features/automations";
import { useAutomations } from "@/lib/agentos/queries";
import { ActiveProjects } from "./active-projects";
import type { DashboardData } from "./dashboard-model";
import {
  formatDashboardDate,
  selectActiveProjects,
  selectGreeting,
  selectSessionCommand,
} from "./dashboard-selectors";
import { DashboardError, DashboardLoading } from "./dashboard-states";
import { MainFocus } from "./main-focus";
import { NextAction } from "./next-action";
import { RecentProgress } from "./recent-progress";
import { StartSession } from "./start-session";
import { TodaySummary } from "./today-summary";
import { useDashboardData } from "./use-dashboard-data";
import { WatchItem } from "./watch-item";

/** Shared column rhythm: a wide working column and a narrower context rail. */
const columns =
  "grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-x-16";

export function DashboardPage() {
  const { data, isLoading, isFetching, error, refetch } = useDashboardData();
  const navigate = useNavigate();

  const sessionCommand = useMemo(
    () => (data ? selectSessionCommand(data) : undefined),
    [data],
  );

  // Hands off to the agent console with the focused project in context. The
  // console prepares the command; the operator still chooses to run it.
  const openConsole = useCallback(
    (command: string) => {
      const slug = command.split(" ").at(-1) ?? "";
      navigate(`/agent?project=${encodeURIComponent(slug)}`);
    },
    [navigate],
  );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="home"
      activeHref="/"
      contextLabel={
        data?.mainFocus.project
          ? `Context / ${data.mainFocus.project}`
          : undefined
      }
      modelLabel="Model / AgentOS V1"
    >
      {isLoading ? (
        <DashboardLoading />
      ) : !data ? (
        <DashboardError
          error={error}
          onRetry={refetch}
          isRetrying={isFetching}
        />
      ) : (
        <DashboardBody
          data={data}
          sessionCommand={sessionCommand}
          onRunCommand={openConsole}
        />
      )}
    </AppShell>
  );
}

interface DashboardBodyProps {
  data: DashboardData;
  sessionCommand?: string;
  onRunCommand: (command: string) => void;
}

function DashboardBody({
  data,
  sessionCommand,
  onRunCommand,
}: DashboardBodyProps) {
  // Read on its own, so a Hermes that cannot answer costs Home nothing but the
  // automations it would have flagged.
  const { data: automations } = useAutomations();

  const alerts = useMemo(
    () => selectAlerts(automations?.automations ?? []).map((a) => describeAlert(a)),
    [automations],
  );

  const activeProjects = useMemo(
    () => selectActiveProjects(data.projects),
    [data.projects],
  );
  const focusProject = useMemo(
    () =>
      data.projects.find((project) => project.name === data.mainFocus.project),
    [data.projects, data.mainFocus.project],
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-os-border pb-6">
        <h1 className="os-meta text-os-muted">
          {selectGreeting(data.operator)}
        </h1>
        <div className="flex items-baseline gap-4">
          {data.inboxCount > 0 ? (
            <span className="os-meta text-os-muted">
              Inbox / {data.inboxCount}
            </span>
          ) : null}
          <p className="os-meta text-os-subtle">{formatDashboardDate()}</p>
        </div>
      </header>

      <div
        className={`${columns} mt-10 border-b border-os-border pb-10 lg:mt-14 lg:pb-14`}
      >
        <MainFocus focus={data.mainFocus} state={focusProject?.state} />
        <div className="flex flex-col justify-between gap-10">
          <NextAction action={data.nextAction} onRun={onRunCommand} />
          <StartSession command={sessionCommand} onStart={onRunCommand} />
        </div>
      </div>

      <div className={`${columns} mt-10 items-start pb-4 lg:mt-14`}>
        {/* The one section not yet reading from the vault. */}
        <TodaySummary
          items={data.calendar}
          isPlaceholder
          className="lg:col-start-2 lg:row-start-1"
        />
        <ActiveProjects
          projects={activeProjects}
          className="lg:col-start-1 lg:row-start-1"
        />
        <RecentProgress
          progress={data.recentProgress}
          className="lg:col-start-1 lg:row-start-2"
        />
        <WatchItem
          watch={data.watch}
          alerts={alerts}
          className="lg:col-start-2 lg:row-start-2"
        />
        {/* What actually happened, beside what the vault says was achieved. */}
        <RecentActivity className="lg:col-start-1 lg:row-start-3" />
      </div>
    </div>
  );
}
