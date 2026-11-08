import { useState, type ReactNode } from "react";
import { AlertCircle, Check, EyeOff, FlaskConical, RotateCcw, Wrench, X } from "lucide-react";
import { Link } from "react-router-dom";
import { pageNameForRoute, type FrictionStatus, type RankedFrictionItem } from "@shared/friction-types";
import { PageLoader } from "@/components/os";
import { FieldLabel, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import { useAssignToAgent, useFriction, useSetRegression, useStartRegressionJob, useUpdateFriction, useVerifyFriction } from "@/lib/agentos/friction";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Friction with full repair lifecycle.
 *
 * Extended workflow: report, assign to agent, track work, review, verify, notify.
 * Statuses: Open, Assigned, In progress, Needs review, Fixed, Verified, Ignored.
 */
export function FrictionTab() {
  const friction = useFriction();
  const update = useUpdateFriction();

  if (friction.isPending) return <PageLoader variant="compact" />;
  if (friction.error || !friction.data) {
    return <p className="text-[14px] text-paper-flame-deep">{friction.error?.message ?? "Friction could not be read."}</p>;
  }

  const { open, closed } = friction.data;
  const active = open.filter((item) => ["assigned", "in-progress", "needs-review"].includes(item.status));
  const openNotActive = open.filter((item) => item.status === "open");
  const verified = closed.filter((item) => item.status === "verified");
  const otherClosed = closed.filter((item) => item.status !== "verified");

  return (
    <div className="max-w-[1100px]">
      <p className="max-w-[64ch] text-[14px] leading-6 text-paper-char">
        What has got in the way, worst first. Report more from anywhere with{" "}
        <kbd className="border border-paper-mist px-1 font-mono text-[12px]">⌘K</kbd> → Report friction.
      </p>

      {active.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-paper-moss">In progress ({active.length})</h2>
          <ul className="mt-3 divide-y divide-paper-mist border-y border-paper-mist">
            {active.map((item) => (
              <FrictionRow key={item.id} item={item}>
                <RowActions item={item} />
              </FrictionRow>
            ))}
          </ul>
        </section>
      ) : null}

      {openNotActive.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-paper-moss">Open ({openNotActive.length})</h2>
          <ul className="mt-3 divide-y divide-paper-mist border-y border-paper-mist">
            {openNotActive.map((item) => (
              <FrictionRow key={item.id} item={item}>
                <RowActions item={item} />
              </FrictionRow>
            ))}
          </ul>
        </section>
      ) : null}

      {open.length === 0 ? (
        <p className="mt-6 text-[14px] text-paper-sage">Nothing open. Either AgentOS is behaving, or nobody has said otherwise yet.</p>
      ) : null}

      {update.error ? (
        <p role="alert" className="mt-4 text-[14px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}

      {verified.length > 0 ? (
        <details className="mt-10">
          <summary className="cursor-pointer text-[13px] font-semibold text-paper-sage">
            Verified ({verified.length})
          </summary>
          <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
            {verified.map((item) => (
              <FrictionRow key={item.id} item={item}>
                <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "open" })}>
                  <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden="true" /> Reopen
                </PaperButton>
              </FrictionRow>
            ))}
          </ul>
        </details>
      ) : null}

      {otherClosed.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-[13px] font-semibold text-paper-sage">
            Fixed and ignored ({otherClosed.length})
          </summary>
          <ul className="mt-2 divide-y divide-paper-mist border-y border-paper-mist">
            {otherClosed.map((item) => (
              <FrictionRow key={item.id} item={item}>
                <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "open" })}>
                  <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden="true" /> Reopen
                </PaperButton>
              </FrictionRow>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function FrictionRow({ item, children }: { item: RankedFrictionItem; children: ReactNode }) {
  const page = pageNameForRoute(item.route);
  const isClosed = ["fixed", "verified", "ignored"].includes(item.status);
  const showProgress = item.repairJobs && item.repairJobs.length > 0;

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={isClosed ? "text-[14px] text-paper-sage line-through" : "text-[14px] font-medium text-paper-moss"}>
              {item.description}
            </p>
            <StatusTag status={item.status} />
            {item.tier === "high" ? (
              <Tag tone="flame">High priority</Tag>
            ) : null}
          </div>
          
          {item.expected ? <p className="mt-1 text-[13px] text-paper-char">Should have: {item.expected}</p> : null}
          {item.reproduction ? <p className="mt-1 text-[13px] text-paper-sage">Reproduction: {item.reproduction}</p> : null}
          
          <div className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-paper-sage">
            {item.kind === "correction" ? <span>Correction</span> : null}
            <span>
              {capitalise(item.frequency)} · {capitalise(item.severity)}
            </span>
            {page ? <span>{page}</span> : null}
            <span>{formatRelativeTime(item.createdAt)}</span>
            {item.project && item.project !== "agentos" ? <span>Project: {item.project}</span> : null}
          </div>

          {item.failureReason ? (
            <div className="mt-2 flex gap-2 rounded-md border border-paper-flame-deep bg-paper-cream px-3 py-2">
              <AlertCircle className="size-4 shrink-0 text-paper-flame-deep" />
              <p className="text-[13px] text-paper-flame-deep">{item.failureReason}</p>
            </div>
          ) : null}

          {showProgress ? <RepairProgress item={item} /> : null}
          {item.kind === "correction" ? <RegressionPanel item={item} /> : null}
          {item.verification ? <VerificationPanel verification={item.verification} /> : null}
        </div>
        
        <div className="flex shrink-0 gap-1.5">{children}</div>
      </div>
    </li>
  );
}

function StatusTag({ status }: { status: FrictionStatus }) {
  const labels: Record<FrictionStatus, string> = {
    open: "Open",
    assigned: "Assigned",
    "in-progress": "In progress",
    "needs-review": "Needs review",
    fixed: "Fixed",
    verified: "Verified",
    ignored: "Ignored",
  };

  const tones: Record<FrictionStatus, "green" | "blue" | "marigold" | "flame" | "muted"> = {
    open: "flame",
    assigned: "blue",
    "in-progress": "blue",
    "needs-review": "marigold",
    fixed: "green",
    verified: "green",
    ignored: "muted",
  };

  return <Tag tone={tones[status]}>{labels[status]}</Tag>;
}

function RepairProgress({ item }: { item: RankedFrictionItem }) {
  if (!item.repairJobs || item.repairJobs.length === 0) return null;

  const latestJob = item.repairJobs[item.repairJobs.length - 1];

  return (
    <div className="mt-3 rounded-md border border-paper-mist bg-paper-linen px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Wrench className="size-3.5 text-paper-sage" />
        <Link to={`/workers/jobs/${latestJob.jobId}`} className="font-medium text-paper-moss hover:underline">
          Repair job
        </Link>
        <span className="text-paper-sage">·</span>
        <span className={latestJob.status === "failed" || latestJob.status === "blocked" ? "text-paper-flame-deep" : "text-paper-char"}>
          {latestJob.status === "running"
            ? "Running"
            : latestJob.status === "completed"
              ? "Completed"
              : latestJob.status === "failed"
                ? "Failed"
                : "Blocked"}
        </span>
        {latestJob.worker ? (
          <>
            <span className="text-paper-sage">·</span>
            <span className="text-paper-sage">{latestJob.worker}</span>
          </>
        ) : null}
      </div>
      {latestJob.error ? (
        <p className="mt-1 text-[12px] text-paper-flame-deep">{latestJob.error}</p>
      ) : null}
      {latestJob.commitSha ? (
        <p className="mt-1 font-mono text-[12px] text-paper-sage">Commit: {latestJob.commitSha.slice(0, 8)}</p>
      ) : null}
      {item.repairJobs.length > 1 ? (
        <p className="mt-1 text-[12px] text-paper-sage">{item.repairJobs.length} attempts</p>
      ) : null}
    </div>
  );
}

function VerificationPanel({ verification }: { verification: NonNullable<RankedFrictionItem["verification"]> }) {
  return (
    <div className="mt-3 rounded-md border border-paper-moss bg-paper-linen px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Check className="size-3.5 text-paper-moss" />
        <span className="font-medium text-paper-moss">Verified</span>
        {verification.ownerConfirmed ? (
          <>
            <span className="text-paper-sage">·</span>
            <span className="text-paper-char">Owner confirmed</span>
          </>
        ) : null}
      </div>
      {verification.checkCommand ? (
        <p className="mt-1 font-mono text-[12px] text-paper-sage">Check: {verification.checkCommand}</p>
      ) : null}
      {verification.checkResult ? (
        <p className="mt-1 text-[12px] text-paper-char">{verification.checkResult}</p>
      ) : null}
      {verification.commitSha ? (
        <p className="mt-1 font-mono text-[12px] text-paper-sage">Commit: {verification.commitSha.slice(0, 8)}</p>
      ) : null}
    </div>
  );
}

function RegressionPanel({ item }: { item: RankedFrictionItem }) {
  const regression = item.regression ?? { status: "needed" as const };
  const setRegression = useSetRegression();
  const startJob = useStartRegressionJob();
  const [mode, setMode] = useState<"covered" | "not-testable" | null>(null);
  const [text, setText] = useState("");
  const busy = setRegression.isPending || startJob.isPending;
  const error = setRegression.error ?? startJob.error;
  const readOnly = ["assigned", "in-progress", "needs-review", "fixed", "verified", "ignored"].includes(item.status);

  const save = () => {
    if (mode === null || !text.trim()) return;
    setRegression.mutate(
      mode === "covered" ? { id: item.id, status: "covered", testPath: text.trim() } : { id: item.id, status: "not-testable", reason: text.trim() },
      {
        onSuccess: () => {
          setMode(null);
          setText("");
        },
      },
    );
  };

  const labels = {
    needed: "Needs a test",
    "in-progress": "A job is writing the test",
    covered: "Covered by a test",
    "not-testable": "Cannot be tested",
  };

  return (
    <div className="mt-3 border-l-2 border-paper-mist pl-3">
      <p className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-paper-char">
        <FlaskConical className="size-3.5 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
        <span className="font-medium text-paper-moss">{labels[regression.status]}</span>
        {regression.testPath ? <code className="font-mono text-[12px] text-paper-sage">{regression.testPath}</code> : null}
        {regression.reason ? <span className="text-paper-sage">{regression.reason}</span> : null}
        {regression.status === "in-progress" && regression.jobId ? (
          <Link to={`/workers/jobs/${regression.jobId}`} className="underline decoration-paper-gold underline-offset-4">
            See the job
          </Link>
        ) : null}
      </p>

      {!readOnly && regression.status === "needed" && mode === null ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <PaperButton variant="ghost" disabled={busy} onClick={() => startJob.mutate(item.id)}>
            {startJob.isPending ? "Starting…" : "Write the test"}
          </PaperButton>
          <PaperButton variant="quiet" disabled={busy} onClick={() => setMode("covered")}>
            Mark covered
          </PaperButton>
          <PaperButton variant="quiet" disabled={busy} onClick={() => setMode("not-testable")}>
            Cannot be tested
          </PaperButton>
        </div>
      ) : null}

      {!readOnly && mode !== null ? (
        <form
          className="mt-2 flex max-w-[560px] flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="min-w-0 flex-1">
            <FieldLabel>{mode === "covered" ? "Path of the test, inside the repository" : "Why it cannot be tested"}</FieldLabel>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={mode === "covered" ? 300 : 500}
              placeholder={mode === "covered" ? "server/friction/__tests__/corrections.test.ts" : "A wording change with nothing to assert"}
              className={cn(PAPER_INPUT, "w-full")}
            />
          </label>
          <PaperButton type="submit" variant="ghost" disabled={busy || !text.trim()}>
            {setRegression.isPending ? "Saving…" : "Save"}
          </PaperButton>
          <PaperButton
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setMode(null);
              setText("");
            }}
          >
            Cancel
          </PaperButton>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}

function RowActions({ item }: { item: RankedFrictionItem }) {
  const update = useUpdateFriction();
  const assignToAgent = useAssignToAgent();
  const verify = useVerifyFriction();
  const [verifyMode, setVerifyMode] = useState(false);

  const activeJob = item.repairJobs?.find((job) => job.status === "running");
  const canAssign = item.status === "open" && !activeJob;
  const needsReview = item.status === "needs-review";
  const canVerify = item.status === "fixed";

  if (verifyMode) {
    return (
      <>
        <PaperButton
          variant="ghost"
          disabled={verify.isPending}
          onClick={() => {
            verify.mutate(
              { id: item.id, ownerConfirmed: true },
              { onSuccess: () => setVerifyMode(false) },
            );
          }}
        >
          <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {verify.isPending ? "Verifying…" : "Confirm verified"}
        </PaperButton>
        <PaperButton variant="quiet" disabled={verify.isPending} onClick={() => setVerifyMode(false)}>
          <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Cancel
        </PaperButton>
      </>
    );
  }

  if (item.status === "open") {
    return (
      <>
        {canAssign ? (
          <PaperButton
            variant="ghost"
            disabled={assignToAgent.isPending}
            onClick={() => assignToAgent.mutate({ id: item.id, worker: "auto" })}
          >
            <Wrench className="size-3.5" strokeWidth={2} aria-hidden="true" />
            {assignToAgent.isPending ? "Assigning…" : "Assign to agent"}
          </PaperButton>
        ) : null}
        <PaperButton variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "fixed" })}>
          <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> Fixed
        </PaperButton>
        <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "ignored" })}>
          <EyeOff className="size-3.5" strokeWidth={2} aria-hidden="true" /> Ignore
        </PaperButton>
      </>
    );
  }

  if (needsReview) {
    return (
      <>
        <PaperButton variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "fixed" })}>
          <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> Approve
        </PaperButton>
        <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "open" })}>
          <X className="size-3.5" strokeWidth={2} aria-hidden="true" /> Request changes
        </PaperButton>
      </>
    );
  }

  if (canVerify) {
    return (
      <>
        <PaperButton variant="ghost" onClick={() => setVerifyMode(true)}>
          <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> Verify
        </PaperButton>
        <PaperButton variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: "open" })}>
          <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden="true" /> Reopen
        </PaperButton>
      </>
    );
  }

  return null;
}

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
