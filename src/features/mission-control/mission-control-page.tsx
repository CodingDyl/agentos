import { Link } from "react-router-dom";
import type { MissionControlData } from "@shared/mission-control-types";
import { AppShell, ErrorState, LoadingState, Section } from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { formatTime, sourceLabel, toneFor } from "@/features/activity";
import { AiStackSummary, UsageSummary } from "@/features/operations";
import { FrictionButton, SprintScorecard } from "@/features/validation";
import { useMissionControl, useValidationSprint } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { ActiveWorkList } from "./active-work-list";
import { AttentionList } from "./attention-list";
import { DocumentList } from "@/features/projects/detail/document-list";
import { useRecentDocuments } from "@/lib/agentos/queries";
import { FocusBlock } from "./focus-block";
import {
  degradedSources,
  formatToday,
  greeting,
} from "./mission-control-model";
import { AutomationStrip, SystemPanel, WorkerStrip } from "./status-strips";

/**
 * Mission Control.
 *
 * One screen that answers, in order: what matters, what needs me, what is
 * running, what is broken, where do I go next. Everything on it already exists
 * somewhere else — this owns no workflow state and performs no action. Every
 * card is a link into the system that actually holds the decision.
 *
 * The reading order is the argument. Focus first, because the ranking below
 * only means something against it. Then what is waiting on a person, because
 * that is the only thing on the screen that cannot proceed without them. Then
 * machines, then history, then the floor it all stands on.
 *
 * It is designed hardest for the good day. Nothing needing attention is the
 * expected state, not an empty state to apologise for — so the loud parts
 * genuinely disappear rather than becoming placeholders, and amber is spent
 * only where something is actually asking for something.
 */

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

/** Enough history to see the shape of the morning, not enough to be a feed. */
const ACTIVITY_LIMIT = 8;

export function MissionControlPage() {
  const { data, isPending, isFetching, error, refetch } = useMissionControl();
  const navigationItems = useNavigationItems();

  const running = (data?.activeWork.length ?? 0) > 0;

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="mission-control"
      activeHref="/"
      agentState={running ? "running" : "idle"}
      agentLabel={running ? "Agents / running" : "Agents / idle"}
      contextLabel={
        data?.focus?.project ? `Context / ${data.focus.project}` : undefined
      }
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Mission control"
            message="Reading the system…"
            detail="Projects · workers · automations"
          />
        ) : !data ? (
          <ErrorState
            label="Mission control unavailable"
            title="The system could not be read."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <MissionControl data={data} />
        )}
      </div>
    </AppShell>
  );
}

function MissionControl({ data }: { data: MissionControlData }) {
  const degraded = degradedSources(data.sources);
  const { data: sprint } = useValidationSprint();

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-b border-os-border pb-6">
        <h1 className="os-meta text-os-muted">{greeting("Dylan")}</h1>

        <div className="flex items-center gap-4">
          <span className="os-meta text-os-subtle">{formatToday()}</span>
          {/* Reachable from the screen the day starts on, because the friction
              worth recording is most often noticed on the way somewhere. */}
          <FrictionButton surface="mission-control" className="-mr-4" />
        </div>
      </header>

      {/* Said once, at the top, rather than repeated beside every thinned-out
          section. A screen that is missing a source should say so before a
          person starts drawing conclusions from what is left. */}
      {degraded.length > 0 ? (
        <p className="mt-6 max-w-[80ch] text-[13px] leading-5 text-os-warning">
          {degraded.join(", ")} could not be read, so parts of this screen are
          incomplete.
        </p>
      ) : null}

      {data.focus ? <FocusBlock focus={data.focus} className="mt-10" /> : null}

      <div className="mt-12 border-t border-os-border pt-10">
        <AttentionList items={data.attention} />
      </div>

      <div className="mt-12 border-t border-os-border pt-10">
        <ActiveWorkList items={data.activeWork} />
      </div>

      <div className="mt-12 grid gap-x-16 gap-y-10 border-t border-os-border pt-10 lg:grid-cols-2">
        <WorkerStrip workers={data.workers} />
        <AutomationStrip
          automations={data.automations}
          degraded={data.sources.automations !== "ready"}
        />
      </div>

      <div className="mt-12 border-t border-os-border pt-10">
        <RecentActivity data={data} />
      </div>

      {/* What the agents wrote lately. Low on the page and absent when there is
          nothing: a document is worth a glance, not a headline. */}
      <RecentDocuments />

      {/* Four lines and a link. Mission Control points at Operations rather
          than reproducing it — and shows nothing at all until the ledger has
          something to say. */}
      <div className="mt-12 border-t border-os-border pt-10">
        <UsageSummary />
      </div>

      {/* Which AIs AgentOS is actually running on right now. A line of dots
          and a link — the detail lives in Operations → AI Stack. */}
      <div className="mt-12 border-t border-os-border pt-10">
        <AiStackSummary />
      </div>

      {/* Reflective rather than operational, so it sits below everything that
          is asking for something today — and it removes itself entirely when
          no sprint is running. */}
      {sprint && sprint.scorecard.tasksAttempted > 0 ? (
        <div className="mt-12 border-t border-os-border pt-10">
          <SprintScorecard sprint={sprint} />
        </div>
      ) : null}

      <div className="mt-12 border-t border-os-border pt-10">
        <SystemPanel components={data.system} />
      </div>
    </>
  );
}

/**
 * The last few things that happened.
 *
 * Read from the payload rather than fetched again: this screen's sections have
 * to agree with each other, and a separately-timed activity request could show
 * a completion that the attention list above has not noticed yet.
 *
 * Not the Activity page. A glance, then a link to the place that does auditing.
 */
function RecentActivity({ data }: { data: MissionControlData }) {
  const events = data.recentActivity.slice(0, ACTIVITY_LIMIT);

  return (
    <Section
      label="Recent activity"
      action={
        <Link
          to="/activity"
          className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          All activity
        </Link>
      }
    >
      {events.length === 0 ? (
        <p className="text-[15px] leading-6 text-os-muted">
          {data.sources.activity === "ready"
            ? "Nothing has happened yet today."
            : "The activity timeline could not be read."}
        </p>
      ) : (
        <ul className="space-y-4">
          {events.map((event) => {
            const tone = toneFor(event);

            return (
              <li key={event.id} className="flex min-w-0 items-baseline gap-4">
                <span className="os-meta w-11 shrink-0 text-os-subtle tabular-nums">
                  {formatTime(event.timestamp)}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 translate-y-[-0.15em] rounded-full",
                      tone === "active"
                        ? "bg-os-amber"
                        : tone === "success"
                          ? "bg-os-success"
                          : tone === "warning"
                            ? "bg-os-warning"
                            : tone === "danger"
                              ? "bg-os-danger"
                              : "bg-os-subtle",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate text-[15px] leading-6 text-os-muted">
                    {event.title}
                  </span>
                </span>
                <span className="os-meta hidden shrink-0 text-os-subtle sm:block">
                  {sourceLabel(event.source)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function RecentDocuments() {
  const { data } = useRecentDocuments(5);
  const documents = data?.documents ?? [];

  if (documents.length === 0) return null;

  return (
    <div className="mt-12 border-t border-os-border pt-10">
      <Section
        label="Recent documents"
        action={
          <Link
            to="/projects"
            className="os-focus-ring os-meta -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            All projects →
          </Link>
        }
      >
        <DocumentList documents={documents} showProject dense />
      </Section>
    </div>
  );
}
