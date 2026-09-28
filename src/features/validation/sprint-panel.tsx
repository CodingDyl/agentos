import { useState } from "react";
import type {
  InterventionKind,
  ValidationOutcome,
  ValidationTaskView,
  ValidationVerdict,
} from "@shared/validation-sprint-types";
import type { WorkerJob } from "@shared/worker-types";
import {
  CommandButton,
  FilterBar,
  HairlineCard,
  SectionLabel,
} from "@/components/os";
import {
  useStartValidationTask,
  useUpdateValidationTask,
  useValidationSprint,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  INTERVENTION_LABELS,
  INTERVENTION_ORDER,
  OUTCOME_LABELS,
  VERDICT_LABELS,
  VERDICT_ORDER,
} from "./validation-model";

/** Job states where the work is over and the sprint can ask its question. */
const FINISHED = new Set(["completed", "rejected", "failed", "cancelled"]);

/** The outcomes a person picks. `in_progress` is where a task starts, not a choice. */
const OUTCOMES: readonly ValidationOutcome[] = [
  "in_progress",
  "completed",
  "manual_takeover",
  "abandoned",
];

/**
 * One job's place in the validation sprint.
 *
 * This is the only surface in AgentOS that records something the system cannot
 * observe about itself: the moments a person had to step in, and whether the
 * whole thing was worth it. Everything else the sprint reports — revisions,
 * durations, cost, the routing decision — is already on the job beside this
 * panel and is read from there.
 *
 * Interventions only ever append. There is no undo, and that is deliberate: a
 * count of the times AgentOS could not continue on its own is the sprint's most
 * valuable number precisely because it cannot be quietly revised downward on a
 * day when it looks bad.
 */
export function SprintPanel({ job }: { job: WorkerJob }) {
  const { data } = useValidationSprint();
  const start = useStartValidationTask();

  const task = data?.tasks.find((entry) => entry.jobId === job.id);

  if (!task) {
    return (
      <HairlineCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <SectionLabel>Validation sprint</SectionLabel>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-5 text-os-muted">
            Track this job to record what had to be done by hand. Everything
            else (revisions, timings, cost, routing) is read from the job.
          </p>
        </div>

        <CommandButton
          variant="secondary"
          loading={start.isPending}
          loadingLabel="Tracking"
          onClick={() =>
            start.mutate({
              project: job.project,
              label: job.objective,
              jobId: job.id,
            })
          }
        >
          Track in sprint
        </CommandButton>
      </HairlineCard>
    );
  }

  return <TrackedTask task={task} finished={FINISHED.has(job.status)} />;
}

function TrackedTask({
  task,
  finished,
}: {
  task: ValidationTaskView;
  finished: boolean;
}) {
  const update = useUpdateValidationTask();

  const counts = new Map<InterventionKind, number>();

  for (const intervention of task.interventions) {
    counts.set(intervention.kind, (counts.get(intervention.kind) ?? 0) + 1);
  }

  // The question is asked once the work is over — either because the job
  // reached an ending, or because the operator said how the task ended.
  const settled = finished || task.outcome !== "in_progress";

  return (
    <HairlineCard className="p-5">
      <SectionLabel
        action={
          <span className="tabular-nums">
            {task.humanInterventions === 1
              ? "1 intervention"
              : `${task.humanInterventions} interventions`}
          </span>
        }
      >
        Validation sprint
      </SectionLabel>

      <div className="mt-5">
        <p className="text-[13px] leading-5 text-os-subtle">
          Record each time you had to step in. Appends only; there is no undo.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {INTERVENTION_ORDER.map((kind) => {
            const count = counts.get(kind) ?? 0;

            return (
              <button
                key={kind}
                type="button"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: task.taskId, intervention: { kind } })}
                className={cn(
                  "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 transition-colors duration-150",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  count > 0
                    ? "border-os-border-strong bg-os-surface-raised text-foreground"
                    : "border-transparent text-os-muted hover:border-os-border hover:text-foreground",
                )}
              >
                {INTERVENTION_LABELS[kind]}
                {count > 0 ? (
                  <span className="tabular-nums text-os-warning">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 border-t border-os-border pt-5">
        <SectionLabel>Outcome</SectionLabel>
        <FilterBar<ValidationOutcome>
          label="How this task ended"
          className="mt-3"
          value={task.outcome}
          onChange={(outcome) => update.mutate({ id: task.taskId, outcome })}
          options={OUTCOMES.map((outcome) => ({
            value: outcome,
            label: OUTCOME_LABELS[outcome],
          }))}
        />
      </div>

      {settled ? <VerdictQuestion task={task} /> : null}
    </HairlineCard>
  );
}

/**
 * The one subjective measurement in the sprint.
 *
 * Asked once, when the task is over, and never folded into any of the numbers
 * above it. A workflow can score well on every derived metric and still be
 * miserable to use, and this is the only place that shows up — so it is a
 * question in plain words rather than a rating out of five.
 */
function VerdictQuestion({ task }: { task: ValidationTaskView }) {
  const update = useUpdateValidationTask();
  const [note, setNote] = useState(task.verdictNote ?? "");

  const answer = (verdict: ValidationVerdict) =>
    update.mutate({
      id: task.taskId,
      verdict,
      verdictNote: note.trim() || undefined,
    });

  return (
    <div className="mt-6 border-t border-os-border pt-5">
      <p className="text-[15px] leading-6 text-foreground">
        Did AgentOS make this task easier than doing it manually?
      </p>

      <FilterBar<ValidationVerdict>
        label="Whether AgentOS helped"
        className="mt-4"
        // `FilterBar` needs a value; an unanswered question has none, and no
        // verdict is a real state rather than a default worth pre-selecting.
        value={task.verdict ?? ("" as ValidationVerdict)}
        onChange={answer}
        options={VERDICT_ORDER.map((verdict) => ({
          value: verdict,
          label: VERDICT_LABELS[verdict],
        }))}
      />

      <label className="mt-6 block">
        <SectionLabel>Biggest friction (optional)</SectionLabel>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            const next = note.trim();

            if (next && next !== (task.verdictNote ?? "")) {
              update.mutate({ id: task.taskId, verdictNote: next });
            }
          }}
          rows={2}
          placeholder="What slowed this down"
          className="os-focus-ring mt-3 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
        />
      </label>
    </div>
  );
}
