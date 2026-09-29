import { FileText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { MissionControlData } from "@shared/mission-control-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperSection, PaperStage, SegmentedControl } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatTime, sourceLabel, toneFor } from "@/features/activity";
import { UsageSummary } from "@/features/operations";
import { documentHref, TYPE_LABELS } from "@/features/projects/documents-model";
import { FinanceToday } from "@/features/finance";
import { TractionToday } from "@/features/traction";
import { FrictionButton, SprintScorecard } from "@/features/validation";
import { formatRelativeTime } from "@/lib/format";
import {
  useCaptures,
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
import { TodayCaptured, TodayStrip, TodayWorkspaces } from "./today";
import { DayWrapUp, MorningPlan, TodayCalendar } from "./today-day";
import { TodayLink } from "./today-kit";
import { TodayNews, TodayTrending } from "./today-world";

/**
 * Today (Mission Control).
 *
 * Where the day starts. One page that answers, in about ten seconds: what does
 * today look like, what needs me, what am I focused on, which work needs
 * movement, what is running, and what changed.
 *
 * Two columns on a wide screen, and the split is the argument: on the left,
 * the things that need a decision from you (Needs you, focus, workspaces,
 * acquisition); on the right, what is happening around you (agents, captured
 * notes, activity, spend, documents). On a narrow screen the left comes first.
 *
 * The day has two ends. Until 5pm the left column opens with Hermes' plan for
 * the day; from 5pm it opens with the wrap (done, carrying over, tomorrow,
 * loose ends). Either can be picked by hand from the header.
 *
 * Designed hardest for the good day. Nothing needing attention is the expected
 * state, so the loud parts genuinely disappear rather than becoming
 * placeholders, and flame is spent only where something is asking.
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
      <PaperStage>
        {isPending ? (
          <p className="text-[14px] text-paper-sage">Reading your day…</p>
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
  const { data: captures } = useCaptures();
  // The whole portfolio, not Mission Control's live subset: a low-priority
  // workspace's Now tasks are still planned for today.
  const { data: portfolio } = useProjects();
  const projects = portfolio?.projects ?? data.projects;
  const captured = captures?.items ?? [];
  const [mode, setMode] = useState<"plan" | "wrap">(() => (isEvening() ? "wrap" : "plan"));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="text-[13px] font-medium text-paper-sage">{formatToday()}</p>
          <h1 className="mt-1 font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance text-paper-moss sm:text-[34px]">
            {greeting("Dylan")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Today's view"
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
      </header>

      {degraded.length > 0 ? (
        <p role="status" className="mt-4 max-w-[80ch] text-[13.5px] leading-5 text-paper-flame-deep">
          {degraded.join(", ")} could not be read, so parts of this page are incomplete.
        </p>
      ) : null}

      <TodayStrip
        projects={projects}
        attention={data.attention.length}
        running={data.activeWork.length}
        captures={captured}
        className="mt-6"
      />

      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-12">
          {mode === "wrap" ? <DayWrapUp /> : <MorningPlan />}
          <AttentionList items={data.attention} dismissed={data.dismissed} workers={data.workers} />
          {data.focus ? <FocusBlock focus={data.focus} /> : null}
          <TodayWorkspaces projects={projects} focus={data.focus?.projectSlug} />
          {/* Acquisition beside the build: otherwise the work that feels
              productive always wins over the work that brings customers. */}
          <TractionToday />
          <FinanceToday />
        </div>

        <div className="min-w-0 space-y-12">
          <TodayCalendar />
          <ActiveWorkList items={data.activeWork} />
          <TodayCaptured captures={captured} />
          <RecentActivity data={data} />
          <UsageSummary />
          <RecentDocuments />
        </div>
      </div>

      {/* The outside world, below everything that is asking for something today. */}
      <div className="mt-12 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <TodayNews className="min-w-0" />
        <TodayTrending className="min-w-0" />
      </div>

      {/* Reflective rather than operational, so it sits below everything that
          is asking for something today, and removes itself with no sprint. */}
      {sprint && sprint.scorecard.tasksAttempted > 0 ? (
        <div className="mt-14 border-t border-paper-stone pt-10">
          <SprintScorecard sprint={sprint} />
        </div>
      ) : null}
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
function RecentActivity({ data }: { data: MissionControlData }) {
  const events = data.recentActivity.slice(0, ACTIVITY_LIMIT);

  return (
    <PaperSection label="Recent activity" action={<TodayLink to="/activity">All activity</TodayLink>}>
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
function RecentDocuments() {
  const { data } = useRecentDocuments(5);
  const documents = data?.documents ?? [];

  if (documents.length === 0) return null;

  return (
    <PaperSection label="Recent documents" action={<TodayLink to="/knowledge">Knowledge</TodayLink>}>
      <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
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
