import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  VisualIssue,
  VisualVerificationResult,
} from "@shared/visual-verification-types";
import type { WorkerJob } from "@shared/worker-types";
import { CommandButton, SectionLabel, StatusPill } from "@/components/os";
import { workerScreenshotUrl } from "@/lib/agentos/client";
import {
  useRequestVisualRevision,
  useVerifyWorkerJobVisually,
  useWorkerJobVisual,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { visualVerdictLabel, visualVerdictPill } from "./workers-model";

/**
 * What the implementation actually looks like.
 *
 * This block exists because a diff cannot answer the question it answers.
 * Everything above it in the review station is text about code; this is the
 * screen itself, photographed, beside the direction it was meant to follow.
 *
 * Two things drive how it is laid out. The imagery is the argument, so it is
 * given the room and the framing is kept to a hairline — a screenshot inside a
 * heavy card is a picture of a card. And the two sides of the comparison are
 * never allowed to look alike: the implementation is large and captioned by
 * route, the approved direction is a quiet strip beneath it, so it is never
 * ambiguous which one is the thing being judged.
 */

/** How severe a finding is. The word carries it; tone only reinforces. */
const SEVERITY_TONE = {
  major: "text-os-warning",
  minor: "text-os-subtle",
} as const;

/** Major findings first: a wrong layout should not sit below a wrong radius. */
function bySeverity(a: VisualIssue, b: VisualIssue): number {
  const order = { major: 0, minor: 1 } as const;
  return order[a.severity] - order[b.severity];
}

export interface VisualVerificationPanelProps {
  job: WorkerJob;
  /** True while some other action on the job is in flight. */
  busy?: boolean;
}

export function VisualVerificationPanel({
  job,
  busy = false,
}: VisualVerificationPanelProps) {
  const [showHistory, setShowHistory] = useState(false);

  const visual = useWorkerJobVisual(job.id, true);
  const verifyAgain = useVerifyWorkerJobVisually();
  const sendBack = useRequestVisualRevision();

  // The job record is the current verdict by definition; the endpoint is what
  // knows about the revisions before it.
  const current = job.visualVerification ?? visual.data?.current;

  const earlier = (visual.data?.history ?? []).filter(
    (entry) => entry.revision !== current?.revision,
  );

  const working = busy || verifyAgain.isPending || sendBack.isPending;

  const failure = [verifyAgain, sendBack].find(
    (mutation) => mutation.isError,
  )?.error;

  return (
    <div className="border-t border-os-border p-5 md:p-6">
      <SectionLabel>Visual verification</SectionLabel>

      {!current ? (
        <p className="mt-3 max-w-[62ch] text-[15px] leading-6 text-os-muted">
          This job asked to be checked against its design, and has not been yet.
          Nothing can be approved until it has been.
        </p>
      ) : (
        <VisualVerdict jobId={job.id} result={current} />
      )}

      {failure ? (
        <p className="mt-5 max-w-[72ch] text-[13px] leading-5 text-os-danger">
          {failure instanceof Error ? failure.message : "That action failed."}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {/* Offered only when there is something specific to ask for. A worker
            sent back without findings redesigns whatever it likes. */}
        {(current?.issues.length ?? 0) > 0 ? (
          <CommandButton
            variant="primary"
            icon={ArrowRight}
            disabled={working}
            onClick={() => sendBack.mutate(job.id)}
            loading={sendBack.isPending}
            loadingLabel="Sending"
          >
            Send visual notes back
          </CommandButton>
        ) : null}

        <CommandButton
          variant={current ? "quiet" : "primary"}
          icon={Camera}
          iconPosition="start"
          disabled={working}
          onClick={() => verifyAgain.mutate(job.id)}
          loading={verifyAgain.isPending}
          loadingLabel="Photographing"
        >
          {current ? "Photograph again" : "Verify visually"}
        </CommandButton>
      </div>

      {/* Kept, never overwritten: whether a revision fixed what was sent back
          is a comparison, and a comparison needs the attempt before it. */}
      {earlier.length > 0 ? (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
            className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            {showHistory ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
            {showHistory
              ? "Hide earlier revisions"
              : `Earlier revisions (${earlier.length})`}
          </button>

          {showHistory ? (
            <div className="mt-5 space-y-8 border-l border-os-border pl-5">
              {earlier.map((entry) => (
                <div key={entry.revision}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="os-meta text-os-subtle">
                      Revision {entry.revision}
                    </span>
                    <StatusPill
                      status={visualVerdictPill(entry.verdict)}
                      label={visualVerdictLabel(entry.verdict)}
                    />
                  </div>
                  <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-muted">
                    {entry.summary}
                  </p>
                  <Screenshots
                    jobId={job.id}
                    result={entry}
                    className="mt-4"
                    compact
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One verdict, with the evidence it was reached from.
 *
 * The order is the order a person reads in: what it looks like, what it was
 * compared against, what was concluded. A verdict stated before the pictures
 * would be asking someone to take it on trust.
 */
function VisualVerdict({
  jobId,
  result,
}: {
  jobId: string;
  result: VisualVerificationResult;
}) {
  const issues = [...result.issues].sort(bySeverity);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusPill
          status={visualVerdictPill(result.verdict)}
          label={visualVerdictLabel(result.verdict)}
        />
        {result.revision > 1 ? (
          <span className="os-meta text-os-subtle">
            Revision {result.revision}
          </span>
        ) : null}
      </div>

      <p className="mt-4 max-w-[62ch] text-[15px] leading-6 text-os-muted">
        {result.summary}
      </p>

      {/* Said plainly and set apart. "Checked and fine" and "could not be
          checked" must never be able to look like each other. */}
      {result.verdict === "unverifiable" && result.unverifiableReason ? (
        <div className="mt-5 max-w-[80ch] rounded-md border border-os-warning/30 bg-os-warning/5 p-4">
          <p className="os-meta text-os-subtle">Why it could not be judged</p>
          <p className="mt-2 text-[13px] leading-5 break-words text-os-muted">
            {result.unverifiableReason}
          </p>
        </div>
      ) : null}

      <Screenshots jobId={jobId} result={result} className="mt-8" />

      {result.references.length > 0 ? (
        <div className="mt-8">
          <SectionLabel>Approved direction</SectionLabel>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
            Direction, not a mockup. The implementation is not expected to match
            these exactly.
          </p>
          <ul className="mt-4 flex flex-wrap gap-3">
            {result.references.map((reference) => (
              <li key={reference.assetId}>
                <img
                  src={`/api/designs/assets/${encodeURIComponent(reference.assetId)}/media?size=thumbnail`}
                  alt={reference.notes ?? reference.filename}
                  title={reference.filename}
                  loading="lazy"
                  className="h-20 w-auto rounded-md border border-os-border object-cover"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.strengths.length > 0 ? (
        <div className="mt-8">
          <SectionLabel>What it gets right</SectionLabel>
          <ul className="mt-3 space-y-2">
            {result.strengths.map((strength) => (
              <li key={strength} className="flex min-w-0 gap-3">
                <Check
                  className="mt-0.5 size-3.5 shrink-0 text-os-success"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="max-w-[62ch] text-[14px] leading-5 text-os-muted">
                  {strength}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.criteria.length > 0 ? (
        <div className="mt-8">
          <SectionLabel>Design criteria</SectionLabel>
          <ul className="mt-3 space-y-2">
            {result.criteria.map((entry) => {
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
        <div className="mt-8">
          <SectionLabel>Visual findings</SectionLabel>
          <ul className="mt-3 space-y-5">
            {issues.map((issue) => (
              <li key={`${issue.category}-${issue.title}`} className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className={cn("os-meta", SEVERITY_TONE[issue.severity])}>
                    {issue.severity}
                  </span>
                  <span className="os-meta text-os-subtle">
                    {issue.category}
                  </span>
                  {issue.route ? (
                    <span className="font-mono text-[12px] leading-5 text-os-subtle">
                      {issue.route}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 max-w-[62ch] text-[14px] leading-5 text-foreground">
                  {issue.title}
                </p>
                <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-os-muted">
                  {issue.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * The captures themselves.
 *
 * A hairline and nothing else. Anything heavier competes with the screenshot
 * for the same job — and an over-framed grid is exactly the kind of finding
 * this whole step exists to catch, so the panel that reports it should not be
 * guilty of it.
 *
 * Captures are full-page and therefore tall, so each is anchored to its top:
 * the header, the first screenful and the hierarchy are what a verdict turns
 * on, and the full image is one click away.
 */
function Screenshots({
  jobId,
  result,
  className,
  compact = false,
}: {
  jobId: string;
  result: VisualVerificationResult;
  className?: string;
  compact?: boolean;
}) {
  if (result.screenshots.length === 0) {
    return (
      <p className={cn("text-[13px] leading-5 text-os-subtle", className)}>
        Nothing was captured for this revision.
      </p>
    );
  }

  return (
    <div className={className}>
      {!compact ? <SectionLabel>Implementation</SectionLabel> : null}

      <ul
        className={cn(
          "grid gap-x-6 gap-y-8",
          compact
            ? "mt-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
            : "mt-4 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]",
        )}
      >
        {result.screenshots.map((shot) => {
          const url = workerScreenshotUrl(jobId, result.revision, shot.filename);

          return (
            <li key={shot.filename} className="min-w-0">
              <div className="os-meta flex items-baseline justify-between gap-3 text-os-subtle">
                <span className="truncate font-mono normal-case tracking-normal">
                  {shot.route}
                </span>
                <span className="shrink-0">{shot.viewport}</span>
              </div>

              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="os-focus-ring mt-2 block overflow-hidden rounded-md border border-os-border transition-colors duration-150 hover:border-os-border-strong"
              >
                <img
                  src={url}
                  alt={`${shot.route} at the ${shot.viewport} viewport`}
                  loading="lazy"
                  width={shot.width}
                  height={shot.height}
                  className={cn(
                    "w-full object-cover object-top",
                    compact ? "max-h-40" : "max-h-[22rem]",
                  )}
                />
              </a>

              <p className="os-meta mt-2 text-os-subtle">
                {shot.width} × {shot.height}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
