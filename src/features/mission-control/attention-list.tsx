import { ArrowRight, Check, RefreshCw, Rocket, RotateCcw, Search, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { RebuildStageId } from "@shared/website-rebuild-types";
import type { AttentionItem, MissionWorker } from "@shared/mission-control-types";
import { PAPER_FOCUS, PaperButton, PaperSection, Tag } from "@/components/paper";
import {
  useDismissAttention,
  useRestoreAttention,
  useRetryWorkerJob,
  useApproveWorkerJob,
  useRejectWorkerJob,
  useReviseWorkerJob,
} from "@/lib/agentos/queries";
import { useApproveOperatorRun } from "@/lib/agentos/operator";
import { useDecideStage, useForcePreviewDeploy, useRecheckPreview, useRetryStage } from "@/lib/agentos/rebuilds";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { attentionTag, inboxSourceLabel } from "./mission-control-model";

/**
 * Approvals and blockers, aggregated into one inbox.
 *
 * The most important block on the Dashboard, and the one that has to earn its
 * prominence by disappearing. When nothing is waiting it says so in one
 * sentence: no empty card grid, no invented suggestion.
 *
 * Each row names its source and age, and acts inline (Approve / Retry / Open)
 * through the same handlers the owning screens use. Clearing hides that
 * occurrence from the Dashboard only.
 */

export interface AttentionListProps {
  items: AttentionItem[];
  dismissed: AttentionItem[];
  /** Who could take a retry: offered on failed cards, busy or not, but never an offline one. */
  workers: MissionWorker[];
  className?: string;
}

function ref(item: AttentionItem) {
  return { id: item.id, createdAt: item.createdAt };
}

export function AttentionList({ items, dismissed, workers, className }: AttentionListProps) {
  const dismiss = useDismissAttention();
  const restore = useRestoreAttention();
  const [lastCleared, setLastCleared] = useState<AttentionItem[]>([]);
  const [retried, setRetried] = useState<string | undefined>();
  const [showCleared, setShowCleared] = useState(false);

  const clear = (cleared: AttentionItem[]) => {
    setLastCleared(cleared);
    dismiss.mutate(cleared.map(ref));
  };

  const undo = () => {
    restore.mutate(lastCleared.map((item) => item.id));
    setLastCleared([]);
  };

  return (
    <PaperSection
      id="needs-you"
      label="Approvals & blockers"
      count={items.length > 0 ? items.length : undefined}
      className={className}
      action={
        items.length > 1 ? (
          <PaperButton variant="quiet" onClick={() => clear(items)} disabled={dismiss.isPending}>
            Clear all
          </PaperButton>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-[14px] text-paper-char">Nothing waiting on you</p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
          {items.map((item) => (
            <li key={`${item.id}@${item.createdAt}`}>
              <AttentionCard item={item} workers={workers} onClear={() => clear([item])} onRetried={setRetried} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-paper-sage" aria-live="polite">
        {retried ? <span>{retried}</span> : null}
        {lastCleared.length > 0 ? (
          <span>
            {lastCleared.length === 1 ? "Cleared 1 card." : `Cleared ${lastCleared.length} cards.`}{" "}
            <button
              type="button"
              onClick={undo}
              className={cn("rounded-[2px] font-semibold text-paper-moss underline decoration-paper-gold underline-offset-4", PAPER_FOCUS)}
            >
              Undo
            </button>
          </span>
        ) : null}
        {dismissed.length > 0 ? (
          <button
            type="button"
            aria-expanded={showCleared}
            onClick={() => setShowCleared((open) => !open)}
            className={cn("rounded-[2px] hover:text-paper-moss", PAPER_FOCUS)}
          >
            {showCleared ? "Hide cleared" : `${dismissed.length} cleared`}
          </button>
        ) : null}
      </div>

      {showCleared && dismissed.length > 0 ? (
        <div className="mt-2 rounded-none bg-paper-linen px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-medium text-paper-sage">Cleared from Dashboard, still current</p>
            <PaperButton variant="quiet" className="-mr-2" onClick={() => restore.mutate(undefined)} disabled={restore.isPending}>
              Restore all
            </PaperButton>
          </div>
          <ul className="mt-1 space-y-1">
            {dismissed.map((item) => (
              <li key={`${item.id}@${item.createdAt}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13.5px] text-paper-char">{item.title}</span>
                <PaperButton
                  variant="quiet"
                  className="-mr-2 shrink-0"
                  onClick={() => restore.mutate([item.id])}
                  disabled={restore.isPending}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Restore
                </PaperButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </PaperSection>
  );
}

/** Workers that could take a retry instead of the one that failed. `mock` is a test double, never offered. */
function alternativesFor(item: AttentionItem, workers: readonly MissionWorker[]): MissionWorker[] {
  return workers.filter((worker) => worker.id !== item.retry?.worker && worker.id !== "mock" && worker.status !== "offline");
}

/**
 * Approve, reject, or send back for revision, right on the card. Only shown for
 * worker jobs that are awaiting review or need changes sent back.
 */
function WorkerJobActions({
  item,
  onActioned,
}: {
  item: AttentionItem;
  onActioned: (message: string) => void;
}) {
  const approve = useApproveWorkerJob();
  const reject = useRejectWorkerJob();
  const revise = useReviseWorkerJob();

  if (!item.workerJob) return null;

  const { jobId, canApprove, canRevise } = item.workerJob;
  const busy = approve.isPending || reject.isPending || revise.isPending;

  return (
    <>
      {canApprove ? (
        <PaperButton
          variant="ghost"
          disabled={busy}
          onClick={() =>
            approve.mutate(jobId, {
              onSuccess: () => onActioned("Approved and integrated. It's done."),
            })
          }
        >
          <Check className="size-3.5" aria-hidden="true" />
          {approve.isPending ? "Applying..." : "Approve"}
        </PaperButton>
      ) : null}
      {canRevise ? (
        <PaperButton
          variant="ghost"
          disabled={busy}
          onClick={() =>
            revise.mutate(jobId, {
              onSuccess: () => onActioned("Sent back to the worker for revision."),
            })
          }
        >
          {revise.isPending ? "Sending..." : "Send back"}
        </PaperButton>
      ) : null}
      <PaperButton
        variant="quiet"
        disabled={busy}
        onClick={() =>
          reject.mutate(
            { id: jobId },
            {
              onSuccess: () => onActioned("Rejected. The work was not integrated."),
            },
          )
        }
      >
        {reject.isPending ? "Rejecting..." : "Reject"}
      </PaperButton>
      {approve.isError || reject.isError || revise.isError ? (
        <p className="basis-full text-[13px] text-paper-flame-deep" role="alert">
          {(approve.error ?? reject.error ?? revise.error)?.message ?? "That action did not complete."}
        </p>
      ) : null}
    </>
  );
}

/**
 * A failed job's retry, right on the card. After a usage limit the other
 * workers lead, because rerunning on the one that ran out would fail the same
 * way; otherwise it is one Retry, with the others a click away.
 */
function RetryActions({
  item,
  workers,
  onRetried,
}: {
  item: AttentionItem;
  workers: readonly MissionWorker[];
  onRetried: (message: string) => void;
}) {
  const retry = useRetryWorkerJob();
  const navigate = useNavigate();
  const [showOthers, setShowOthers] = useState(false);
  if (!item.retry) return null;

  const { jobId, worker, limitHit } = item.retry;
  const nameOf = (id: string) => workers.find((entry) => entry.id === id)?.name ?? id;
  const others = alternativesFor(item, workers);
  const pendingOn = retry.isPending ? (retry.variables as { worker?: string } | undefined)?.worker ?? worker : undefined;

  const run = (target?: string) =>
    retry.mutate(
      { id: jobId, worker: target },
      {
        onSuccess: ({ job }) => {
          onRetried(`Retrying on ${nameOf(target ?? worker)}.`);
          void navigate(`/workers/jobs/${job.id}`);
        },
      },
    );

  const otherButtons = others.map((entry) => (
    <PaperButton key={entry.id} variant={limitHit ? "ghost" : "quiet"} disabled={retry.isPending} onClick={() => run(entry.id)}>
      {pendingOn === entry.id ? "Starting…" : `Retry on ${entry.name}`}
    </PaperButton>
  ));

  return (
    <>
      {limitHit ? (
        <p className="basis-full mb-0 text-[13px] text-paper-char">
          {nameOf(worker)} hit a usage limit. {others.length > 0 ? "Another worker can take it:" : "No other worker is available right now."}
        </p>
      ) : null}
      {limitHit ? otherButtons : null}
      <PaperButton variant={limitHit ? "quiet" : "ghost"} disabled={retry.isPending} onClick={() => run()}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        {pendingOn === worker ? "Starting…" : limitHit ? `Retry on ${nameOf(worker)} anyway` : "Retry"}
      </PaperButton>
      {!limitHit && others.length > 0 ? (
        showOthers ? (
          otherButtons
        ) : (
          <PaperButton variant="quiet" onClick={() => setShowOthers(true)} aria-expanded={false}>
            Another worker
          </PaperButton>
        )
      ) : null}
      {retry.isError ? (
        <p className="basis-full text-[13px] text-paper-flame-deep" role="alert">
          {retry.error instanceof Error ? retry.error.message : "That retry didn't start."}
        </p>
      ) : null}
    </>
  );
}

function RebuildInboxActions({ item, onActioned }: { item: AttentionItem; onActioned: (message: string) => void }) {
  const rebuild = item.rebuild;
  const decide = useDecideStage(rebuild?.runId ?? "");
  const retry = useRetryStage(rebuild?.runId ?? "");
  const force = useForcePreviewDeploy(rebuild?.runId ?? "");
  const recheck = useRecheckPreview(rebuild?.runId ?? "");

  if (!rebuild) return null;

  const stage = rebuild.stage as RebuildStageId;
  const busy = decide.isPending || retry.isPending || force.isPending || recheck.isPending;
  const error = decide.error ?? retry.error ?? force.error ?? recheck.error;

  return (
    <>
      {rebuild.approve ? (
        <PaperButton
          variant="ghost"
          disabled={busy || rebuild.revision === undefined}
          onClick={() =>
            decide.mutate(
              { stage, revision: rebuild.revision ?? 0, decision: "approve" },
              { onSuccess: () => onActioned("Approved. The rebuild will continue.") },
            )
          }
        >
          <Check className="size-3.5" aria-hidden="true" />
          {decide.isPending ? "Approving…" : "Approve"}
        </PaperButton>
      ) : null}
      {rebuild.retry ? (
        <PaperButton
          variant="ghost"
          disabled={busy}
          onClick={() => retry.mutate({ stage }, { onSuccess: () => onActioned("Retrying that stage.") })}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {retry.isPending ? "Retrying…" : "Retry"}
        </PaperButton>
      ) : null}
      {rebuild.forceDeploy ? (
        <PaperButton
          variant="amber"
          disabled={busy}
          onClick={() => force.mutate(undefined as never, { onSuccess: () => onActioned("Forcing a new Vercel deploy.") })}
        >
          <Rocket className="size-3.5" aria-hidden="true" />
          {force.isPending ? "Deploying…" : "Deploy now (force)"}
        </PaperButton>
      ) : null}
      {rebuild.recheck ? (
        <PaperButton
          disabled={busy}
          onClick={() => recheck.mutate(undefined as never, { onSuccess: () => onActioned("Re-checking Vercel.") })}
        >
          <Search className="size-3.5" aria-hidden="true" />
          {recheck.isPending ? "Checking Vercel…" : "Re-check Vercel"}
        </PaperButton>
      ) : null}
      {error ? (
        <p className="basis-full text-[13px] text-paper-flame-deep" role="alert">
          {error.message}
        </p>
      ) : null}
    </>
  );
}

function OperatorInboxActions({ item, onActioned }: { item: AttentionItem; onActioned: (message: string) => void }) {
  const approve = useApproveOperatorRun();
  if (!item.operator?.approve) return null;

  return (
    <>
      <PaperButton
        variant="ghost"
        disabled={approve.isPending}
        onClick={() =>
          approve.mutate(item.operator!.runId, {
            onSuccess: () => onActioned("Approved. The operator run will continue."),
          })
        }
      >
        <Check className="size-3.5" aria-hidden="true" />
        {approve.isPending ? "Approving…" : "Approve"}
      </PaperButton>
      {approve.isError ? (
        <p className="basis-full text-[13px] text-paper-flame-deep" role="alert">
          {approve.error instanceof Error ? approve.error.message : "That approval did not complete."}
        </p>
      ) : null}
    </>
  );
}

/** One decision, where to go and make it, a way to clear it, and inline actions. */
function AttentionCard({
  item,
  workers,
  onClear,
  onRetried,
}: {
  item: AttentionItem;
  workers: readonly MissionWorker[];
  onClear: () => void;
  onRetried: (message: string) => void;
}) {
  const tag = attentionTag(item);
  const source = inboxSourceLabel(item);
  const age = formatRelativeTime(item.createdAt);

  return (
    <div className="group flex min-w-0 gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-paper-cream">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Tag tone={tag.tone}>{item.occurrences ? `${tag.label} ${item.occurrences}×` : tag.label}</Tag>
          <span className="text-[12px] font-medium text-paper-sage">{source}</span>
          {age ? (
            <span className="text-[12px] text-paper-sage" title={item.createdAt}>
              {age}
            </span>
          ) : null}
          {item.project ? <span className="text-[12px] font-medium text-paper-sage">{item.project}</span> : null}
        </div>

        <p className="mt-1 max-w-[70ch] text-[14.5px] leading-5 font-semibold [overflow-wrap:anywhere] text-paper-moss">
          {item.title}
        </p>

        {item.description ? (
          <p className="mt-0.5 line-clamp-2 max-w-[80ch] text-[13px] leading-5 break-words text-paper-char">
            {item.description}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {item.rebuild ? (
            <RebuildInboxActions item={item} onActioned={onRetried} />
          ) : item.operator ? (
            <OperatorInboxActions item={item} onActioned={onRetried} />
          ) : (
            <>
              <WorkerJobActions item={item} onActioned={onRetried} />
              <RetryActions item={item} workers={workers} onRetried={onRetried} />
            </>
          )}
          <Link
            to={item.action.href}
            className={cn(
              "inline-flex min-h-8 items-center gap-1 px-2.5 text-[13px] font-semibold text-paper-blue hover:underline",
              PAPER_FOCUS,
            )}
          >
            {item.action.label || "Open"}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear "${item.title}" from Dashboard`}
        title="Clear from Dashboard"
        className={cn(
          "-mr-1 flex size-8 shrink-0 items-center justify-center rounded-none text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
          PAPER_FOCUS,
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
