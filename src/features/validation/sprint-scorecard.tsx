import type {
  ValidationScorecard,
  ValidationSprint,
  ValidationTaskView,
} from "@shared/validation-sprint-types";
import { PaperSection } from "@/components/paper";
import { TodayLabel } from "@/features/mission-control/today-kit";
import { cn } from "@/lib/utils";
import {
  costCoverage,
  formatAverage,
  formatCost,
  formatCount,
  formatRate,
  formatSpan,
  FRICTION_LABELS,
  OUTCOME_LABELS,
  UNKNOWN,
  VERDICT_LABELS,
} from "./validation-model";

/**
 * The validation sprint, as one block.
 *
 * Counts, not charts — five tasks do not need a visualisation, they need to be
 * legible at a glance and honest about what is missing. Three properties are
 * doing the work here.
 *
 * **Unknowns look like nothing.** Every figure can be genuinely unmeasured, and
 * each of those renders as an em dash in the subtle foreground rather than as
 * `0`. A gap should read as a gap; a zero reads as a finding.
 *
 * **Total time and worker time sit beside each other.** That pairing is the
 * whole reason the sprint measures duration at all: 42 minutes total against 11
 * minutes of worker is not a slow worker, it is thirty-one minutes of process,
 * and a screen showing only one of the two numbers would send the operator to
 * fix the wrong thing.
 *
 * **It disappears when there is no sprint.** Mission Control is designed for
 * the good day, and a permanent block of dashes would spend attention on
 * something nobody is doing this week.
 */
export function SprintScorecard({ sprint }: { sprint: ValidationSprint }) {
  const { scorecard, tasks } = sprint;

  if (scorecard.tasksAttempted === 0) return null;

  return (
    <PaperSection label="Validation sprint">
      <Figures scorecard={scorecard} />

      <div className="mt-8 border-t border-paper-stone pt-6">
        <TaskTable tasks={tasks} />
      </div>

      {scorecard.frictionByCategory.length > 0 ? (
        <div className="mt-8 border-t border-paper-stone pt-6">
          <FrictionTally scorecard={scorecard} />
        </div>
      ) : null}
    </PaperSection>
  );
}

/** One number and what it is. The number leads; the label explains it. */
function Figure({
  value,
  label,
  detail,
  muted = false,
}: {
  value: string;
  label: string;
  detail?: string;
  muted?: boolean;
}) {
  const unknown = value === UNKNOWN;

  return (
    <div className="min-w-0">
      <p
        className={cn(
          "text-[22px] leading-[1.15] tabular-nums",
          unknown
            ? "text-paper-sage"
            : muted
              ? "text-paper-char"
              : "text-paper-moss",
        )}
      >
        {value}
      </p>
      <p className="text-[12.5px] mt-2 text-paper-sage">{label}</p>
      {detail ? (
        <p className="mt-1.5 text-[13px] leading-5 text-paper-sage">{detail}</p>
      ) : null}
    </div>
  );
}

function Figures({ scorecard }: { scorecard: ValidationScorecard }) {
  const coverage = costCoverage(scorecard);

  return (
    <div className="grid gap-x-10 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
      <Figure
        value={formatCount(scorecard.tasksAttempted)}
        label="Tasks attempted"
        detail={`${scorecard.completed} completed`}
      />
      <Figure
        value={formatCount(scorecard.manualTakeover)}
        label="Manual takeover"
        detail={
          scorecard.abandoned > 0 ? `${scorecard.abandoned} abandoned` : undefined
        }
      />
      <Figure
        value={formatRate(scorecard.firstPassReviewRate)}
        label="First-pass reviews"
        // Omitted rather than shown as a dash: two unknowns stacked in one
        // cell read as a broken panel instead of as missing evidence.
        detail={
          scorecard.avgRevisions === undefined
            ? undefined
            : `${formatAverage(scorecard.avgRevisions)} revisions avg`
        }
      />
      <Figure
        value={formatCount(scorecard.humanInterventions)}
        label="Human interventions"
        detail={
          scorecard.routedTasks > 0
            ? `Routing followed ${scorecard.routingFollowed}/${scorecard.routedTasks}`
            : undefined
        }
      />
      <Figure
        value={formatCost(scorecard.totalCostUsd)}
        label="Recorded cost"
        detail={coverage}
      />

      {/* The pair the sprint exists to compare. Kept on its own row so the
          gap between them is the first thing read, not a column difference. */}
      <Figure
        value={formatSpan(scorecard.avgCompletionMs)}
        label="Avg completion"
      />
      <Figure
        value={formatSpan(scorecard.avgWorkerMs)}
        label="Avg worker time"
        muted
        detail={overheadNote(scorecard)}
      />

      {scorecard.verdicts.length > 0 ? (
        <div className="min-w-0 sm:col-span-2">
          <TodayLabel>Easier than doing it manually?</TodayLabel>
          <ul className="mt-3 space-y-1.5">
            {scorecard.verdicts.map(({ verdict, count }) => (
              <li
                key={verdict}
                className="flex items-baseline justify-between gap-4 text-[14px] leading-5 text-paper-char"
              >
                <span>{VERDICT_LABELS[verdict]}</span>
                <span className="tabular-nums text-paper-sage">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * How much of the average task was not the worker.
 *
 * Only said when both halves are known and the gap is real. A note that
 * appeared for a two-second difference would train the eye to skip it.
 */
function overheadNote(scorecard: ValidationScorecard): string | undefined {
  const { avgCompletionMs, avgWorkerMs } = scorecard;

  if (typeof avgCompletionMs !== "number" || typeof avgWorkerMs !== "number") {
    return undefined;
  }

  const overhead = avgCompletionMs - avgWorkerMs;
  if (overhead < 60_000) return undefined;

  return `${formatSpan(overhead)} waiting, review, setup`;
}

const COLUMNS = "grid grid-cols-[minmax(0,1fr)_5rem_4.5rem_4.5rem_3rem_5rem] gap-x-4";

/**
 * The tasks themselves.
 *
 * A per-task row, because the averages above hide the finding. One task at five
 * revisions and four at one is the same 1.8 average as five tasks at 1.8, and
 * only the first of those is a routing problem worth fixing.
 */
function TaskTable({ tasks }: { tasks: readonly ValidationTaskView[] }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-[42rem]">
        <div className={cn(COLUMNS, "text-[12.5px] pb-3 text-paper-sage")}>
          <span>Task</span>
          <span>Worker</span>
          <span className="text-right">Total</span>
          <span className="text-right">Worker</span>
          <span className="text-right">Rev</span>
          <span className="text-right">Cost</span>
        </div>

        <ul className="border-t border-paper-stone">
          {tasks.map((task) => (
            <li
              key={task.taskId}
              className={cn(
                COLUMNS,
                "items-baseline border-b border-paper-stone py-3 text-[14px] leading-5",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-paper-char">{task.label}</span>
                <span className="text-[12.5px] mt-1 block text-paper-sage">
                  {OUTCOME_LABELS[task.outcome]}
                  {task.humanInterventions > 0
                    ? ` · ${task.humanInterventions} intervention${task.humanInterventions === 1 ? "" : "s"}`
                    : ""}
                </span>
              </span>

              <WorkerCell task={task} />

              <span className="text-right tabular-nums text-paper-char">
                {formatSpan(task.totalDurationMs)}
              </span>
              <span className="text-right tabular-nums text-paper-sage">
                {formatSpan(task.workerDurationMs)}
              </span>
              <span className="text-right tabular-nums text-paper-char">
                {formatCount(task.revisions)}
              </span>
              <span className="text-right tabular-nums text-paper-sage">
                {formatCost(task.costUsd)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Who ran it, and whether that was who the router picked.
 *
 * An override is called out in amber and a followed recommendation is not,
 * because the sprint is testing whether AUTO routing can be trusted — and the
 * interesting rows are the ones where the operator disagreed.
 */
function WorkerCell({ task }: { task: ValidationTaskView }) {
  if (!task.worker) {
    return <span className="text-[12.5px] text-paper-sage">{UNKNOWN}</span>;
  }

  return (
    <span className="min-w-0">
      <span className="text-[12.5px] block truncate text-paper-char">{task.worker}</span>
      {task.routingOverridden === true ? (
        <span className="text-[12.5px] mt-1 block truncate text-paper-flame-deep">
          Not {task.recommendedWorker}
        </span>
      ) : null}
    </span>
  );
}

/** What was reported, tallied and otherwise untouched. */
function FrictionTally({ scorecard }: { scorecard: ValidationScorecard }) {
  return (
    <>
      <TodayLabel>
        {scorecard.frictionReports === 1
          ? "1 friction report"
          : `${scorecard.frictionReports} friction reports`}
      </TodayLabel>

      <ul className="mt-3 grid gap-x-10 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {scorecard.frictionByCategory.map(({ category, count }) => (
          <li
            key={category}
            className="flex items-baseline justify-between gap-4 text-[14px] leading-5 text-paper-char"
          >
            <span className="min-w-0 truncate">{FRICTION_LABELS[category]}</span>
            <span className="shrink-0 tabular-nums text-paper-sage">{count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
