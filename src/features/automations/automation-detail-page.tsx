import { ArrowLeft, Pause, Play, SquareTerminal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Automation, AutomationControl } from "@shared/agentos-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperSection, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { reportActivity } from "@/lib/agentos/client";
import { useAutomation, useControlAutomation } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { commandFor, formatRunTime, formatSchedule, stateTag } from "./automations-model";
import { RunHistory } from "./run-history";

const DONE: Record<AutomationControl, string> = {
  run: "Queued. Hermes starts it within a minute, with this job's prompt and delivery.",
  pause: "Paused. It won't run until you resume it.",
  resume: "Resumed. It's back on its schedule.",
};

function Fact({ label, children, tone = "char" }: { label: string; children: ReactNode; tone?: "char" | "flame" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-paper-sage">{label}</dt>
      <dd className={cn("mt-1 text-[14px] leading-6 break-words", tone === "flame" ? "text-paper-flame-deep" : "text-paper-char")}>
        {children}
      </dd>
    </div>
  );
}

export function AutomationDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const { data, isPending, isFetching, error, refetch } = useAutomation(id);

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="automation"
      activeHref="/automations"
      contextLabel={data ? `Automation / ${data.automation.name}` : undefined}
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        <Link
          to="/automations"
          className={cn(
            "-mx-2 inline-flex min-h-8 items-center gap-1.5 rounded-none px-2 text-[13px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
            PAPER_FOCUS,
          )}
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All automations
        </Link>

        {isPending ? (
          <p className="mt-6 text-[14px] text-paper-sage">Reading this job and its run history…</p>
        ) : !data ? (
          <div className="mt-6">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.015em]">This job couldn't be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
              {error?.message} Hermes may have removed it, or the CLI couldn't be reached.
            </p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <AutomationDetail automation={data.automation}>
            <RunHistory runs={data.runs} />
          </AutomationDetail>
        )}
      </PaperStage>
    </AppShell>
  );
}

function AutomationDetail({ automation, children }: { automation: Automation; children: ReactNode }) {
  const navigate = useNavigate();
  const control = useControlAutomation();
  const [receipt, setReceipt] = useState<string | undefined>();
  const tag = stateTag(automation);
  const command = commandFor(automation);
  const recipe = automation.recipe;
  const lastRun = automation.lastRun;
  const paused = automation.state === "paused";
  const finished = automation.state === "completed";
  const pending = control.isPending ? control.variables?.control : undefined;

  const act = (next: AutomationControl) => {
    setReceipt(undefined);
    if (next === "run") void reportActivity({ type: "automation.run", description: automation.name });
    control.mutate(
      { id: automation.id, control: next },
      {
        onSuccess: () => setReceipt(DONE[next]),
        onError: (failure) => setReceipt(failure instanceof Error ? failure.message : "Hermes didn't accept that."),
      },
    );
  };

  // The older path, kept as a secondary option: the skill alone, run live in
  // the agent console where its output streams, rather than as the scheduled job.
  const runInConsole = () => {
    if (!command) return;
    void reportActivity({ type: "automation.run", description: automation.name });
    navigate(`/agent?run=${encodeURIComponent(command)}`);
  };

  return (
    <>
      <header className="mt-5 flex flex-col gap-6 border-b border-paper-stone pb-8 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance text-paper-moss sm:text-[34px]">
              {automation.name}
            </h1>
            <Tag tone={tag.tone}>{tag.label}</Tag>
          </div>
          <p className="mt-2 text-[15px] text-paper-char">{formatSchedule(automation.schedule)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          <div className="flex flex-wrap gap-2">
            {!finished ? (
              <PaperButton variant="amber" disabled={control.isPending} onClick={() => act("run")}>
                <Play className="size-3.5" aria-hidden="true" />
                {pending === "run" ? "Queuing…" : "Run now"}
              </PaperButton>
            ) : null}
            {paused ? (
              <PaperButton variant="ghost" disabled={control.isPending} onClick={() => act("resume")}>
                <Play className="size-3.5" aria-hidden="true" />
                {pending === "resume" ? "Resuming…" : "Resume"}
              </PaperButton>
            ) : automation.state === "active" ? (
              <PaperButton variant="ghost" disabled={control.isPending} onClick={() => act("pause")}>
                <Pause className="size-3.5" aria-hidden="true" />
                {pending === "pause" ? "Pausing…" : "Pause"}
              </PaperButton>
            ) : null}
            {command ? (
              <PaperButton variant="quiet" onClick={runInConsole} title={`Run ${command} live in the Hermes console`}>
                <SquareTerminal className="size-3.5" aria-hidden="true" />
                Run in console
              </PaperButton>
            ) : null}
          </div>
          <p
            className={cn("min-h-5 max-w-[46ch] text-[12.5px] md:text-right", control.isError ? "text-paper-flame-deep" : "text-paper-sage")}
            role="status"
            aria-live="polite"
          >
            {receipt ?? ""}
          </p>
        </div>
      </header>

      {lastRun?.detail || automation.warnings.length > 0 ? (
        <div role="alert" className="mt-8 max-w-[80ch] rounded-none border border-paper-flame-deep px-5 py-4">
          <p className="text-[13px] font-semibold text-paper-flame-deep">Reported by Hermes</p>
          {lastRun?.detail ? (
            <p className="mt-2 font-mono text-[12.5px] leading-5 break-words text-paper-flame-deep">{lastRun.detail}</p>
          ) : null}
          {automation.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-[13.5px] leading-5 text-paper-char">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <PaperSection label="What it does">
            {recipe?.prompt || recipe?.script ? (
              <div className="rounded-none border border-paper-mist bg-paper-cream px-5 py-4">
                {recipe.prompt ? (
                  <p className="max-w-[72ch] text-[15px] leading-[1.65] whitespace-pre-wrap text-paper-moss">{recipe.prompt}</p>
                ) : null}
                {recipe.script ? (
                  <p className={cn("font-mono text-[12.5px] break-words text-paper-char", recipe.prompt && "mt-3")}>
                    Script: {recipe.script}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[14px] text-paper-sage">Hermes' job record for this job couldn't be read.</p>
            )}

            <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
              <Fact label="Skills">
                {automation.skills.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {automation.skills.map((skill) => (
                      <Tag key={skill}>{skill}</Tag>
                    ))}
                  </span>
                ) : (
                  "None"
                )}
              </Fact>
              <Fact label="Delivers to">{recipe?.deliver ?? "-"}</Fact>
              <Fact label="Model">
                {recipe?.model ? `${recipe.model}${recipe.provider ? ` via ${recipe.provider}` : ""}` : "Hermes' default model"}
              </Fact>
              <Fact label="Tools">{recipe && recipe.toolsets.length > 0 ? recipe.toolsets.join(", ") : "Hermes' defaults"}</Fact>
              <Fact label="Working folder">
                {recipe?.workdir ? <span className="font-mono text-[12.5px]">{recipe.workdir}</span> : "-"}
              </Fact>
              {recipe?.noAgent ? <Fact label="Model calls">None (script only)</Fact> : null}
            </dl>
          </PaperSection>
        </div>

        <div className="min-w-0">
          <PaperSection label="Timing">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Fact label="Last run" tone={lastRun?.status === "failed" ? "flame" : "char"}>
                {lastRun
                  ? `${lastRun.status === "failed" ? "Failed" : lastRun.status === "running" ? "Running" : "Worked"} · ${
                      formatRunTime(lastRun.timestamp) ?? lastRun.timestamp
                    }`
                  : "Never run"}
              </Fact>
              <Fact label="Next run">{formatRunTime(automation.nextRun) ?? (paused ? "Paused" : "Not scheduled")}</Fact>
            </dl>
          </PaperSection>
          <PaperSection label="Run history" className="mt-10">
            {children}
          </PaperSection>
        </div>
      </div>
    </>
  );
}
