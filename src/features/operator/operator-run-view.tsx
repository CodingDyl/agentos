import { ExternalLink, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { OperatorRun, OperatorStep, StepOutput } from "@shared/operator-types";
import { Markdown } from "@/components/os/markdown";
import { Meter, PAPER_FOCUS, PaperButton, Tag } from "@/components/paper";
import {
  useApproveOperatorRun,
  useCreateProposedTasks,
  useDecideMemoryProposal,
  useOperatorRun,
  useStopOperatorRun,
} from "@/lib/agentos/operator";
import { cn } from "@/lib/utils";
import {
  decisionRows,
  DOMAIN_LABEL,
  formatDuration,
  formatPercent,
  formatTime,
  isStoppable,
  linkKind,
  pendingExternalSteps,
  runStatusLabel,
  runStatusTone,
  stepCounts,
  stepGlyph,
  stepNumber,
  stepStatusLabel,
} from "./operator-model";

/**
 * One run, read top to bottom in the order it happened: what AgentOS took the
 * request to be, the plan, the approval, the live steps, and the result.
 *
 * Decisions are shown, not reasoning: what it was interpreted as, where it
 * goes, who does it, and why, in a sentence. Stop stays pinned to the top for
 * as long as the run can still do anything.
 */
export function OperatorRunView({ runId, onRunAgain }: { runId: string; onRunAgain: (input: string) => void }) {
  const { data: run, error, isPending } = useOperatorRun(runId);

  if (isPending) return <div aria-busy="true" aria-label="Reading the run" className="mt-10 h-64 bg-paper-cream motion-safe:animate-pulse" />;
  if (!run) {
    return (
      <div role="alert" className="mt-10 border border-paper-mist px-5 py-4">
        <p className="font-semibold text-paper-moss">This run couldn't be read.</p>
        <p className="mt-1 text-[13.5px] text-paper-char">{error?.message}</p>
      </div>
    );
  }

  return (
    <article aria-label={`Run: ${run.intent?.workspace?.name ?? run.input.slice(0, 60)}`} className="mt-4">
      <RunHeader run={run} />

      <blockquote className="mt-5 border-l-2 border-paper-mist pl-4 text-[14.5px] leading-6 text-paper-char">{run.input}</blockquote>

      {run.status === "planning" && run.plan.length === 0 ? (
        <p className="mt-8 text-[14px] text-paper-sage" aria-live="polite">
          Understanding the request and planning it…
        </p>
      ) : null}

      {run.intent ? <Decisions run={run} /> : null}
      {run.plan.length > 0 ? <Plan run={run} /> : null}
      <Approval run={run} />
      {run.mode === "plan" && run.status === "completed" && stepCounts(run.plan).runnable > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 border border-paper-mist bg-paper-cream px-5 py-4">
          <p className="flex-1 text-[13.5px] text-paper-char">This was a plan. Running it re-plans against Connectors as they are now, and asks before it writes.</p>
          <PaperButton variant="ghost" onClick={() => onRunAgain(run.input)}>
            Run this plan
          </PaperButton>
        </div>
      ) : null}
      <Report run={run} />
      <TaskProposals run={run} />
      <MemoryProposals run={run} />
      <Audit run={run} />
    </article>
  );
}

function RunHeader({ run }: { run: OperatorRun }) {
  const stop = useStopOperatorRun();
  const stoppable = isStoppable(run.status);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 bg-paper-white py-2", stoppable && "sticky top-0 z-20 border-b border-paper-stone")}>
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate font-paper-display text-[20px] font-extrabold tracking-[-0.01em] text-paper-moss uppercase">
          {run.intent?.workspace?.name ?? run.intent?.interpretedAs ?? "New run"}
        </h2>
        <Tag tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Tag>
        <span className="font-paper-utility text-[12px] tracking-[0.1em] text-paper-sage uppercase">{run.mode}</span>
      </div>
      {stoppable ? (
        <PaperButton variant="danger" disabled={stop.isPending} onClick={() => stop.mutate(run.id)} aria-describedby="stop-note">
          <Square className="size-3.5 fill-current" aria-hidden="true" />
          {stop.isPending ? "Stopping…" : "Stop run"}
        </PaperButton>
      ) : null}
      {stoppable ? (
        <p id="stop-note" className="sr-only">
          Stops workers and future steps. Keeps what already changed and reports it. Nothing is rolled back.
        </p>
      ) : null}
      {run.statusDetail ? <p className="w-full text-[13px] text-paper-char">{run.statusDetail}</p> : null}
      {stop.isError ? (
        <p role="alert" className="w-full text-[13px] text-paper-flame-deep">
          {stop.error.message}
        </p>
      ) : null}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="font-paper-utility text-[12px] font-medium tracking-[0.14em] text-paper-sage uppercase">{children}</p>;
}

function Decisions({ run }: { run: OperatorRun }) {
  const intent = run.intent;
  if (!intent) return null;
  const scores = intent.domainScores.filter((entry) => entry.score > 0).slice(0, 4);

  return (
    <section aria-label="How AgentOS read this" className="mt-8 grid gap-6 border border-paper-mist p-5 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {decisionRows(run).map((row) => (
            <div key={row.label} className="min-w-0">
              <dt>
                <Label>{row.label}</Label>
              </dt>
              <dd className="mt-0.5 truncate text-[14.5px] font-semibold text-paper-moss" title={row.value}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-5">
          <Label>Why</Label>
          <p className="mt-0.5 max-w-[70ch] text-[14px] leading-6 text-paper-char">{intent.why}</p>
        </div>
        {run.objective ? (
          <div className="mt-4">
            <Label>Objective</Label>
            <p className="mt-0.5 max-w-[70ch] text-[14px] leading-6 text-paper-char">{run.objective}</p>
          </div>
        ) : null}
      </div>

      <div>
        <Label>Domain</Label>
        <ul className="mt-2 space-y-2.5">
          {scores.map((entry) => (
            <li key={entry.domain}>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className={entry.domain === intent.domain ? "font-semibold text-paper-moss" : "text-paper-char"}>{DOMAIN_LABEL[entry.domain]}</span>
                <span className="text-paper-sage tabular-nums">{formatPercent(entry.score)}</span>
              </div>
              <Meter value={entry.score} label={`${DOMAIN_LABEL[entry.domain]} ${formatPercent(entry.score)}`} tone={entry.domain === intent.domain ? "amber" : "ink"} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function OutputLink({ output }: { output: StepOutput }) {
  const kind = linkKind(output.href);
  const className = cn("inline-flex items-center gap-1 text-[13px] font-medium text-paper-blue underline-offset-2 hover:underline", PAPER_FOCUS);
  if (kind === "internal") {
    return (
      <Link to={output.href as string} className={className}>
        {output.label}
      </Link>
    );
  }
  if (kind === "external") {
    return (
      <a href={output.href} target="_blank" rel="noreferrer noopener" className={className}>
        {output.label}
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }
  return <span className="text-[13px] text-paper-char">{output.label}</span>;
}

function StepRow({ step, index }: { step: OperatorStep; index: number }) {
  const muted = step.status === "blocked" || step.status === "skipped" || step.status === "stopped";
  return (
    <li className="grid grid-cols-[2rem_1.25rem_minmax(0,1fr)] gap-x-2 px-4 py-3 sm:grid-cols-[2.25rem_1.5rem_minmax(0,1fr)_auto]">
      <span className="font-mono text-[12.5px] text-paper-sage tabular-nums">{stepNumber(index)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "text-[14px] leading-5",
          step.status === "done" && "text-paper-blue",
          step.status === "running" && "text-paper-blue motion-safe:animate-pulse",
          step.status === "failed" && "text-paper-flame-deep",
          muted && "text-paper-ash",
          step.status === "pending" && "text-paper-sage",
        )}
      >
        {stepGlyph(step.status)}
      </span>
      <div className="min-w-0">
        <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-semibold", muted ? "text-paper-sage" : "text-paper-moss")}>
          {step.title}
          <span className="sr-only">: {stepStatusLabel(step.status)}</span>
          {step.external ? <Tag tone="marigold">External</Tag> : null}
        </p>
        <p className="mt-0.5 text-[12.5px] text-paper-sage">
          {step.actor}
          {step.detail ? ` · ${step.detail}` : ""}
        </p>
        {step.result && step.status === "done" ? <p className="mt-1 text-[13px] text-paper-char">{step.result}</p> : null}
        {step.reason ? (
          <p className={cn("mt-1 text-[13px]", step.status === "failed" ? "text-paper-flame-deep" : "text-paper-char")}>{step.reason}</p>
        ) : null}
        {step.fix && step.status === "blocked" ? (
          <p className="mt-1">
            <OutputLink output={step.fix} />
          </p>
        ) : null}
        {step.outputs.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {step.outputs.map((output) => (
              <OutputLink key={`${output.label}:${output.href ?? ""}`} output={output} />
            ))}
          </p>
        ) : null}
      </div>
      <span className="col-start-3 mt-1 text-[12px] text-paper-sage sm:col-start-4 sm:mt-0 sm:text-right" aria-hidden="true">
        {stepStatusLabel(step.status)}
      </span>
    </li>
  );
}

function Plan({ run }: { run: OperatorRun }) {
  const counts = stepCounts(run.plan);
  return (
    <section aria-label="Plan" className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">Plan</h3>
        <p className="text-[12.5px] text-paper-sage tabular-nums" aria-live="polite">
          {counts.done} done · {counts.runnable} to run · {counts.blocked} can't run here
        </p>
      </div>
      <ol className="divide-y divide-paper-stone border border-paper-mist">
        {run.plan.map((step, index) => (
          <StepRow key={step.id} step={step} index={index} />
        ))}
      </ol>
    </section>
  );
}

function Approval({ run }: { run: OperatorRun }) {
  const approve = useApproveOperatorRun();
  if (run.status !== "awaiting_approval") return null;
  const external = pendingExternalSteps(run.plan);
  const local = run.plan.filter((step) => step.status === "pending" && !step.external && step.risk !== "read");

  return (
    <section aria-label="Approval" className="mt-6 border-[1.5px] border-paper-blue p-5">
      <h3 className="font-paper-display text-[16px] font-bold text-paper-moss">Nothing has run yet</h3>
      {external.length > 0 ? (
        <div className="mt-3">
          <Label>External changes</Label>
          <ul className="mt-1 list-disc pl-5 text-[14px] leading-6 text-paper-char">
            {external.map((step) => (
              <li key={step.id}>{step.title}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-[13.5px] text-paper-char">No external changes: everything that runs stays on this machine.</p>
      )}
      {local.length > 0 ? (
        <div className="mt-3">
          <Label>Local changes</Label>
          <ul className="mt-1 list-disc pl-5 text-[14px] leading-6 text-paper-char">
            {local.map((step) => (
              <li key={step.id}>{step.title}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.risks.length > 0 ? (
        <div className="mt-3">
          <Label>Risks</Label>
          <ul className="mt-1 list-disc pl-5 text-[13.5px] leading-6 text-paper-char">
            {run.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-paper-sage">
          {run.usage.estimate} · agents: {run.agents.join(", ") || "none"} · connectors: {run.connectors.join(", ") || "none"}
        </p>
        <PaperButton variant="amber" className="min-h-10 px-5" disabled={approve.isPending} onClick={() => approve.mutate(run.id)}>
          {approve.isPending ? "Starting…" : "Approve & run"}
        </PaperButton>
      </div>
      {approve.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {approve.error.message}
        </p>
      ) : null}
    </section>
  );
}

function Report({ run }: { run: OperatorRun }) {
  const report = run.report;
  if (!report) return null;

  return (
    <section aria-label="Result" className="mt-8">
      <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">Result</h3>
      {report.summary ? <p className="mt-1 text-[14px] text-paper-char">{report.summary}</p> : null}
      {report.answer ? (
        <div className="mt-4 border border-paper-mist p-5">
          <Markdown content={report.answer} tone="paper" />
        </div>
      ) : null}
      {report.sources.length > 0 ? (
        <div className="mt-4">
          <Label>Drew on</Label>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {report.sources.map((source) => (
              <OutputLink key={`${source.label}:${source.href ?? ""}`} output={source} />
            ))}
          </p>
        </div>
      ) : null}
      {report.nextAction ? (
        <div className="mt-4 border-l-2 border-paper-blue pl-4">
          <Label>Next action</Label>
          <p className="mt-0.5 text-[14px] text-paper-moss">{report.nextAction}</p>
        </div>
      ) : null}
    </section>
  );
}

function TaskProposals({ run }: { run: OperatorRun }) {
  const create = useCreateProposedTasks();
  // Everything starts ticked; the set holds what the person unticked, so
  // proposals that arrive on a later poll are ticked too.
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  if (run.taskProposals.length === 0 || !["completed", "blocked", "failed", "stopped"].includes(run.status)) return null;

  // Only a Run may add tasks: a plan's workspace may not exist yet.
  const creatable = run.mode === "run";
  const open = creatable ? run.taskProposals.filter((proposal) => !proposal.taskId) : [];
  const picked = (id: string) => !unticked.has(id);
  const chosen = open.filter((proposal) => picked(proposal.id));

  return (
    <section aria-label="Proposed tasks" className="mt-8">
      <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">Proposed tasks</h3>
      <ul className="mt-3 divide-y divide-paper-stone border border-paper-mist">
        {run.taskProposals.map((proposal) => (
          <li key={proposal.id} className="flex items-start gap-3 px-4 py-3">
            {proposal.taskId || !creatable ? (
              <span className="mt-0.5 w-4 text-[14px] text-paper-blue" aria-hidden="true">
                {proposal.taskId ? "✓" : "○"}
              </span>
            ) : (
              <input
                type="checkbox"
                id={`proposal-${proposal.id}`}
                checked={picked(proposal.id)}
                onChange={(event) => {
                  const next = new Set(unticked);
                  if (event.currentTarget.checked) next.delete(proposal.id);
                  else next.add(proposal.id);
                  setUnticked(next);
                }}
                className="mt-1 size-4 accent-paper-blue"
              />
            )}
            <label htmlFor={proposal.taskId || !creatable ? undefined : `proposal-${proposal.id}`} className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-paper-moss">{proposal.title}</span>
              <span className="block text-[12.5px] text-paper-sage">
                {proposal.section} · {proposal.workspaceSlug}
                {proposal.taskId ? ` · added as ${proposal.taskId}` : ""}
                {proposal.why ? ` · ${proposal.why}` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {open.length > 0 ? (
        <PaperButton
          variant="amber"
          className="mt-3"
          disabled={chosen.length === 0 || create.isPending}
          onClick={() => create.mutate({ id: run.id, ids: chosen.map((proposal) => proposal.id) })}
        >
          {create.isPending ? "Adding…" : `Create ${chosen.length} task${chosen.length === 1 ? "" : "s"}`}
        </PaperButton>
      ) : null}
      {create.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {create.error.message}
        </p>
      ) : null}
    </section>
  );
}

function MemoryProposals({ run }: { run: OperatorRun }) {
  const decide = useDecideMemoryProposal();
  if (run.memoryProposals.length === 0) return null;

  return (
    <section aria-label="Proposed memory" className="mt-8">
      <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">Proposed memory</h3>
      <p className="mt-1 text-[13px] text-paper-sage">Interpretations, not facts: they become decisions in the workspace only if you accept them.</p>
      <ul className="mt-3 space-y-3">
        {run.memoryProposals.map((proposal) => (
          <li key={proposal.id} className="border border-paper-mist p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14.5px] font-semibold text-paper-moss">{proposal.title}</p>
              {proposal.status === "proposed" ? (
                <span className="flex gap-2">
                  <PaperButton variant="quiet" disabled={decide.isPending} onClick={() => decide.mutate({ id: run.id, proposalId: proposal.id, decision: "dismiss" })}>
                    Dismiss
                  </PaperButton>
                  <PaperButton variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: run.id, proposalId: proposal.id, decision: "accept" })}>
                    Accept
                  </PaperButton>
                </span>
              ) : (
                <Tag tone={proposal.status === "accepted" ? "blue" : "muted"}>{proposal.status}</Tag>
              )}
            </div>
            <p className="mt-1 text-[13.5px] leading-6 whitespace-pre-line text-paper-char">{proposal.body}</p>
          </li>
        ))}
      </ul>
      {decide.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {decide.error.message}
        </p>
      ) : null}
    </section>
  );
}

/** Everything needed to audit the run afterwards. */
function Audit({ run }: { run: OperatorRun }) {
  const duration = formatDuration(run.startedAt, run.completedAt);
  const facts: { label: string; value: string }[] = [
    { label: "Started", value: formatTime(run.startedAt) },
    ...(run.approvedAt ? [{ label: "Approved", value: formatTime(run.approvedAt) }] : []),
    ...(run.completedAt ? [{ label: "Finished", value: `${formatTime(run.completedAt)}${duration ? ` (${duration})` : ""}` }] : []),
    { label: "Agents", value: run.agents.join(", ") || "None" },
    { label: "Connectors", value: run.connectors.join(", ") || "None" },
    { label: "Model calls", value: String(run.usage.modelCalls) },
    { label: "Tokens", value: run.usage.tokens !== undefined ? run.usage.tokens.toLocaleString() : "Not reported" },
    { label: "Cost", value: run.usage.costUsd !== undefined ? `$${run.usage.costUsd.toFixed(4)}` : "Not priced" },
    { label: "Estimate", value: run.usage.estimate },
  ];

  return (
    <section aria-label="Audit" className="mt-10 border-t border-paper-stone pt-6">
      <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">What changed</h3>
      {run.changes.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-paper-sage">Nothing. No file, task or service was changed by this run.</p>
      ) : (
        <ul className="mt-2 divide-y divide-paper-stone border border-paper-mist">
          {run.changes.map((change) => (
            <li key={`${change.at}:${change.description}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
              <span className="text-[13.5px] text-paper-moss">
                {change.href ? <OutputLink output={{ label: change.description, href: change.href }} /> : change.description}
              </span>
              <span className="text-[12px] text-paper-sage tabular-nums">
                {change.kind === "external" ? "External · " : ""}
                {formatTime(change.at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {run.errors.length > 0 ? (
        <div className="mt-4">
          <Label>Errors</Label>
          <ul className="mt-1 list-disc pl-5 text-[13px] leading-6 text-paper-flame-deep">
            {run.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt>
              <Label>{fact.label}</Label>
            </dt>
            <dd className="mt-0.5 truncate text-[13.5px] text-paper-moss" title={fact.value}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
