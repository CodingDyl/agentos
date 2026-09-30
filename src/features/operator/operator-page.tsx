import { ArrowUp, Square, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isRunSettled, type OperatorMode, type RunbookSummary } from "@shared/operator-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useCreateOperatorRun, useOperatorRun, useOperatorRuns, useRunbooks, useStopOperatorRun } from "@/lib/agentos/operator";
import { cn } from "@/lib/utils";
import { JarvisConsole } from "./jarvis-console";
import { isStoppable, MODES } from "./operator-model";
import { OperatorRunView } from "./operator-run-view";
import { RunMessage } from "./operator-thread";
import { useOperatorJarvis } from "./use-operator-jarvis";

/**
 * Operator: say what you want done, and watch it happen.
 *
 * Laid out like a conversation. Jarvis sits at the top and leads: while this
 * page is open, what he hears becomes a run, and he says what each run is
 * doing. Each request is a message; the reply says what is happening while it
 * runs and gives only the breakdown when it ends. Clicking a reply opens the
 * full record (decisions, every step, the audit) at `/operator/runs/:id`, so
 * that view keeps a URL of its own.
 *
 * The mode is a permission, chosen beside the send button: Ask can't write,
 * Plan can't act, Run acts only after approval.
 */

const PAGE = 20;

export function OperatorPage() {
  const navigationItems = useNavigationItems();
  const { id } = useParams();
  const navigate = useNavigate();
  const create = useCreateOperatorRun();
  const stop = useStopOperatorRun();
  const { data: runs, isPending, error } = useOperatorRuns();
  const [mode, setMode] = useState<OperatorMode>("run");
  const [input, setInput] = useState("");
  const [shown, setShown] = useState(PAGE);

  // The newest run is the one Jarvis follows and the one voice commands act on.
  const latestId = runs?.[0]?.id;
  const { data: latest } = useOperatorRun(latestId);

  const start = (text: string, chosen: OperatorMode) => {
    create.mutate({ input: text, mode: chosen }, { onSuccess: () => setInput("") });
  };

  const voice = useOperatorJarvis({ run: latest, mode, setMode, start });

  // Oldest at the top, newest at the bottom, as in any conversation.
  const thread = (runs ?? []).slice(0, shown).reverse();
  const doneSteps = latest?.plan.filter((step) => step.status === "done").length ?? 0;

  // Keep the newest message in view as it arrives and as it changes.
  const bottom = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (thread.length === 0) return;
    bottom.current?.scrollIntoView({ block: "end", behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [thread.length, latest?.status, doneSteps]);

  const active = latest && isStoppable(latest.status) ? latest : undefined;

  return (
    <AppShell navigationItems={navigationItems} pageId="operator" activeHref="/operator" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col">
          <header>
            <p className="font-paper-utility text-[12px] font-medium tracking-[0.14em] text-paper-sage uppercase">Operator</p>
            <h1 className="mt-1 font-paper-display text-[26px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[32px]">
              What do you want to get done?
            </h1>
          </header>

          <JarvisConsole narrating={voice.narrating} onNarratingChange={voice.setNarrating} />

          <section aria-label="Conversation" className="mt-8 flex-1">
            {isPending ? (
              <div aria-busy="true" className="h-24 bg-paper-cream motion-safe:animate-pulse" />
            ) : error ? (
              <p role="alert" className="text-[13.5px] text-paper-flame-deep">
                {error.message}
              </p>
            ) : thread.length === 0 ? (
              <Runbooks
                onPick={(runbook) => {
                  setMode(runbook.mode);
                  setInput(runbook.example);
                }}
              />
            ) : (
              <>
                {(runs?.length ?? 0) > shown ? (
                  <div className="mb-6 text-center">
                    <PaperButton variant="quiet" onClick={() => setShown((count) => count + PAGE)}>
                      Show earlier
                    </PaperButton>
                  </div>
                ) : null}
                <ol className="space-y-8">
                  {thread.map((run) => (
                    <RunMessage
                      key={run.id}
                      runId={run.id}
                      onOpen={(runId) => navigate(`/operator/runs/${encodeURIComponent(runId)}`)}
                      onRunAgain={(text) => start(text, "run")}
                    />
                  ))}
                </ol>
              </>
            )}
          </section>

          <Composer
            mode={mode}
            onModeChange={setMode}
            value={input}
            onValueChange={setInput}
            pending={create.isPending}
            onSubmit={(text) => start(text, mode)}
            error={create.isError ? create.error.message : undefined}
            onStop={active ? () => stop.mutate(active.id) : undefined}
            stopping={stop.isPending}
          />
          {/* Below the pinned composer, so scrolling here shows the whole last message above it. */}
          <div ref={bottom} />
        </div>
      </PaperStage>

      {id ? <RunDetails runId={id} onClose={() => navigate("/operator")} onRunAgain={(text) => start(text, "run")} /> : null}
    </AppShell>
  );
}

function Composer({
  mode,
  onModeChange,
  value,
  onValueChange,
  pending,
  onSubmit,
  error,
  onStop,
  stopping,
}: {
  mode: OperatorMode;
  onModeChange: (mode: OperatorMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  pending: boolean;
  onSubmit: (value: string) => void;
  error?: string;
  /** Set while the newest run can still be stopped: the always-there emergency stop. */
  onStop?: () => void;
  stopping: boolean;
}) {
  const inputId = useId();
  const hintId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const current = MODES.find((entry) => entry.value === mode) ?? MODES[2];

  // A runbook pick fills the box; put the cursor where the person will edit.
  useEffect(() => {
    if (value && document.activeElement !== textarea.current) textarea.current?.focus();
  }, [value]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();
    if (text && !pending) onSubmit(text);
  };

  // Enter sends, as in any messaging app. Shift+Enter is a new line.
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form onSubmit={submit} aria-label="New Operator request" className="sticky bottom-0 z-10 -mx-1 mt-8 bg-paper-white px-1 pt-3 pb-1">
      {onStop ? (
        <div className="mb-2 flex justify-end">
          <PaperButton variant="danger" onClick={onStop} disabled={stopping} aria-label="Stop the current run">
            <Square className="size-3 fill-current" aria-hidden="true" />
            {stopping ? "Stopping…" : "Stop run"}
          </PaperButton>
        </div>
      ) : null}
      <div className="border border-paper-mist bg-paper-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-paper-blue">
        <label htmlFor={inputId} className="sr-only">
          What do you want to get done?
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          value={value}
          rows={2}
          maxLength={4000}
          disabled={pending}
          aria-describedby={hintId}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={keys}
          placeholder="Message Operator, or press Jarvis and say it"
          className="block max-h-48 min-h-14 w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-6 text-paper-moss outline-none placeholder:text-paper-ash disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-paper-stone px-3 py-2">
          <div role="radiogroup" aria-label="Mode" className="flex">
            {MODES.map((entry) => {
              const selected = entry.value === mode;
              return (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onModeChange(entry.value)}
                  className={cn(
                    "min-h-8 cursor-pointer border-b-2 px-3 font-paper-utility text-[13px] font-medium tracking-[0.14em] uppercase transition-colors duration-150",
                    PAPER_FOCUS,
                    selected ? "border-paper-blue text-paper-blue" : "border-transparent text-paper-sage hover:text-paper-moss",
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
          <p id={hintId} className="hidden min-w-0 flex-1 truncate text-[12px] text-paper-sage md:block">
            {current.hint}
          </p>
          <PaperButton type="submit" variant="amber" className="ml-auto min-h-9" disabled={!value.trim() || pending}>
            {pending ? "Sending…" : current.action}
            <ArrowUp className="size-4" aria-hidden="true" />
          </PaperButton>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function Runbooks({ onPick }: { onPick: (runbook: RunbookSummary) => void }) {
  const { data } = useRunbooks();
  if (!data) return null;

  return (
    <div role="region" aria-label="Runbooks">
      <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">Start from a runbook</h2>
      <p className="mt-1 text-[13px] text-paper-sage">The usual flow for each kind of request, already known. Pick one to fill in its example.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.map((runbook) => {
          const built = runbook.steps.filter((step) => step.implemented).length;
          return (
            <li key={runbook.id}>
              <button
                type="button"
                onClick={() => onPick(runbook)}
                className={cn("flex h-full w-full cursor-pointer flex-col gap-2 border border-paper-mist bg-paper-white p-4 text-left transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}
              >
                <span className="font-paper-display text-[15.5px] font-bold text-paper-moss">{runbook.name}</span>
                <span className="text-[13px] leading-5 text-paper-char">{runbook.description}</span>
                <span className="mt-auto text-[12px] text-paper-sage tabular-nums">
                  {built} of {runbook.steps.length} steps built into AgentOS
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The full record of one run, over the conversation. Escape, the backdrop or ✕ closes it. */
function RunDetails({ runId, onClose, onRunAgain }: { runId: string; onClose: () => void; onRunAgain: (input: string) => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const { data: run } = useOperatorRun(runId);

  useEffect(() => {
    close.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-paper-moss/30" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Run details"
        className="absolute inset-y-0 right-0 flex w-full max-w-[780px] flex-col border-l border-paper-mist bg-paper-white font-paper-ui text-paper-moss"
      >
        <header className="flex items-center justify-between gap-3 border-b border-paper-stone px-5 py-3 sm:px-8">
          <p className="font-paper-utility text-[12px] font-medium tracking-[0.14em] text-paper-sage uppercase">
            Details{run && !isRunSettled(run.status) ? " · live" : ""}
          </p>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className={cn("inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone", PAPER_FOCUS)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 sm:px-8">
          <OperatorRunView
            runId={runId}
            onRunAgain={(text) => {
              onClose();
              onRunAgain(text);
            }}
          />
        </div>
      </section>
    </div>
  );
}
