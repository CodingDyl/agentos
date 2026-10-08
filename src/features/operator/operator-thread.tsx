import { ChevronRight, Square } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { OperatorRun } from "@shared/operator-types";
import { Markdown } from "@/components/os/markdown";
import { PAPER_FOCUS, PaperButton, Tag } from "@/components/paper";
import { useApproveOperatorRun, useOperatorRun, useStopOperatorRun } from "@/lib/agentos/operator";
import { cn } from "@/lib/utils";
import { formatTime, isStoppable, linkKind, pendingExternalSteps, runDigest, runStatusLabel, runStatusTone } from "./operator-model";

/**
 * Operator as a conversation: your request on the right, Jarvis's reply on
 * the left. While a run goes, the reply says what it is doing; when it ends,
 * it gives the breakdown and nothing else. The whole record (decisions, every
 * step, the audit) opens from the message.
 */

/** Buttons inside a clickable message must not also open it. */
function own(handler: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  };
}

export function RunMessage({ runId, onOpen, onRunAgain }: { runId: string; onOpen: (id: string) => void; onRunAgain: (input: string) => void }) {
  const { data: run, error } = useOperatorRun(runId);

  if (!run) {
    return error ? (
      <p role="alert" className="text-[13px] text-paper-flame-deep">
        {error.message}
      </p>
    ) : (
      <div aria-busy="true" className="h-16 w-2/3 bg-paper-cream motion-safe:animate-pulse" />
    );
  }

  return (
    <li className="space-y-3" aria-label={`Request: ${run.input.slice(0, 80)}`}>
      <UserBubble run={run} />
      <JarvisBubble run={run} onOpen={() => onOpen(run.id)} onRunAgain={onRunAgain} />
    </li>
  );
}

/**
 * Just the reply half of a run: the live card a chat shows for `/run`, `/plan`
 * or `/ask`, with the same approve, stop and breakdown as on the runs page.
 */
export function RunReply({ runId, onOpen, onRunAgain }: { runId: string; onOpen: (id: string) => void; onRunAgain: (input: string) => void }) {
  const { data: run, error } = useOperatorRun(runId);
  if (!run) {
    return error ? (
      <p role="alert" className="text-[13px] text-paper-flame-deep">
        {error.message}
      </p>
    ) : (
      <div aria-busy="true" className="h-16 w-2/3 bg-paper-cream motion-safe:animate-pulse" />
    );
  }
  return <JarvisBubble run={run} onOpen={() => onOpen(run.id)} onRunAgain={onRunAgain} />;
}

function UserBubble({ run }: { run: OperatorRun }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(85%,620px)]">
        <p className="bg-paper-blue px-4 py-3 text-[15px] leading-6 whitespace-pre-line text-paper-white">{run.input}</p>
        <p className="mt-1 text-right text-[12px] text-paper-sage tabular-nums">
          <span className="font-paper-utility tracking-[0.1em] uppercase">{run.mode}</span> · {formatTime(run.startedAt)}
        </p>
      </div>
    </div>
  );
}

function Typing() {
  return (
    <span aria-hidden="true" className="inline-flex gap-1 align-middle">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="size-1.5 rounded-full bg-paper-sage motion-safe:animate-pulse" style={{ animationDelay: `${dot * 180}ms` }} />
      ))}
    </span>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="font-paper-utility text-[12px] font-medium tracking-[0.12em] text-paper-sage uppercase">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function JarvisBubble({ run, onOpen, onRunAgain }: { run: OperatorRun; onOpen: () => void; onRunAgain: (input: string) => void }) {
  const digest = runDigest(run);
  const approve = useApproveOperatorRun();
  const stop = useStopOperatorRun();
  const external = pendingExternalSteps(run.plan);
  const local = run.plan.filter((step) => step.status === "pending" && !step.external && step.risk !== "read");
  const fixes = run.plan.filter((step) => step.status === "blocked" && step.fix?.href && linkKind(step.fix.href) === "internal");

  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-1 inline-flex size-8 shrink-0 items-center justify-center bg-paper-moss font-paper-display text-[14px] font-extrabold text-paper-white">
        J
      </span>
      <div className="min-w-0 max-w-[min(90%,680px)] flex-1">
        {/* The whole message opens the details; the Details button is the keyboard way in. */}
        <div
          onClick={onOpen}
          className={cn(
            "cursor-pointer border bg-paper-white px-4 py-3 transition-colors duration-150 hover:bg-paper-cream",
            digest.phase === "needs-you" ? "border-[1.5px] border-paper-blue" : digest.phase === "problem" ? "border-paper-flame-deep/60" : "border-paper-mist",
          )}
        >
          {digest.headline ? (
            <p className={cn("text-[14.5px] leading-6", digest.phase === "problem" ? "text-paper-flame-deep" : "text-paper-moss")} aria-live="polite">
              {digest.phase === "working" ? (
                <>
                  <Typing /> <span className="ml-1">{digest.headline}</span>
                </>
              ) : (
                digest.headline
              )}
            </p>
          ) : null}

          {/* While working: what has happened so far, then what is happening now. */}
          {digest.phase === "working" && (digest.done.length > 0 || digest.current) ? (
            <ul className="mt-2 space-y-0.5 text-[13.5px]">
              {digest.done.map((title) => (
                <li key={title} className="text-paper-char">
                  <span className="text-paper-blue" aria-hidden="true">
                    ✓
                  </span>{" "}
                  {title}
                </li>
              ))}
              {digest.current ? (
                <li className="font-medium text-paper-moss">
                  <span className="text-paper-blue motion-safe:animate-pulse" aria-hidden="true">
                    ●
                  </span>{" "}
                  {digest.current}
                </li>
              ) : null}
            </ul>
          ) : null}

          {digest.answer ? <Markdown content={digest.answer} tone="paper" className={digest.headline ? "mt-2" : undefined} /> : null}

          {digest.phase === "needs-you" ? (
            <>
              {external.length > 0 ? (
                <Section label="Outside this machine">
                  <ul className="list-disc pl-5 text-[13.5px] leading-6 text-paper-char">
                    {external.map((step) => (
                      <li key={step.id}>{step.title}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              {local.length > 0 ? (
                <Section label="On this machine">
                  <ul className="list-disc pl-5 text-[13.5px] leading-6 text-paper-char">
                    {local.map((step) => (
                      <li key={step.id}>{step.title}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <PaperButton variant="amber" disabled={approve.isPending} onClick={own(() => approve.mutate(run.id))}>
                  {approve.isPending ? "Starting…" : "Approve & run"}
                </PaperButton>
                <PaperButton variant="danger" disabled={stop.isPending} onClick={own(() => stop.mutate(run.id))}>
                  Stop
                </PaperButton>
              </div>
              {approve.isError ? <p className="mt-2 text-[13px] text-paper-flame-deep">{approve.error.message}</p> : null}
            </>
          ) : null}

          {digest.wouldRun.length > 0 && run.status === "completed" ? (
            <Section label="Would run">
              <ol className="list-decimal pl-5 text-[13.5px] leading-6 text-paper-char">
                {digest.wouldRun.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ol>
            </Section>
          ) : null}

          {/* The breakdown, once it's over. */}
          {digest.phase !== "working" && digest.phase !== "needs-you" && run.mode === "run" ? (
            digest.changes.length > 0 ? (
              <Section label="What changed">
                <ul className="space-y-0.5 text-[13.5px] leading-6 text-paper-char">
                  {digest.changes.map((change) => (
                    <li key={`${change.at}:${change.description}`}>
                      <span className="text-paper-blue" aria-hidden="true">
                        ✓
                      </span>{" "}
                      {change.href && linkKind(change.href) === "internal" ? (
                        <Link to={change.href} onClick={(event) => event.stopPropagation()} className={cn("text-paper-blue underline-offset-2 hover:underline", PAPER_FOCUS)}>
                          {change.description}
                        </Link>
                      ) : (
                        change.description
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null
          ) : null}

          {digest.phase !== "working" && digest.nextAction && run.mode !== "ask" ? (
            <Section label="Next">
              <p className="text-[13.5px] leading-6 text-paper-moss">{digest.nextAction}</p>
            </Section>
          ) : null}

          {digest.phase !== "working" && fixes.length > 0 ? (
            <Section label="To unblock">
              <ul className="space-y-0.5 text-[13.5px] leading-6 text-paper-char">
                {fixes.map((step) => (
                  <li key={step.id}>
                    {step.title}:{" "}
                    <Link
                      to={step.fix?.href ?? "/connectors"}
                      onClick={(event) => event.stopPropagation()}
                      className={cn("font-medium text-paper-blue underline-offset-2 hover:underline", PAPER_FOCUS)}
                    >
                      {step.fix?.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {digest.openTasks > 0 || digest.openMemory > 0 ? (
            <p className="mt-3 text-[13px] text-paper-char">
              Waiting on you:{" "}
              {[
                digest.openTasks > 0 ? `${digest.openTasks} proposed task${digest.openTasks === 1 ? "" : "s"}` : undefined,
                digest.openMemory > 0 ? `${digest.openMemory} memory proposal${digest.openMemory === 1 ? "" : "s"}` : undefined,
              ]
                .filter(Boolean)
                .join(" and ")}
              . Open the details to review.
            </p>
          ) : null}

          {run.mode === "plan" && run.status === "completed" && digest.wouldRun.length > 0 ? (
            <div className="mt-3">
              <PaperButton variant="ghost" onClick={own(() => onRunAgain(run.input))}>
                Run this plan
              </PaperButton>
            </div>
          ) : null}

          {run.status === "running" || run.status === "planning" ? (
            <div className="mt-3">
              <PaperButton variant="danger" disabled={stop.isPending} onClick={own(() => stop.mutate(run.id))}>
                <Square className="size-3 fill-current" aria-hidden="true" />
                Stop
              </PaperButton>
            </div>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-paper-sage">
          <span className="font-paper-utility tracking-[0.1em] uppercase">Jarvis · Operator</span>
          <Tag tone={runStatusTone(run.status)} className="text-[12px] leading-4">
            {runStatusLabel(run.status)}
          </Tag>
          {isStoppable(run.status) ? null : <span className="tabular-nums">{formatTime(run.completedAt)}</span>}
          {digest.sourceCount > 0 ? <span>· drew on {digest.sourceCount} note{digest.sourceCount === 1 ? "" : "s"}</span> : null}
          <button
            type="button"
            onClick={own(onOpen)}
            className={cn("ml-auto inline-flex items-center gap-0.5 font-medium text-paper-blue hover:underline", PAPER_FOCUS)}
            aria-label={`Details of “${run.input.slice(0, 60)}”`}
          >
            Details
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
