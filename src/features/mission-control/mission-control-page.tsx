import { CollectiveArtwork, DecorativeTape, PaperLabel } from "@/components/collective/collective-identity";
import { FileText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { MissionControlData } from "@shared/mission-control-types";
import { AppShell, DedsecLoader } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperSection, PaperStage, SegmentedControl } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatTime, sourceLabel, toneFor } from "@/features/activity";
import { UsageSummary } from "@/features/operations";
import { documentHref, TYPE_LABELS } from "@/features/projects/documents-model";
import { FinanceToday } from "@/features/finance";
import { CareerToday } from "@/features/career";
import { TractionToday } from "@/features/traction";
import { FrictionButton, SprintScorecard } from "@/features/validation";
import { formatRelativeTime } from "@/lib/format";
import {
  useMissionControl,
  useProjects,
  useRecentDocuments,
  useValidationSprint,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { ActiveWorkList } from "./active-work-list";
import { AttentionList } from "./attention-list";
import { dashboardCardClass } from "./dashboard-layout";
import { FocusBlock } from "./focus-block";
import { degradedSources, formatToday, greeting, isEvening } from "./mission-control-model";
import { RevenueStrip } from "./revenue-strip";
import { TodayStrip, TodayWorkspaces } from "./today";
import { TodayCaptured } from "./today-captured";
import { CompassRail } from "./compass-rail";
import { MorningMode } from "./morning-mode";
import { TodayTodos } from "./today-todos";
import { YourThree } from "./your-three";
import { useFocusToday } from "@/lib/agentos/focus";
import { useCaptureTriage } from "@/lib/agentos/capture-triage";
import { DayWrapUp, MorningPlan } from "./today-day";
import { OverviewCalendar, TodayScheduledTasks } from "@/features/calendar/overview-calendar";
import { TodayLink } from "./today-kit";
import { TodayNews, TodayTrending } from "./today-world";

/**
 * Dashboard (Mission Control).
 *
 * Where the day starts. One page that answers, in about ten seconds: what does
 * today look like, what needs me, what am I focused on, which work needs
 * movement, what is running, and what changed.
 *
 * Full-width dense grid: columns arrive as the viewport grows, urgent cards
 * sit top-left and span two columns, live work next, everything else packs
 * with `grid-auto-flow: dense`. Designed for an ultrawide as much as a laptop.
 *
 * The day has two ends. Until 5pm the plan leads; from 5pm the wrap does.
 * Either can be picked by hand from the header.
 */

/** Enough history to see the shape of the morning, not enough to be a feed. */
const ACTIVITY_LIMIT = 8;

export function MissionControlPage() {
  const { data, isPending, isFetching, error, refetch } = useMissionControl();
  const navigationItems = useNavigationItems();

  const running = (data?.activeWork.length ?? 0) > 0;

  return (
    <AppShell
      navigationItems={navigationItems}
      // Kept as `mission-control`: visual verification routes name it.
      pageId="mission-control"
      activeHref="/"
      agentState={running ? "running" : "idle"}
      agentLabel={running ? "Agents / running" : "Agents / idle"}
      contextLabel={data?.focus?.project ? `Context / ${data.focus.project}` : undefined}
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage full>
        {isPending ? (
          <DedsecLoader variant="page" />
        ) : !data ? (
          <div>
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.015em]">Your day couldn't be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
              {error?.message ?? "The server didn't answer."} Check that the AgentOS server is running.
            </p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <MissionControl data={data} />
        )}
      </PaperStage>
    </AppShell>
  );
}

function MissionControl({ data }: { data: MissionControlData }) {
  const degraded = degradedSources(data.sources);
  const { data: sprint } = useValidationSprint();
  // The same list the Captured section sorts, so the strip and the section always agree.
  const { data: triage } = useCaptureTriage();
  // The whole portfolio, not Mission Control's live subset: a low-priority
  // workspace's Now tasks are still planned for today.
  const { data: portfolio } = useProjects();
  const projects = portfolio?.projects ?? data.projects;
  const captured = triage?.items ?? [];
  const [mode, setMode] = useState<"plan" | "wrap">(() => (isEvening() ? "wrap" : "plan"));
  const focus = useFocusToday();
  // "auto" shows morning mode only while today has no check-in; "open" keeps it up through the plan.
  const [morning, setMorning] = useState<"auto" | "open" | "closed">("auto");
  const needsCheckIn = Boolean(focus.data && !focus.data.day.checkIn && !focus.data.day.skipped);
  const showMorning = Boolean(focus.data) && (morning === "open" || (morning === "auto" && needsCheckIn));

  return (
    <>
      {showMorning && focus.data ? <MorningMode today={focus.data} onStart={() => setMorning("open")} onClose={() => setMorning("closed")} /> : null}
      <header className="collective-hero">
        <div className="collective-hero-copy">
        <div>
          <h1><PaperLabel>Dashboard</PaperLabel></h1>
          <DecorativeTape />
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-[16px] font-medium text-paper-moss">{greeting("Dylan")}</p>
            <p className="font-mono text-[12px] text-paper-sage">{formatToday()}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Dashboard view"
            value={mode}
            onChange={setMode}
            options={[
              { value: "plan", label: "Plan the day" },
              { value: "wrap", label: "Wrap up" },
            ]}
          />
          {/* Reachable from the screen the day starts on, because friction is
              most often noticed on the way somewhere. */}
          <FrictionButton surface="mission-control" paper />
        </div>
        </div>
        <CollectiveArtwork />
      </header>

      {degraded.length > 0 ? (
        <p role="status" className="mt-2 max-w-[80ch] text-[13.5px] leading-5 text-paper-flame-deep">
          {degraded.join(", ")} could not be read, so parts of this page are incomplete.
        </p>
      ) : null}

      <TodayStrip
        projects={projects}
        attention={data.attention.length}
        running={data.activeWork.length}
        captures={captured}
        className="mt-3"
      />

      <div className="dashboard-grid">
        <RevenueStrip />
        <AttentionList
          items={data.attention}
          dismissed={data.dismissed}
          workers={data.workers}
          className={dashboardCardClass("inbox")}
        />
        {focus.data ? (
          <YourThree today={focus.data} onCheckIn={() => setMorning("open")} className={dashboardCardClass("yourThree")} />
        ) : null}
        {focus.data ? <TodayTodos today={focus.data} className={dashboardCardClass("todos")} /> : null}
        <TodayScheduledTasks className={dashboardCardClass("scheduled")} />
        {mode === "wrap" ? (
          <DayWrapUp className={dashboardCardClass("dayPlan")} />
        ) : (
          <MorningPlan className={dashboardCardClass("dayPlan")} />
        )}
        {data.focus ? <FocusBlock focus={data.focus} className={dashboardCardClass("focus")} /> : null}
        <ActiveWorkList items={data.activeWork} className={dashboardCardClass("activeWork")} />
        <CompassRail className={dashboardCardClass("compass")} />
        <OverviewCalendar className={dashboardCardClass("overviewCalendar")} />
        <TodayWorkspaces projects={projects} focus={data.focus?.projectSlug} className={dashboardCardClass("workspaces")} />
        <TractionToday className={dashboardCardClass("traction")} />
        <CareerToday className={dashboardCardClass("career")} />
        <FinanceToday className={dashboardCardClass("finance")} />
        <TodayCaptured className={dashboardCardClass("captured")} />
        <RecentActivity data={data} className={dashboardCardClass("activity")} />
        <UsageSummary className={dashboardCardClass("usage")} />
        <RecentDocuments className={dashboardCardClass("documents")} />
        <TodayNews className={dashboardCardClass("news")} />
        <TodayTrending className={dashboardCardClass("trending")} />
        {sprint && sprint.scorecard.tasksAttempted > 0 ? (
          <SprintScorecard sprint={sprint} className={dashboardCardClass("scorecard")} />
        ) : null}
      </div>
    </>
  );
}

const TONE_DOT = {
  active: "bg-paper-amber",
  success: "bg-paper-green",
  warning: "bg-paper-marigold",
  danger: "bg-paper-flame",
} as const;

/**
 * The last few things that happened, read from the same payload as the rest
 * of the page so the sections always agree. A glance, then a link to the
 * place that does auditing.
 */
function RecentActivity({ data, className }: { data: MissionControlData; className?: string }) {
  const events = data.recentActivity.slice(0, ACTIVITY_LIMIT);

  return (
    <PaperSection label="Recent activity" className={className} action={<TodayLink to="/activity">All activity</TodayLink>}>
      {events.length === 0 ? (
        <p className="text-[14px] text-paper-char">
          {data.sources.activity === "ready" ? "Nothing has happened yet today." : "The activity timeline couldn't be read."}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {events.map((event) => {
            const tone = toneFor(event);
            return (
              <li key={event.id} className="flex min-w-0 items-baseline gap-3">
                <span className="w-11 shrink-0 text-[12.5px] text-paper-sage tabular-nums">{formatTime(event.timestamp)}</span>
                <span
                  className={cn(
                    "size-1.5 shrink-0 translate-y-[-0.15em] rounded-full",
                    tone in TONE_DOT ? TONE_DOT[tone as keyof typeof TONE_DOT] : "bg-paper-ash",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] text-paper-moss">{event.title}</span>
                <span className="hidden shrink-0 text-[12px] text-paper-sage sm:block">{sourceLabel(event.source)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </PaperSection>
  );
}

/** What was written lately. Absent when there is nothing: a document is worth a glance, not a headline. */
function RecentDocuments({ className }: { className?: string }) {
  const { data } = useRecentDocuments(5);
  const documents = data?.documents ?? [];

  if (documents.length === 0) return null;

  return (
    <PaperSection label="Recent documents" className={className} action={<TodayLink to="/knowledge">Knowledge</TodayLink>}>
      <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
        {documents.map((document) => (
          <li key={`${document.origin}:${document.id}`}>
            <Link
              to={documentHref(document)}
              className={cn("flex min-w-0 items-start gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}
            >
              <FileText className="mt-0.5 size-4 shrink-0 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-paper-moss">{document.title}</span>
                <span className="mt-0.5 block truncate text-[12px] text-paper-sage">
                  {TYPE_LABELS[document.type]}
                  {document.projectName ? ` · ${document.projectName}` : ""}
                  {document.updatedAt ? ` · ${formatRelativeTime(document.updatedAt)}` : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}
