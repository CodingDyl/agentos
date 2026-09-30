import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { IntegrationBlocker } from "@shared/worker-types";
import type { WorkerDiff, WorkerJob, WorkerReview } from "@shared/worker-types";
import {
  AppShell,
  CommandButton,
  EmptyState,
  ErrorState,
  HairlineCard,
  LoadingState,
  Section,
  SectionLabel,
  StatusPill,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { FrictionButton, SprintPanel } from "@/features/validation";
import { RoutingDecision } from "./routing-decision";
import { AttemptsPanel, RoutePolicyPanel, TextResultStation } from "./route-policy-panel";
import {
  fellBack,
  isTextResultJob,
  LOCAL_COST_CAVEAT,
  providerChargeLabel,
  shortDigest,
} from "./route-policy-model";
import { VisualVerificationPanel } from "./visual-verification-panel";
import { GrokBotJobPanel } from "./grok-bot-job-panel";
import {
  useApproveWorkerJob,
  useCancelWorkerJob,
  useDiscardWorkerWorktree,
  useRefreshWorkerJob,
  useRejectWorkerJob,
  useProjectDocuments,
  useRepositoryAction,
  useRetryWorkerJob,
  useValidateWorkerJob,
  useReviewWorkerJob,
  useReviseWorkerJob,
  useWorkerJob,
  useWorkers,
  useWorkerJobDiff,
  useWorkerJobIntegration,
} from "@/lib/agentos/queries";
import { formatRelativeTime } from "@/lib/format";
import { DocumentList } from "@/features/projects/detail/document-list";
import { cn } from "@/lib/utils";
import { useJobEvents } from "./use-job-events";
import {
  bySeverity,
  formatDuration,
  hasReviewableWork,
  isCancellable,
  isFinished,
  statusLabel,
  statusPill,
  toSteps,
  verdictLabel,
  verdictPill,
  type StepState,
} from "./workers-model";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

const STEP_ICON = { running: CircleDot, done: Check, failed: X } as const;

/** Events that mean the job is over. */
const TERMINAL_EVENTS = new Set(["job.completed", "job.failed", "job.cancelled", "job.interrupted"]);

const STEP_TONE: Record<StepState, string> = {
  running: "text-os-amber",
  done: "text-os-success",
  failed: "text-os-danger",
};

/** What one job was asked to do, and what it actually did. */
export function JobDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const { data, isPending, isFetching, error, refetch } = useWorkerJob(id);
  const cancelJob = useCancelWorkerJob();
  const retryJob = useRetryWorkerJob();
  const navigate = useNavigate();
  const events = useJobEvents(id);
  const refreshJob = useRefreshWorkerJob();

  const job = data?.job;

  // The stream reports the end of the job before any poll would; re-read the
  // record then, so the header never claims a finished job is still running.
  const endingId = events.find((event) => TERMINAL_EVENTS.has(event.type))?.id;

  useEffect(() => {
    if (endingId) refreshJob(id);
  }, [endingId, id, refreshJob]);


  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="worker-job"
      activeHref="/workers"
      agentState={job && !isFinished(job.status) ? "running" : "idle"}
      agentLabel={
        job && !isFinished(job.status) ? "Worker / running" : "Worker / idle"
      }
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Job"
            message="Reading the job…"
            detail="Workers / jobs"
          />
        ) : !job ? (
          <ErrorState
            label="Job unavailable"
            title="That job is not in the history."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <JobDetail
            job={job}
            events={events}
            onCancel={() => cancelJob.mutate(job.id)}
            isCancelling={cancelJob.isPending}
            cancelError={cancelJob.error?.message}
            onRetry={() =>
              retryJob.mutate(job.id, {
                onSuccess: ({ job: next }) => void navigate(`/workers/jobs/${next.id}`),
              })
            }
            isRetrying={retryJob.isPending}
            retryError={retryJob.error?.message}
          />
        )}
      </div>
    </AppShell>
  );
}

interface JobDetailProps {
  job: WorkerJob;
  events: ReturnType<typeof useJobEvents>;
  onCancel: () => void;
  isCancelling: boolean;
  cancelError?: string;
  onRetry: () => void;
  isRetrying: boolean;
  retryError?: string;
}

function JobDetail({ job, events, onCancel, isCancelling, cancelError, onRetry, isRetrying, retryError }: JobDetailProps) {
  const finished = isFinished(job.status);
  const cancellable = isCancellable(job.status);
  // A live run stops at once; finished work asks first, because it throws
  // away a result someone may still have wanted to review.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const steps = toSteps(events, finished);
  const duration = formatDuration(job.startedAt, job.completedAt);

  // Liveness: the record's pulse, or the newest streamed event, whichever is
  // later. This is what turns "running" from a claim into something you can
  // check against a clock.
  const newestStreamed = events.at(-1)?.timestamp;
  const lastHeard =
    [job.lastEventAt, newestStreamed].filter((value): value is string => !!value).sort().at(-1) ?? job.startedAt;
  const interrupted = Boolean(job.interruptedAt);
  const stalled = Boolean(job.stalledSince) && !finished;
  const retryable = finished && (job.status === "failed" || job.status === "cancelled");

  // Only so a routing decision can name its workers rather than print ids.
  const { data: workersData } = useWorkers();
  const workers = workersData?.workers ?? [];

  return (
    <>
      <header className="border-b border-os-border pb-8">
        <Link
          to="/workers"
          className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All workers
        </Link>

        <div className="mt-5 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="max-w-[24ch] text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] font-normal tracking-[-0.03em] text-balance">
              {job.objective}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <StatusPill
                status={statusPill(job.status)}
                label={statusLabel(job.status)}
              />
              <span className="os-meta text-os-subtle">
                {(job.resolvedWorker ?? job.worker).toUpperCase()} · {job.project}
                {duration ? ` · ${duration}` : ""}
              </span>
              {!finished && lastHeard ? (
                <span className={stalled ? "os-meta text-os-warning" : "os-meta text-os-subtle"}>
                  Last heard {formatRelativeTime(lastHeard)}
                </span>
              ) : null}
              {job.retryOf ? (
                <Link to={`/workers/jobs/${job.retryOf}`} className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle hover:text-foreground">
                  Retry of {job.retryOf}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Reportable at any point in the job, including while it is still
                running — most of what is worth recording is noticed then, not
                afterwards when the annoyance has been rationalised away. */}
            <FrictionButton
              surface="worker-job"
              jobId={job.id}
              project={job.project}
            />

            {cancellable && !confirmingCancel ? (
              <CommandButton
                variant="danger"
                icon={Square}
                iconPosition="start"
                onClick={() => (finished ? setConfirmingCancel(true) : onCancel())}
                loading={isCancelling}
                loadingLabel={finished ? "Cancelling" : "Stopping"}
              >
                Cancel job
              </CommandButton>
            ) : null}

            {retryable ? (
              <CommandButton
                variant={interrupted ? "primary" : "secondary"}
                icon={RotateCcw}
                iconPosition="start"
                onClick={onRetry}
                loading={isRetrying}
                loadingLabel="Starting"
              >
                Retry
              </CommandButton>
            ) : null}
          </div>
        </div>
      </header>

      {confirmingCancel && cancellable ? (
        <div className="mt-10 max-w-[72ch] rounded-lg border border-os-danger/40 bg-os-danger/5 p-5 md:p-6" role="alertdialog" aria-label="Cancel this job?">
          <p className="os-meta text-os-danger">Cancel this job?</p>
          <p className="mt-3 text-[15px] leading-6 text-foreground">
            {job.resolvedWorker ?? job.worker} has finished its run. Cancelling closes the job without reviewing or applying
            the work, and frees the task for new work. The worktree is kept until you discard it, and Retry starts it again.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <CommandButton
              variant="danger"
              icon={Square}
              iconPosition="start"
              onClick={() => {
                onCancel();
                setConfirmingCancel(false);
              }}
              loading={isCancelling}
              loadingLabel="Cancelling"
            >
              Yes, cancel job
            </CommandButton>
            <CommandButton variant="quiet" onClick={() => setConfirmingCancel(false)}>
              Keep it
            </CommandButton>
          </div>
        </div>
      ) : null}

      {cancelError ? (
        <p className="mt-6 max-w-[72ch] text-[13px] leading-5 text-os-danger" role="alert">
          {cancelError}
        </p>
      ) : null}

      {stalled ? (
        <div className="mt-10 max-w-[72ch] rounded-lg border border-os-warning/40 bg-os-warning/5 p-5 md:p-6" role="status">
          <p className="os-meta text-os-warning">Stalled</p>
          <p className="mt-3 text-[15px] leading-6 text-foreground">
            Nothing has been heard from {job.resolvedWorker ?? job.worker} since {lastHeard ? formatRelativeTime(lastHeard) : "it started"}.
            The run is still live and its own timeout still applies; cancel it if it is not coming back, then retry.
          </p>
        </div>
      ) : null}

      <GrokBotJobPanel job={job} />

      {job.error ? (
        <div
          className={
            interrupted
              ? "mt-10 max-w-[72ch] rounded-lg border border-os-warning/40 bg-os-warning/5 p-5 md:p-6"
              : "mt-10 max-w-[72ch] rounded-lg border border-os-danger/30 bg-os-danger/5 p-5 md:p-6"
          }
        >
          {/* Three authors: the worker, AgentOS's validation, or the process
              itself going away. Named, because the right response differs. */}
          <p className="os-meta text-os-subtle">
            {interrupted
              ? "The process running this job stopped"
              : job.error.startsWith("Validation failed")
                ? "Found by AgentOS"
                : "Reported by the worker"}
          </p>
          <p className={`mt-3 font-mono text-[12px] leading-5 break-words ${interrupted ? "text-os-warning" : "text-os-danger"}`}>
            {job.error}
          </p>
          {interrupted ? (
            <p className="mt-3 text-[13px] leading-5 text-os-muted">
              Usually a restart of the AgentOS data adapter (saving a server file restarts it in development). The worktree is intact; a retry starts a fresh run.
            </p>
          ) : null}
          {retryError ? <p className="mt-3 text-[13px] leading-5 text-os-danger">{retryError}</p> : null}
        </div>
      ) : null}

      {/* A text result has no checkout to review, so it gets its own station
          rather than a code-review panel that would say "changed nothing". */}
      {isTextResultJob(job) ? (
        hasReviewableWork(job.status) || job.status === "completed" ? (
          <TextResultStation job={job} />
        ) : null
      ) : hasReviewableWork(job.status) ? (
        <ReviewStation job={job} />
      ) : null}

      <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section label="Activity" className="lg:col-start-1">
          {steps.length === 0 ? (
            <EmptyState
              variant="inline"
              description="Nothing has been reported yet."
            />
          ) : (
            <ul className="space-y-0.5">
              {steps.map((step) => {
                const Icon = STEP_ICON[step.state];

                return (
                  <li
                    key={step.id}
                    className="flex min-h-9 items-center gap-3 text-[14px] leading-5"
                  >
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        STEP_TONE[step.state],
                        step.state === "running" && "motion-safe:animate-pulse",
                      )}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span
                      className={
                        step.state === "running"
                          ? "text-foreground"
                          : "text-os-muted"
                      }
                    >
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <div className="flex flex-col gap-10 lg:col-start-2">
          {job.result ? (
            <Section label="Result">
              <p className="max-w-[62ch] text-[15px] leading-6 text-os-muted">
                {job.result.summary}
              </p>

              {/* The review panel above already shows these. Repeating them
                  here would read as two separate checks rather than one. */}
              {/* The review station above already shows these while the work
                  is still under review. Repeating them would read as two
                  separate checks rather than one. */}
              {job.result.tests?.length && !hasReviewableWork(job.status) ? (
                <ValidationList tests={job.result.tests} className="mt-5" />
              ) : null}

              {/* A worker's own reservations, kept separate from what AgentOS
                  verified — they are its account, not a finding. */}
              {job.result.blockers?.length ? (
                <ul className="mt-5 space-y-2">
                  {job.result.blockers.map((blocker) => (
                    <li
                      key={blocker}
                      className="max-w-[62ch] text-[13px] leading-5 text-os-subtle"
                    >
                      {blocker}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ) : null}

          {/* The audit trail for a job nobody chose by hand. Kept on the job
              itself, because the question "why did Claude get this one?" is
              asked long after the delegation screen has gone. */}
          {job.routing ? (
            <Section label="Why this worker">
              {job.routing.policy ? (
                <RoutePolicyPanel record={job.routing.policy} workers={workers} />
              ) : (
                <RoutingDecision
                  decision={job.routing}
                  workers={workers}
                  overriddenTo={job.resolvedWorker}
                />
              )}
            </Section>
          ) : null}

          {job.attempts?.length ? (
            <Section label={fellBack(job) ? "Attempts (fell back)" : "Attempts"}>
              <AttemptsPanel job={job} />
            </Section>
          ) : null}

          {/* Only workers that can account for a run report one. A worker that
              cannot is not made to look like it spent nothing. */}
          {job.result?.providerMetrics ? (
            <Section label="Run cost">
              <RunCost metrics={job.result.providerMetrics} />
            </Section>
          ) : null}

          <JobArtifacts job={job} />

          {isTextResultJob(job) ? null : (
          <Section label="Changed files">
            {(job.result?.changedFiles ?? []).length === 0 ? (
              <EmptyState
                variant="inline"
                description={
                  finished
                    ? "The worker changed nothing."
                    : "Nothing changed yet."
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {job.result?.changedFiles?.map((file) => (
                  <li
                    key={file}
                    className="truncate font-mono text-[12px] leading-5 text-os-muted"
                  >
                    {file}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          )}

          {job.worktreePath ? (
            <Section label="Worktree">
              <HairlineCard className="p-4">
                <p className="font-mono text-[12px] leading-5 break-all text-os-muted">
                  {job.worktreePath}
                </p>
              </HairlineCard>
              <p className="os-meta mt-3 text-os-subtle">
                Isolated from your working copy
              </p>
            </Section>
          ) : null}

          <Section label="Handoff">
            <SectionLabel className="sr-only">Job details</SectionLabel>
            <dl className="space-y-4">
              <Detail label="Job id" value={job.id} mono />
              {job.repoPath ? (
                <Detail label="Repository" value={job.repoPath} mono />
              ) : null}
              {job.contextFiles?.length ? (
                <Detail label="Context" value={job.contextFiles.join(", ")} />
              ) : null}
              {job.acceptanceCriteria?.length ? (
                <Detail
                  label="Acceptance"
                  value={job.acceptanceCriteria.join(" · ")}
                />
              ) : null}
            </dl>
          </Section>
        </div>
      </div>

      {/* Last, and only ever a record. The sprint measures this pipeline from
          beside it — nothing in this panel can start, review, approve or
          integrate anything, and a job page with no sprint running shows one
          line and a button rather than a workflow step. */}
      <div className="mt-12">
        <SprintPanel job={job} />
      </div>
    </>
  );
}

/**
 * What AgentOS ran, and what it got back.
 *
 * The outcome is the point of this list. A command with no mark beside it reads
 * as "we ran something", which is exactly the impression this whole step exists
 * to avoid — so pass and fail are both stated, and a failure keeps the output
 * that explains it.
 */
function ValidationList({
  tests,
  className,
}: {
  tests: NonNullable<WorkerJob["result"]>["tests"];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3", className)}>
      {(tests ?? []).map((test) => {
        const Icon = test.success ? Check : X;

        return (
          <li key={test.command} className="flex min-w-0 gap-3">
            <Icon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                test.success ? "text-os-success" : "text-os-danger",
              )}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <span className="font-mono text-[12px] leading-5 break-all text-os-muted">
                {test.command}
              </span>
              {/* A passing command explains itself; a failing one has to. */}
              {test.detail && !test.success ? (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border border-os-border/60 bg-os-border/10 p-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-os-subtle">
                  {test.detail}
                </pre>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The handover.
 *
 * This is the moment the whole system is built around. A worker has finished,
 * AgentOS has checked the work itself, and Hermes has read the diff — and none
 * of that has decided anything. The screen lays out what each step concluded
 * and then stops, because the next move belongs to a person.
 *
 * The design rule here is that no two of those steps are allowed to look like
 * one. Validation, review, and approval are separate blocks with separate
 * authors, so it is never ambiguous who said what.
 */
function ReviewStation({ job }: { job: WorkerJob }) {
  const [showDiff, setShowDiff] = useState(false);

  /**
   * `#visual` is a real deep link, not decoration — Mission Control sends a
   * visual finding straight to its screenshots.
   *
   * The browser only honours the fragment on a full page load. Arriving by a
   * client-side navigation — which is how Mission Control links here — needs
   * this, and it lives beside the element rather than in the page component so
   * it cannot race the job loading.
   *
   * `auto`, not `smooth`: smooth is a no-op inside the shell's own scrolling
   * `<main>`, and a deep link should land you on the thing rather than animate
   * you towards it.
   */
  const visual = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash !== "#visual") return;

    visual.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [hash]);

  const review = useReviewWorkerJob();
  const revise = useReviseWorkerJob();
  const approve = useApproveWorkerJob();
  const reject = useRejectWorkerJob();
  const discard = useDiscardWorkerWorktree();
  const retry = useRetryWorkerJob();
  // The cures that act on the repository rather than on the job.
  const repository = useRepositoryAction(job.project);
  const validate = useValidateWorkerJob();

  const diff = useWorkerJobDiff(job.id, showDiff);

  const passed = job.review?.verdict === "pass";
  const awaiting = job.status === "awaiting_review";

  // Only asked when it could matter: the conditions describe a git repository,
  // and there is nothing to check before there is something to approve.
  const integration = useWorkerJobIntegration(job.id, passed && awaiting);

  const changed = job.result?.changedFiles?.length ?? 0;
  const tests = job.result?.tests ?? [];
  const revision = job.revision ?? 1;

  const busy =
    review.isPending ||
    revise.isPending ||
    approve.isPending ||
    reject.isPending ||
    discard.isPending;

  const failure = [review, revise, approve, reject, discard, validate, retry].find(
    (mutation) => mutation.isError,
  )?.error;

  // `details` carries each blocker with its cure; the prose list is the
  // fallback for an adapter that has not been restarted yet.
  const blockers: IntegrationBlocker[] =
    integration.data?.details ??
    (integration.data?.blockers ?? []).map((message) => ({ message }));

  /** What resolves this blocker, or nothing when the answer is not a button. */
  const cureFor = (blocker: IntegrationBlocker) => {
    const cure = blocker.cure;
    if (!cure) return null;

    switch (cure.kind) {
      case "switch":
        return {
          label: `Switch to ${cure.branch}`,
          run: () => repository.mutate({ kind: "switch", branch: cure.branch }),
        };
      case "stash":
        return {
          label: "Stash them",
          run: () => repository.mutate({ kind: "stash" }),
        };
      case "validate":
        // Runs the job's own commands in its own worktree, and records what
        // they said — so the blocker either clears or names what still fails.
        return { label: "Run validation", run: () => validate.mutate(job.id) };
      case "review":
        return { label: "Review again", run: () => review.mutate(job.id) };
      case "retry":
        // Deliberately not "rebase". The reviewed tree cannot be applied to a
        // base it was never reviewed against, so the offer is a fresh run.
        return { label: "Re-run on the new base", run: () => retry.mutate(job.id) };
      default:
        return null;
    }
  };
  const canApprove = passed && awaiting && integration.data?.ready === true;

  return (
    <section
      aria-label="Review"
      className="mt-10 rounded-lg border border-os-border bg-os-border/5"
    >
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <SectionLabel>Implementation</SectionLabel>
          {revision > 1 ? (
            <span className="os-meta text-os-subtle">Revision {revision}</span>
          ) : null}
        </div>

        <p className="mt-3 max-w-[62ch] text-[15px] leading-6 text-foreground">
          {changed === 0
            ? "The worker changed nothing in its worktree."
            : `${changed} ${changed === 1 ? "file" : "files"} changed in an isolated worktree.`}
        </p>

        <div className="mt-6">
          <SectionLabel>Validation</SectionLabel>
          {tests.length === 0 ? (
            <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
              No validation commands were given, so nothing was verified.
            </p>
          ) : (
            <ValidationList tests={tests} className="mt-3" />
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowDiff((open) => !open)}
          aria-expanded={showDiff}
          className="os-focus-ring os-meta -mx-2 mt-6 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          {showDiff ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
          {showDiff ? "Hide changes" : "View changes"}
        </button>

        {showDiff ? (
          <DiffViewer
            diff={diff.data?.diff}
            isPending={diff.isPending}
            error={diff.error?.message}
          />
        ) : null}
      </div>

      {/* Before the code review, because it is evidence rather than opinion:
          the screenshots are what a person should have seen by the time they
          read anyone's verdict on them. Absent entirely for a job that never
          asked to be looked at — a backend ticket has no screen. */}
      {job.visualAcceptance?.enabled ? (
        <div id="visual" ref={visual}>
          <VisualVerificationPanel job={job} busy={busy} />
        </div>
      ) : null}

      <div className="border-t border-os-border p-5 md:p-6">
        <SectionLabel>Hermes review</SectionLabel>

        {job.status === "reviewing" ? (
          <p className="mt-3 text-[15px] leading-6 text-os-muted">
            Hermes is reading the diff…
          </p>
        ) : job.review ? (
          <HermesReview review={job.review} />
        ) : (
          <p className="mt-3 max-w-[62ch] text-[15px] leading-6 text-os-muted">
            This work has not been reviewed yet. Nothing can be approved until it
            has been.
          </p>
        )}

        {/* Said before the buttons, so a disabled action is never a mystery. */}
        {passed && awaiting && blockers.length > 0 ? (
          <div className="mt-6 rounded-md border border-os-warning/30 bg-os-warning/5 p-4">
            <p className="os-meta text-os-subtle">Cannot be applied</p>
            <ul className="mt-2 space-y-2.5">
              {blockers.map((blocker) => {
                const cure = cureFor(blocker);

                return (
                  <li
                    key={blocker.message}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                  >
                    <span className="max-w-[72ch] text-[13px] leading-5 text-os-muted">
                      {blocker.message}
                    </span>
                    {cure ? (
                      <button
                        type="button"
                        onClick={cure.run}
                        disabled={
                          repository.isPending ||
                          retry.isPending ||
                          review.isPending ||
                          validate.isPending
                        }
                        className="os-focus-ring os-meta shrink-0 cursor-pointer rounded-sm text-os-amber hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {cure.label}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* A refusal is an answer, so it is shown where it was asked for. */}
            {repository.data && !repository.data.ok ? (
              <p role="status" className="mt-3 max-w-[72ch] text-[13px] leading-5 text-os-warning">
                {repository.data.detail}
              </p>
            ) : null}
            {repository.data?.ok ? (
              <p role="status" className="mt-3 max-w-[72ch] text-[13px] leading-5 text-os-success">
                {repository.data.detail}
              </p>
            ) : null}
          </div>
        ) : null}

        {failure ? (
          <p className="mt-5 max-w-[72ch] text-[13px] leading-5 text-os-danger">
            {failure instanceof Error ? failure.message : "That action failed."}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {job.status === "rejected" ? (
            <>
              <span className="os-meta mr-2 text-os-subtle">
                Turned down. The work is kept until you discard it.
              </span>
              {job.worktreePath ? (
                <CommandButton
                  variant="danger"
                  icon={Trash2}
                  iconPosition="start"
                  onClick={() => discard.mutate(job.id)}
                  loading={discard.isPending}
                  loadingLabel="Discarding"
                >
                  Discard worktree
                </CommandButton>
              ) : null}
            </>
          ) : (
            <>
              {/* Approval is the only action that touches the real repository,
                  so it is the only one gated on every condition at once. */}
              {passed ? (
                <CommandButton
                  variant="primary"
                  icon={ArrowRight}
                  disabled={!canApprove || busy}
                  onClick={() => approve.mutate(job.id)}
                  loading={approve.isPending}
                  loadingLabel="Applying"
                >
                  Approve & apply
                </CommandButton>
              ) : null}

              {job.status === "changes_required" &&
              (job.review?.issues.length ?? 0) > 0 ? (
                <CommandButton
                  variant="primary"
                  icon={ArrowRight}
                  disabled={busy}
                  onClick={() => revise.mutate(job.id)}
                  loading={revise.isPending}
                  loadingLabel="Sending"
                >
                  Send back to the worker
                </CommandButton>
              ) : null}

              <CommandButton
                variant={job.review ? "quiet" : "primary"}
                disabled={busy || job.status === "reviewing"}
                onClick={() => review.mutate(job.id)}
                loading={review.isPending}
                loadingLabel="Reviewing"
              >
                {job.review ? "Review again" : "Review with Hermes"}
              </CommandButton>

              <CommandButton
                variant="quiet"
                disabled={busy}
                onClick={() => reject.mutate({ id: job.id })}
                loading={reject.isPending}
                loadingLabel="Rejecting"
              >
                Reject
              </CommandButton>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** How severe a finding is. The word carries it; tone only reinforces. */
const SEVERITY_TONE = {
  critical: "text-os-danger",
  major: "text-os-warning",
  minor: "text-os-subtle",
} as const;

/**
 * What the reviewer concluded.
 *
 * Criteria first, then findings. A verdict on its own is an opinion; a verdict
 * with the criteria it was measured against is something an operator can
 * actually disagree with.
 */
function HermesReview({ review }: { review: WorkerReview }) {
  const issues = [...review.issues].sort(bySeverity);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusPill
          status={verdictPill(review.verdict)}
          label={verdictLabel(review.verdict)}
        />
        {review.revision && review.revision > 1 ? (
          <span className="os-meta text-os-subtle">
            Revision {review.revision}
          </span>
        ) : null}
      </div>

      <p className="mt-4 max-w-[62ch] text-[15px] leading-6 text-os-muted">
        {review.summary}
      </p>

      {review.acceptanceCriteria.length > 0 ? (
        <div className="mt-6">
          <SectionLabel>Acceptance criteria</SectionLabel>
          <ul className="mt-3 space-y-2">
            {review.acceptanceCriteria.map((entry) => {
              const Icon = entry.satisfied ? Check : X;

              return (
                <li key={entry.criterion} className="flex min-w-0 gap-3">
                  <Icon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      entry.satisfied ? "text-os-success" : "text-os-danger",
                    )}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span className="text-[14px] leading-5 text-os-muted">
                      {entry.criterion}
                    </span>
                    {/* A sentence, so it is set as one — `os-meta` upper-cases,
                        which is right for a label and wrong for prose. */}
                    {entry.note ? (
                      <span className="mt-1 block max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                        {entry.note}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="mt-6">
          <SectionLabel>Findings</SectionLabel>
          <ul className="mt-3 space-y-5">
            {issues.map((issue) => (
              <li key={`${issue.severity}-${issue.title}`} className="min-w-0">
                <span className={cn("os-meta", SEVERITY_TONE[issue.severity])}>
                  {issue.severity}
                </span>
                <p className="mt-1.5 max-w-[62ch] text-[14px] leading-5 text-foreground">
                  {issue.title}
                </p>
                <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-os-muted">
                  {issue.detail}
                </p>
                {issue.file ? (
                  <p className="mt-1.5 font-mono text-[12px] leading-5 break-all text-os-subtle">
                    {issue.file}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * Enough of the diff to know what is being approved.
 *
 * Not a review tool — a person about to put this on their own branch should be
 * able to see what it is. Files are listed first so the shape of the change is
 * legible before any of it is read.
 */
function DiffViewer({
  diff,
  isPending,
  error,
}: {
  diff: WorkerDiff | undefined;
  isPending: boolean;
  error?: string;
}) {
  if (isPending) {
    return (
      <p className="mt-4 text-[13px] leading-5 text-os-subtle">
        Reading the diff…
      </p>
    );
  }

  if (error || !diff) {
    return (
      <p className="mt-4 text-[13px] leading-5 text-os-danger">
        {error ?? "That diff could not be read."}
      </p>
    );
  }

  if (diff.files.length === 0) {
    return (
      <p className="mt-4 text-[13px] leading-5 text-os-subtle">
        Nothing changed against the commit this job branched from.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <ul className="space-y-1.5">
        {diff.files.map((file) => (
          <li
            key={file.path}
            className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px] leading-5"
          >
            <span className="w-16 shrink-0 text-os-subtle">{file.status}</span>
            <span className="min-w-0 break-all text-os-muted">{file.path}</span>
            <span className="text-os-subtle">
              <span className="text-os-success">+{file.additions}</span>{" "}
              <span className="text-os-danger">−{file.deletions}</span>
            </span>
          </li>
        ))}
      </ul>

      {diff.truncated ? (
        <p className="mt-3 text-[13px] leading-5 text-os-subtle">
          Some patches were too large to show. The file list above is complete.
        </p>
      ) : null}

      <div className="mt-5 space-y-5">
        {diff.files
          .filter((file) => file.patch)
          .map((file) => (
            <div key={file.path} className="min-w-0">
              <p className="font-mono text-[12px] leading-5 break-all text-os-subtle">
                {file.path}
              </p>
              <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-os-border bg-os-border/10 p-3 font-mono text-[11px] leading-5">
                {file.patch!.split("\n").map((line, index) => (
                  <span
                    key={index}
                    className={cn(
                      "block whitespace-pre",
                      line.startsWith("+") && !line.startsWith("+++")
                        ? "text-os-success"
                        : line.startsWith("-") && !line.startsWith("---")
                          ? "text-os-danger"
                          : line.startsWith("@@")
                            ? "text-os-amber"
                            : "text-os-muted",
                    )}
                  >
                    {line || " "}
                  </span>
                ))}
              </pre>
            </div>
          ))}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="os-meta text-os-subtle">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 break-all text-[13px] leading-5 text-os-muted",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * What one run cost, against what it was allowed to cost.
 *
 * The ceiling is shown beside the spend rather than only in configuration,
 * because a figure on its own says nothing about whether a job stopped early:
 * $2.98 and $0.12 read identically until the $3.00 limit is next to them. The
 * meter is there for the same reason — a run that ended at its ceiling should
 * be recognisable at a glance, not by comparing two numbers.
 *
 * These are the runner's own estimates. They are evidence for the operator,
 * and later for routing; nothing is decided on them.
 */
function RunCost({
  metrics,
}: {
  metrics: NonNullable<NonNullable<WorkerJob["result"]>["providerMetrics"]>;
}) {
  const { costUsd, turns, sessionId, budgetUsd } = metrics;

  // A local run is reported as what it is: no provider API charge. It is not
  // shown as "$0.00 spent", which reads as a claim the whole cost was nil.
  if (metrics.location === "local") {
    return (
      <div className="space-y-1.5">
        <p className="text-[15px] leading-6 text-foreground">{providerChargeLabel(metrics)}</p>
        <p className="text-[13px] leading-5 text-os-subtle">{LOCAL_COST_CAVEAT}</p>
        {metrics.model ? (
          <p className="os-meta font-mono text-os-subtle">
            {metrics.model}
            {shortDigest(metrics.modelDigest) ? ` · ${shortDigest(metrics.modelDigest)}` : ""}
          </p>
        ) : null}
      </div>
    );
  }

  const spent = typeof costUsd === "number" ? costUsd : undefined;
  const ceiling =
    typeof budgetUsd === "number" && budgetUsd > 0 ? budgetUsd : undefined;

  // A run stops when the budget is spent, so at the ceiling the bar is full
  // and says so rather than overflowing.
  const ratio =
    spent !== undefined && ceiling !== undefined
      ? Math.min(spent / ceiling, 1)
      : undefined;

  const exhausted = ratio !== undefined && ratio >= 1;

  return (
    <div className="space-y-4">
      {spent !== undefined ? (
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "font-mono text-[20px] leading-none tabular-nums",
                exhausted ? "text-os-danger" : "text-foreground",
              )}
            >
              ${spent.toFixed(2)}
            </span>
            {ceiling !== undefined ? (
              <span className="font-mono text-[13px] leading-none tabular-nums text-os-subtle">
                / ${ceiling.toFixed(2)}
              </span>
            ) : null}
          </div>

          {ratio !== undefined ? (
            <div
              className="mt-2.5 h-[3px] w-full max-w-[240px] bg-os-border"
              role="img"
              aria-label={`$${spent.toFixed(2)} of $${ceiling?.toFixed(2)} spent`}
            >
              <div
                className={cn(
                  "h-full transition-[width] duration-500 motion-reduce:transition-none",
                  exhausted ? "bg-os-danger" : "bg-os-amber",
                )}
                style={{ width: `${Math.max(ratio * 100, 1)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <dl className="space-y-4">
        {typeof turns === "number" ? (
          <Detail label="Turns" value={String(turns)} mono />
        ) : null}
        {sessionId ? (
          <Detail label="Session" value={sessionId} mono />
        ) : null}
      </dl>
    </div>
  );
}

/**
 * The documents this run produced, as registered in the vault. Shown from the
 * documents list rather than the result's own claims, so a row here is a file
 * that exists where the link goes.
 */
function JobArtifacts({ job }: { job: WorkerJob }) {
  const { data } = useProjectDocuments(job.project);
  const artifacts = (data?.agentos ?? []).filter((document) => document.jobId === job.id);

  if (artifacts.length === 0) return null;

  return (
    <Section label="Artifacts" action={<span className="os-meta text-os-subtle tabular-nums">{artifacts.length}</span>}>
      <DocumentList documents={artifacts} />
    </Section>
  );
}
