import type { ExecutionAttempt, RoutePolicyRecord } from "@shared/route-policy-types";
import type { WorkerJob, WorkerSummary } from "@shared/worker-types";
import { CommandButton, HairlineCard, SectionLabel } from "@/components/os";
import { useApproveWorkerJob, useRejectWorkerJob } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  describeAttempt,
  LOCAL_COST_CAVEAT,
  optionLabel,
  providerChargeLabel,
  routeHeadline,
  shortDigest,
} from "./route-policy-model";

/**
 * Where a task will run, or ran, and why.
 *
 * Shown before dispatch on the task screen and afterwards on the job, from the
 * same record. It says plainly when a task was blocked and what was ruled out,
 * because a route nobody can interrogate is just a machine choosing quietly.
 */

function LocationTag({ location }: { location: "local" | "cloud" }) {
  return (
    <span
      className={cn(
        "os-meta rounded-sm border px-1.5 py-0.5",
        location === "local" ? "border-os-border text-os-muted" : "border-os-border text-os-subtle",
      )}
    >
      {location === "local" ? "Local" : "Cloud"}
    </span>
  );
}

export interface RoutePolicyPanelProps {
  record: RoutePolicyRecord;
  workers: WorkerSummary[];
  className?: string;
}

export function RoutePolicyPanel({ record, workers, className }: RoutePolicyPanelProps) {
  const workerName = (id: string) => workers.find((worker) => worker.id === id)?.name ?? id;
  const { profile } = record;
  const blocked = record.status === "blocked";

  return (
    <HairlineCard className={className}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>{blocked ? "Route blocked" : "Route"}</SectionLabel>
            {record.selected ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[17px] leading-6 text-foreground">
                {optionLabel(record.selected, workerName)}
                <LocationTag location={record.selected.location} />
              </p>
            ) : null}
          </div>
          {record.overriddenByOperator ? (
            <span className="os-meta text-os-amber">Chosen by you</span>
          ) : null}
        </div>

        <p
          className={cn(
            "mt-3 max-w-[62ch] text-[13px] leading-5",
            blocked ? "text-os-danger" : "text-os-muted",
          )}
        >
          {routeHeadline(record)}
        </p>

        {record.queued ? (
          <p className="mt-2 text-[13px] leading-5 text-os-subtle">
            The local model is busy; this will wait for its turn.
          </p>
        ) : null}

        <p className="os-meta mt-3 text-os-subtle">
          Read as {profile.category} · {profile.complexity} · about {profile.estimatedInputTokens} input tokens (estimated)
        </p>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-os-subtle">{profile.complexityReason}</p>

        {profile.missingInformation.map((note) => (
          <p key={note} className="mt-2 text-[13px] leading-5 text-os-amber">
            {note}
          </p>
        ))}

        {record.fallbackPlan.length > 0 ? (
          <p className="mt-4 text-[13px] leading-5 text-os-muted">
            If it fails, one fallback:{" "}
            <span className="text-foreground">
              {record.fallbackPlan.map((entry) => optionLabel(entry, workerName)).join(", ")}
            </span>
          </p>
        ) : record.selected?.location === "local" ? (
          <p className="mt-4 text-[13px] leading-5 text-os-subtle">
            No fallback: if the local model fails, the task fails rather than leaving this machine.
          </p>
        ) : null}

        {record.rejected.length > 0 ? (
          <div className="mt-5 border-t border-os-border pt-4">
            <SectionLabel>Ruled out</SectionLabel>
            <ul className="mt-2.5 space-y-1.5">
              {record.rejected.map((entry) => (
                <li key={entry.optionId} className="max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                  <span className="text-os-muted">{entry.optionId}</span> · {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </HairlineCard>
  );
}

function AttemptRow({ attempt }: { attempt: ExecutionAttempt }) {
  const digest = shortDigest(attempt.modelDigest);

  return (
    <li className="py-3">
      <p className="flex flex-wrap items-center gap-2 text-[14px] leading-5 text-foreground">
        <span className="os-meta text-os-subtle">#{attempt.attempt}</span>
        {attempt.modelId ? `${attempt.workerId} · ${attempt.modelId}` : attempt.workerId}
        <LocationTag location={attempt.location} />
        {attempt.trigger === "fallback" ? <span className="os-meta text-os-amber">Fallback</span> : null}
      </p>
      <p
        className={cn(
          "mt-1 max-w-[70ch] text-[13px] leading-5",
          attempt.outcome === "failed" ? "text-os-danger" : "text-os-muted",
        )}
      >
        {describeAttempt(attempt)}
      </p>
      {attempt.failureReason ? (
        <p className="mt-1 max-w-[70ch] text-[13px] leading-5 text-os-subtle">{attempt.failureReason}</p>
      ) : null}
      {attempt.validation ? (
        <p className="mt-1 text-[13px] leading-5 text-os-subtle">
          Validation {attempt.validation.passed ? "passed" : "failed"}
          {attempt.validation.detail ? ` · ${attempt.validation.detail}` : ""}
        </p>
      ) : null}
      {digest ? <p className="os-meta mt-1 font-mono text-os-subtle">digest {digest}</p> : null}
    </li>
  );
}

/** Every attempt in order, so a fallback is a visible sequence, not a mystery. */
export function AttemptsPanel({ job }: { job: WorkerJob }) {
  const attempts = job.attempts ?? [];
  if (attempts.length === 0) return null;

  const metrics = job.result?.providerMetrics;

  return (
    <HairlineCard>
      <div className="p-5">
        <ul className="divide-y divide-os-border">
          {attempts.map((attempt) => (
            <AttemptRow key={attempt.attempt} attempt={attempt} />
          ))}
        </ul>
        {metrics ? (
          <p className="os-meta mt-3 border-t border-os-border pt-3 text-os-subtle">
            {providerChargeLabel(metrics)}
            {metrics.location === "local" ? ` · ${LOCAL_COST_CAVEAT}` : ""}
          </p>
        ) : null}
      </div>
    </HairlineCard>
  );
}

/**
 * The review step for a text result. There is no checkout to integrate, so the
 * review is the person reading it; the task's own output rules were already
 * checked when the run finished, and that result is shown, not assumed.
 */
export function TextResultStation({ job }: { job: WorkerJob }) {
  const approve = useApproveWorkerJob();
  const reject = useRejectWorkerJob();

  const awaiting = job.status === "awaiting_review";
  const last = job.attempts?.at(-1);
  const busy = approve.isPending || reject.isPending;
  const failure = [approve, reject].find((mutation) => mutation.isError)?.error;

  return (
    <section aria-label="Review" className="mt-10 rounded-lg border border-os-border bg-os-border/5">
      <div className="p-5 md:p-6">
        <SectionLabel>Result</SectionLabel>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-os-border p-4 font-mono text-[13px] leading-5 text-foreground">
          {job.result?.summary}
        </pre>

        <p className="mt-4 text-[13px] leading-5 text-os-muted">
          {last?.validation
            ? `Validation ${last.validation.passed ? "passed" : "failed"}${last.validation.detail ? `: ${last.validation.detail.replace(/\.$/, "")}` : ""}.`
            : "No task-specific validation was recorded."}{" "}
          This is a text result with no code to integrate; review means you read it.
        </p>

        {job.result?.blockers?.map((blocker) => (
          <p key={blocker} className="mt-2 text-[13px] leading-5 text-os-amber">
            {blocker}
          </p>
        ))}

        {failure ? (
          <p className="mt-4 text-[13px] leading-5 text-os-danger">{failure.message}</p>
        ) : null}

        {awaiting ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <CommandButton
              variant="primary"
              disabled={busy}
              loading={approve.isPending}
              loadingLabel="Approving"
              onClick={() => approve.mutate(job.id)}
            >
              Approve result
            </CommandButton>
            <CommandButton
              variant="quiet"
              disabled={busy}
              loading={reject.isPending}
              loadingLabel="Rejecting"
              onClick={() => reject.mutate({ id: job.id })}
            >
              Reject
            </CommandButton>
          </div>
        ) : null}
      </div>
    </section>
  );
}
