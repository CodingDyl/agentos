import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { OperatorMode, RunbookSummary } from "@shared/operator-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useCreateOperatorRun, useOperatorRuns, useRunbooks } from "@/lib/agentos/operator";
import { cn } from "@/lib/utils";
import { groupRunsByDay, MODES, runStatusLabel, runStatusTone, formatTime } from "./operator-model";
import { OperatorRunView } from "./operator-run-view";

/**
 * Operator: say what you want done, and watch it happen.
 *
 * Not a chat. One request becomes one run: understood, planned against
 * Connectors, approved where it writes, executed step by step, and recorded.
 * The mode is chosen before anything is typed, because it is a permission:
 * Ask can't write, Plan can't act, Run acts only after approval.
 *
 * `/operator` is the composer; `/operator/runs/:id` is the same page with a
 * run open, so a run's URL can be kept and reopened later.
 */
export function OperatorPage() {
  const navigationItems = useNavigationItems();
  const { id } = useParams();
  const navigate = useNavigate();
  const create = useCreateOperatorRun();
  const [mode, setMode] = useState<OperatorMode>("run");
  const [input, setInput] = useState("");

  const start = (text: string, chosen: OperatorMode) => {
    create.mutate(
      { input: text, mode: chosen },
      {
        onSuccess: (run) => {
          setInput("");
          navigate(`/operator/runs/${encodeURIComponent(run.id)}`);
        },
      },
    );
  };

  return (
    <AppShell navigationItems={navigationItems} pageId="operator" activeHref="/operator" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <header>
              <p className="font-paper-utility text-[12px] font-medium tracking-[0.14em] text-paper-sage uppercase">Operator</p>
              <h1 className="mt-1 font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">
                What do you want to get done?
              </h1>
            </header>

            <Composer
              mode={mode}
              onModeChange={setMode}
              value={input}
              onValueChange={setInput}
              pending={create.isPending}
              onSubmit={(text) => start(text, mode)}
            />
            {create.isError ? (
              <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
                {create.error.message}
              </p>
            ) : null}

            {id ? (
              <OperatorRunView key={id} runId={id} onRunAgain={(text) => start(text, "run")} />
            ) : (
              <Runbooks
                onPick={(runbook) => {
                  setMode(runbook.mode);
                  setInput(runbook.example);
                }}
              />
            )}
          </div>

          <RecentRuns activeId={id} />
        </div>
      </PaperStage>
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
}: {
  mode: OperatorMode;
  onModeChange: (mode: OperatorMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  pending: boolean;
  onSubmit: (value: string) => void;
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

  const shortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form onSubmit={submit} className="mt-6" aria-label="New Operator request">
      <div role="radiogroup" aria-label="Mode" className="flex border-b border-paper-mist">
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
                "-mb-px min-h-10 flex-1 cursor-pointer border-b-2 px-3 font-paper-utility text-[14px] font-medium tracking-[0.14em] uppercase transition-colors duration-150 sm:flex-none sm:px-6",
                PAPER_FOCUS,
                selected ? "border-paper-blue text-paper-blue" : "border-transparent text-paper-sage hover:text-paper-moss",
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 border border-paper-mist bg-paper-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-paper-blue">
        <label htmlFor={inputId} className="sr-only">
          What do you want to get done?
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          value={value}
          rows={5}
          maxLength={4000}
          disabled={pending}
          aria-describedby={hintId}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={shortcut}
          placeholder="Build me a new SEO monitoring SaaS called RankPulse on my SSD, use Next.js and Supabase, create the GitHub repo and deploy it to Vercel."
          className="block min-h-36 w-full resize-y bg-transparent px-5 py-4 text-[16px] leading-7 text-paper-moss outline-none placeholder:text-paper-ash disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-stone px-5 py-3">
          <p id={hintId} className="text-[12.5px] text-paper-sage">
            {current.hint} <span className="hidden sm:inline">· ⌘ Enter</span>
          </p>
          <PaperButton type="submit" variant="amber" className="min-h-10 px-5" disabled={!value.trim() || pending}>
            {pending ? "Starting…" : current.action}
            <ArrowRight className="size-4" aria-hidden="true" />
          </PaperButton>
        </div>
      </div>
    </form>
  );
}

function Runbooks({ onPick }: { onPick: (runbook: RunbookSummary) => void }) {
  const { data } = useRunbooks();
  if (!data) return null;

  return (
    <section aria-label="Runbooks" className="mt-10">
      <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">Runbooks</h2>
      <p className="mt-1 text-[13px] text-paper-sage">The usual flow for each kind of request, already known. Pick one to start from its example.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.map((runbook) => {
          const built = runbook.steps.filter((step) => step.implemented).length;
          return (
            <li key={runbook.id}>
              <button
                type="button"
                onClick={() => onPick(runbook)}
                className={cn(
                  "flex h-full w-full cursor-pointer flex-col gap-2 border border-paper-mist bg-paper-white p-4 text-left transition-colors duration-150 hover:bg-paper-cream",
                  PAPER_FOCUS,
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-paper-display text-[15.5px] font-bold text-paper-moss">{runbook.name}</span>
                  <Tag tone="muted">{runbook.mode}</Tag>
                </span>
                <span className="text-[13px] leading-5 text-paper-char">{runbook.description}</span>
                <span className="mt-auto text-[12px] text-paper-sage tabular-nums">
                  {built} of {runbook.steps.length} steps built into AgentOS
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecentRuns({ activeId }: { activeId?: string }) {
  const { data, isPending, error } = useOperatorRuns();

  return (
    <aside aria-label="Recent runs" className="min-w-0 lg:border-l lg:border-paper-stone lg:pl-8">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-paper-utility text-[13px] font-medium tracking-[0.14em] text-paper-sage uppercase">Recent</h2>
        {activeId ? (
          <Link to="/operator" className={cn("font-paper-utility text-[12px] tracking-[0.1em] text-paper-blue uppercase hover:underline", PAPER_FOCUS)}>
            New request
          </Link>
        ) : null}
      </div>

      {isPending ? (
        <div aria-busy="true" className="mt-4 h-24 bg-paper-cream motion-safe:animate-pulse" />
      ) : error ? (
        <p role="alert" className="mt-4 text-[13px] text-paper-flame-deep">
          {error.message}
        </p>
      ) : !data || data.length === 0 ? (
        <p className="mt-4 text-[13px] leading-5 text-paper-sage">Nothing run yet. Every request you make here is kept, with what it changed.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {groupRunsByDay(data).map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 className="text-[12px] font-semibold text-paper-char">{group.label}</h3>
              <ul className="mt-2 divide-y divide-paper-stone">
                {group.runs.map((run) => (
                  <li key={run.id}>
                    <Link
                      to={`/operator/runs/${encodeURIComponent(run.id)}`}
                      aria-current={run.id === activeId ? "page" : undefined}
                      className={cn(
                        "block px-2 py-2.5 transition-colors duration-150 hover:bg-paper-cream",
                        run.id === activeId && "bg-paper-linen",
                        PAPER_FOCUS,
                      )}
                    >
                      <span className="block truncate text-[14px] font-semibold text-paper-moss">{run.title}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-paper-sage">{run.intent ?? run.input}</span>
                      <span className="mt-1.5 flex items-center justify-between gap-2">
                        <Tag tone={runStatusTone(run.status)} className="gap-1.5">
                          {runStatusLabel(run.status)}
                        </Tag>
                        <span className="text-[12px] text-paper-sage tabular-nums">
                          {run.mode} · {formatTime(run.startedAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
