import { FileText, MoreHorizontal, MessageSquareWarning } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MissionControlData } from "@shared/mission-control-types";
import { ActionMenu, ActionMenuItem, AppShell, PageLoader } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperSection, PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatTime, sourceLabel, toneFor } from "@/features/activity";
import { UsageSummary } from "@/features/operations";
import { documentHref, TYPE_LABELS } from "@/features/projects/documents-model";
import { FinanceToday } from "@/features/finance";
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
import { IdeasToDecide } from "./ideas-to-decide";
import { TodayNews, TodayTrending } from "./today-world";

/**
 * Dashboard (Mission Control).
 *
 * The first viewport answers three things: what matters today, what needs my
 * approval, and what Hermes recommends next. In reading order, at every width:
 * the summary, any approvals, your three, the morning brief, today's list and
 * the primary focus. Then business pulse and Compass, then everything else the
 * day might want a glance at. DESIGN.md specifies the layout.
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
      agentLabel={running ? "Agents running" : "Agents idle"}
      contextLabel={data?.focus?.project ? `Context / ${data.focus.project}` : undefined}
    >
      <PaperStage>
        {isPending ? (
          <PageLoader variant="page" label="Reading your day…" />
        ) : !data ? (
          <div role="alert">
            <h1>Your day couldn't be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-[22px] text-paper-char">
              {error?.message ?? "The server didn't answer."} Check that the AgentOS server is running.
            </p>
            <PaperButton variant="amber" className="mt-4" disabled={isFetching} onClick={() => void refetch()}>
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
  const [reportingFriction, setReportingFriction] = useState(false);
  const dayPanel = useRef<HTMLDivElement>(null);
  const needsCheckIn = Boolean(focus.data && !focus.data.day.checkIn && !focus.data.day.skipped);
  const showMorning = Boolean(focus.data) && (morning === "open" || (morning === "auto" && needsCheckIn));

  const showDayPanel = () => {
    // After the render that swaps the panel, so focus lands on what is now there.
    requestAnimationFrame(() => {
      dayPanel.current?.scrollIntoView({ block: "nearest" });
      dayPanel.current?.focus({ preventScroll: true });
    });
  };

  // With no three picked yet, planning the day means the check-in that picks
  // them. Otherwise the plan already exists, and this goes to it.
  const planTheDay = () => {
    setMode("plan");
    if (focus.data && focus.data.day.picks.length === 0) setMorning("open");
    else showDayPanel();
  };

  const wrapUp = () => {
    setMode("wrap");
    showDayPanel();
  };

  return (
    <>
      {showMorning && focus.data ? <MorningMode today={focus.data} onStart={() => setMorning("open")} onClose={() => setMorning("closed")} /> : null}

      <header className="qt-page-header">
        <div className="min-w-0">
          <h1>Dashboard</h1>
          <p className="mt-1 text-[14px] leading-[22px] text-paper-char">
            {greeting("Dylan")}
            <span className="text-paper-sage"> · {formatToday()}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" onClick={planTheDay}>
            Plan the day
          </PaperButton>
          <PaperButton variant="ghost" onClick={wrapUp} aria-pressed={mode === "wrap"} className="aria-pressed:bg-selected">
            Wrap up
          </PaperButton>
          <ActionMenu
            trigger={
              <button
                type="button"
                className={cn("inline-flex min-h-[var(--control-height)] cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[14px] leading-5 font-medium text-paper-char transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
              >
                <MoreHorizontal className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
                More
              </button>
            }
          >
            {/* Reachable from the screen the day starts on, because friction is
                most often noticed on the way somewhere. */}
            <ActionMenuItem onSelect={() => setReportingFriction(true)}>
              <MessageSquareWarning className="size-[18px] shrink-0 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
              Report friction
            </ActionMenuItem>
          </ActionMenu>
          <FrictionButton surface="mission-control" paper open={reportingFriction} onOpenChange={setReportingFriction} />
        </div>
      </header>

      {degraded.length > 0 ? (
        <p role="status" className="mt-3 max-w-[80ch] text-[13px] leading-5 text-paper-marigold">
          {degraded.join(", ")} could not be read, so parts of this page are incomplete.
        </p>
      ) : null}

      <TodayStrip
        projects={projects}
        attention={data.attention.length}
        cleared={data.dismissed.length}
        running={data.activeWork.length}
        captures={captured}
      />

      <AttentionList items={data.attention} dismissed={data.dismissed} workers={data.workers} />

      <div className="qt-work">
        {focus.data ? (
          <YourThree today={focus.data} onCheckIn={() => setMorning("open")} className="qt-work-three" />
        ) : (
          <PaperSection label="Your three" className="qt-work-three">
            {focus.isError ? (
              <p role="alert" className="text-[14px] leading-[22px] text-paper-flame-deep">
                Today's three couldn't be read. {focus.error?.message}
              </p>
            ) : (
              <PageLoader variant="compact" label="Reading your three…" />
            )}
          </PaperSection>
        )}
        <div ref={dayPanel} tabIndex={-1} className="qt-work-brief min-w-0 scroll-mt-6 rounded-lg outline-none [&>section]:h-full">
          {mode === "wrap" ? <DayWrapUp /> : <MorningPlan />}
        </div>
        {focus.data ? (
          <TodayTodos today={focus.data} className="qt-work-todos" />
        ) : (
          <PaperSection label="To do today" className="qt-work-todos">
            {focus.isError ? (
              <p className="text-[14px] leading-[22px] text-paper-char">The list couldn't be read.</p>
            ) : (
              <PageLoader variant="compact" label="Reading today's list…" />
            )}
          </PaperSection>
        )}
        {data.focus ? <FocusBlock focus={data.focus} className="qt-work-focus" /> : null}
      </div>

      <RevenueStrip className="mt-6" />
      <CompassRail className="mt-6" />

      <div className="qt-more">
        {/* Videos checked against AgentOS, waiting on Approve or Decline. */}
        <IdeasToDecide />
        <ActiveWorkList items={data.activeWork} />
        <TodayScheduledTasks />
        <OverviewCalendar className="qt-more-wide" />
        <TodayWorkspaces projects={projects} focus={data.focus?.projectSlug} />
        <TractionToday />
        <FinanceToday />
        <TodayCaptured />
        <RecentActivity data={data} />
        <UsageSummary />
        <RecentDocuments />
        <TodayNews />
        <TodayTrending />
        {sprint && sprint.scorecard.tasksAttempted > 0 ? <SprintScorecard sprint={sprint} className="qt-more-wide" /> : null}
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
                <span className="os-mono w-11 shrink-0 text-paper-sage tabular-nums">{formatTime(event.timestamp)}</span>
                <span
                  className={cn(
                    "size-1.5 shrink-0 -translate-y-px rounded-full",
                    tone in TONE_DOT ? TONE_DOT[tone as keyof typeof TONE_DOT] : "bg-paper-ash",
                  )}
                  aria-hidden="true"
                />
                <span title={event.title} className="min-w-0 flex-1 truncate text-[14px] leading-[22px] text-paper-moss">{event.title}</span>
                <span className="hidden shrink-0 text-[13px] text-paper-sage sm:block">{sourceLabel(event.source)}</span>
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
      <ul className="-mx-3 divide-y divide-paper-mist">
        {documents.map((document) => (
          <li key={`${document.origin}:${document.id}`}>
            <Link
              to={documentHref(document)}
              className={cn("flex min-w-0 items-start gap-3 rounded-md px-3 py-2 transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
            >
              <FileText className="mt-0.5 size-[18px] shrink-0 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-paper-moss">{document.title}</span>
                <span className="mt-0.5 block truncate text-[13px] text-paper-sage">
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
