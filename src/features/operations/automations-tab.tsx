import { ChevronDown, ChevronUp, Pause, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Automation, AutomationControl } from "@shared/agentos-types";
import { PageLoader } from "@/components/os";
import { PaperButton, Tag } from "@/components/paper";
import { useAutomationSurfaces, useAutomations, useControlAutomation, useControlCurator } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { reportActivity } from "@/lib/agentos/client";

/**
 * Scheduled tasks in Operations.
 *
 * Compact view of Hermes automations with expandable history and advanced
 * surfaces. Each job shows what it does, where results go, schedule, last
 * result, next run, with Pause/Resume and Run now controls.
 */
export function AutomationsTab() {
  const jobs = useAutomations();
  const surfaces = useAutomationSurfaces();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("automation");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const automations = jobs.data?.automations ?? [];
  const refreshing = jobs.isFetching || surfaces.isFetching;

  const refresh = () => {
    void jobs.refetch();
    void surfaces.refetch();
  };

  if (jobs.isPending) return <PageLoader variant="compact" />;

  if (!jobs.data) {
    return (
      <div className="rounded-md border border-paper-mist px-5 py-4">
        <p className="font-semibold text-paper-moss">Hermes schedule could not be read</p>
        <p className="mt-1 max-w-[72ch] text-[14px] leading-6 text-paper-char">
          {jobs.error?.message} Automations are read through the Hermes CLI. Check that{" "}
          <code className="font-mono text-[12px]">hermes</code> is on the server PATH, or set{" "}
          <code className="font-mono text-[12px]">HERMES_CLI_PATH</code>.
        </p>
        <PaperButton variant="amber" className="mt-4" disabled={jobs.isFetching} onClick={() => void jobs.refetch()}>
          {jobs.isFetching ? "Trying again…" : "Try again"}
        </PaperButton>
      </div>
    );
  }

  const schedulerOff = surfaces.data ? !surfaces.data.scheduler.running : false;
  const emergencyStop = surfaces.data ? surfaces.data.emergencyStop.engaged : false;

  return (
    <div className="max-w-[1200px]">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[14px] text-paper-char">
          What Hermes does on its own. Create and edit jobs with the Hermes CLI.
        </p>
        <PaperButton variant="quiet" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "size-3.5 motion-safe:animate-spin" : "size-3.5"} aria-hidden="true" />
          Refresh
        </PaperButton>
      </div>

      {emergencyStop && surfaces.data ? (
        <div role="alert" className="mt-6 rounded-md border border-paper-flame-deep bg-paper-cream px-5 py-4">
          <p className="text-[15px] font-semibold text-paper-flame-deep">Emergency stop is on</p>
          <p className="mt-1 max-w-[72ch] text-[14px] leading-6 text-paper-moss">
            Hermes will not start any scheduled job, kanban task or new gateway turn until it is lifted
            {surfaces.data.emergencyStop.reason ? ` ("${surfaces.data.emergencyStop.reason}")` : ""}. Work already
            running carries on. Lift it with <code className="font-mono text-[12px]">hermes resume</code>.
          </p>
        </div>
      ) : schedulerOff && surfaces.data ? (
        <div role="alert" className="mt-6 rounded-md border border-paper-marigold bg-paper-cream px-5 py-4">
          <p className="text-[15px] font-semibold text-paper-marigold">Scheduler is not running</p>
          <p className="mt-1 max-w-[72ch] text-[14px] leading-6 text-paper-char">
            {surfaces.data.scheduler.detail ? `${surfaces.data.scheduler.detail}. ` : ""}Scheduled jobs will not fire.
            Start it with <code className="font-mono text-[12px]">hermes gateway run</code>.
          </p>
        </div>
      ) : null}

      {!jobs.data.health.ok ? (
        <div role="status" className="mt-6 rounded-md border border-paper-flame-deep px-5 py-4">
          <p className="text-[13px] font-semibold text-paper-flame-deep">Hermes job check found problems</p>
          <ul className="mt-2 space-y-1 text-[14px] leading-6 text-paper-char">
            {(jobs.data.health.issues.length > 0
              ? jobs.data.health.issues
              : ["Hermes could not confirm the health of these jobs."]
            ).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6">
        <h2 className="text-[15px] font-semibold text-paper-moss">Scheduled tasks</h2>
        {automations.length === 0 ? (
          <p className="mt-3 text-[14px] text-paper-sage">
            Hermes has no scheduled jobs. Create one with{" "}
            <code className="font-mono text-[12px] text-paper-moss">hermes cron create</code>.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-paper-mist rounded-md border border-paper-mist">
            {automations.map((automation) => (
              <ScheduledTask key={automation.id} automation={automation} highlight={automation.id === highlightId} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-[14px] font-semibold text-paper-moss hover:text-paper-moss/80"
        >
          {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          Advanced
        </button>
        {showAdvanced && surfaces.data ? (
          <div className="mt-4">
            <AdvancedSurfaces surfaces={surfaces.data} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ScheduledTaskProps {
  automation: Automation;
  highlight?: boolean;
}

function ScheduledTask({ automation, highlight }: ScheduledTaskProps) {
  const control = useControlAutomation();
  const [expanded, setExpanded] = useState(highlight ?? false);
  const [receipt, setReceipt] = useState<string | undefined>();
  
  const pending = control.isPending ? control.variables?.control : undefined;
  const paused = automation.state === "paused";
  const finished = automation.state === "completed";
  const failed = automation.lastRun?.status === "failed";

  const act = (next: AutomationControl) => {
    setReceipt(undefined);
    if (next === "run") void reportActivity({ type: "automation.run", description: automation.name });
    control.mutate(
      { id: automation.id, control: next },
      {
        onSuccess: () => {
          const done: Record<AutomationControl, string> = {
            run: "Queued. Hermes starts it within a minute.",
            pause: "Paused. It will not run until you resume it.",
            resume: "Resumed. It is back on its schedule.",
          };
          setReceipt(done[next]);
        },
        onError: (error) => setReceipt(error instanceof Error ? error.message : "Hermes did not accept that."),
      },
    );
  };

  const stateLabel =
    automation.state === "active"
      ? "Active"
      : automation.state === "paused"
        ? "Paused"
        : automation.state === "completed"
          ? "Completed"
          : "Disabled";

  const stateTone =
    automation.state === "active" ? "green" : automation.state === "paused" ? "marigold" : "muted";

  return (
    <li className={cn("px-5 py-4", highlight && "bg-paper-cream")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-left text-[15px] font-semibold text-paper-moss hover:underline"
            >
              {automation.name}
            </button>
            <Tag tone={stateTone}>{stateLabel}</Tag>
            {failed ? <Tag tone="flame">Last run failed</Tag> : null}
          </div>

          <div className="mt-2 space-y-1 text-[13px] text-paper-char">
            {automation.recipe?.prompt ? (
              <p className="line-clamp-1">{automation.recipe.prompt}</p>
            ) : automation.recipe?.script ? (
              <p className="line-clamp-1 font-mono text-[12px]">{automation.recipe.script}</p>
            ) : null}
            
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-paper-sage">
              <span>Schedule: {automation.schedule}</span>
              {automation.recipe?.deliver ? <span>Delivers to: {automation.recipe.deliver}</span> : null}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className={failed ? "text-paper-flame-deep" : "text-paper-sage"}>
                Last run:{" "}
                {automation.lastRun
                  ? `${automation.lastRun.status === "failed" ? "Failed" : automation.lastRun.status === "running" ? "Running" : "Worked"} · ${automation.lastRun.timestamp}`
                  : "Never run"}
              </span>
              <span className="text-paper-sage">
                Next run: {automation.nextRun ?? (paused ? "Paused" : "Not scheduled")}
              </span>
            </div>

            {failed && automation.lastRun?.detail ? (
              <p className="mt-2 font-mono text-[12px] text-paper-flame-deep">{automation.lastRun.detail}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-1.5">
            {!finished ? (
              <PaperButton variant="ghost" disabled={control.isPending} onClick={() => act("run")}>
                <Play className="size-3.5" aria-hidden="true" />
                {pending === "run" ? "Queuing…" : "Run now"}
              </PaperButton>
            ) : null}
            {paused ? (
              <PaperButton variant="quiet" disabled={control.isPending} onClick={() => act("resume")}>
                <Play className="size-3.5" aria-hidden="true" />
                {pending === "resume" ? "Resuming…" : "Resume"}
              </PaperButton>
            ) : automation.state === "active" ? (
              <PaperButton variant="quiet" disabled={control.isPending} onClick={() => act("pause")}>
                <Pause className="size-3.5" aria-hidden="true" />
                {pending === "pause" ? "Pausing…" : "Pause"}
              </PaperButton>
            ) : null}
          </div>
          {receipt ? (
            <p
              className={cn(
                "max-w-[30ch] text-right text-[13px]",
                control.isError ? "text-paper-flame-deep" : "text-paper-sage",
              )}
              role="status"
            >
              {receipt}
            </p>
          ) : null}
        </div>
      </div>

      {expanded && automation.skills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {automation.skills.map((skill) => (
            <Tag key={skill}>{skill}</Tag>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function AdvancedSurfaces({ surfaces }: { surfaces: import("@shared/agentos-types").HermesAutomationSurfaces }) {
  const curatorControl = useControlCurator();
  const { curator, kanban, hooks, webhooks } = surfaces;
  const curatorPaused = curator.state === "paused";

  const kanbanCounts = Object.entries(kanban.byStatus)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const order = ["triage", "todo", "scheduled", "ready", "running", "blocked", "done"];
      return order.indexOf(a) - order.indexOf(b);
    });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-md border border-paper-mist bg-paper-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-paper-moss">Skill curator</h3>
          <Tag tone={curator.state === "enabled" ? "green" : curatorPaused ? "marigold" : "muted"}>
            {curator.state === "enabled" ? "On" : curatorPaused ? "Paused" : curator.state === "disabled" ? "Off" : "Unknown"}
          </Tag>
        </div>
        <p className="mt-2 text-[13px] text-paper-char">
          Reviews the skills Hermes creates, marks unused ones stale and archives them.
        </p>
        <div className="mt-3 space-y-1 text-[13px] text-paper-sage">
          <p>
            {curator.interval ? `Runs ${curator.interval}` : "Schedule unknown"}
            {curator.lastRun ? ` · last ran ${curator.lastRun}` : ""}
          </p>
          {curator.skills ? (
            <p className="text-paper-char tabular-nums">
              {curator.skills.active} active · {curator.skills.stale} stale · {curator.skills.archived} archived
            </p>
          ) : null}
          {curator.lastSummary ? <p>Last result: {curator.lastSummary}</p> : null}
        </div>
        {curator.state === "enabled" || curatorPaused ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PaperButton
              variant="quiet"
              disabled={curatorControl.isPending}
              onClick={() => curatorControl.mutate(curatorPaused ? "resume" : "pause")}
            >
              {curatorPaused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
              {curatorControl.isPending ? "Saving…" : curatorPaused ? "Resume" : "Pause"}
            </PaperButton>
            {curatorControl.isError ? (
              <span className="text-[13px] text-paper-flame-deep" role="alert">
                {curatorControl.error instanceof Error ? curatorControl.error.message : "Hermes did not accept that."}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-paper-mist bg-paper-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-paper-moss">Kanban dispatch</h3>
          <Tag tone={kanbanCounts.length > 0 ? "blue" : "muted"}>{kanbanCounts.length > 0 ? "Busy" : "Idle"}</Tag>
        </div>
        <p className="mt-2 text-[13px] text-paper-char">
          Hands tasks on Hermes board to its profiles as they become ready.
        </p>
        <div className="mt-3 text-[13px] text-paper-sage">
          {!kanban.readable ? (
            <p>Hermes could not report the board.</p>
          ) : kanbanCounts.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-paper-char tabular-nums">
              {kanbanCounts.map(([status, count]) => (
                <li key={status}>
                  {count} {status}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              The board is empty. Add a task with <code className="font-mono text-[12px]">hermes kanban create</code>.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-paper-mist bg-paper-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-paper-moss">Shell hooks</h3>
          <Tag tone={hooks.configured ? "green" : "muted"}>{hooks.configured ? "Set up" : "None"}</Tag>
        </div>
        <p className="mt-2 text-[13px] text-paper-char">
          Your own scripts, run by Hermes on events: before a tool call, after a turn, when a job finishes.
        </p>
        <div className="mt-3 text-[13px] text-paper-sage">
          {hooks.configured ? (
            <ul className="space-y-1 font-mono text-[12px] text-paper-char">
              {hooks.entries.slice(0, 4).map((entry) => (
                <li key={entry} className="truncate">
                  {entry}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              None configured. Declare them under <code className="font-mono text-[12px]">hooks</code> in{" "}
              <code className="font-mono text-[12px]">~/.hermes/config.yaml</code>.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-paper-mist bg-paper-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-paper-moss">Webhooks</h3>
          <Tag tone={webhooks.enabled ? "green" : "muted"}>{webhooks.enabled ? "On" : "Off"}</Tag>
        </div>
        <p className="mt-2 text-[13px] text-paper-char">
          Let another service start a Hermes run by calling a URL: a form, a payment, a deploy.
        </p>
        <div className="mt-3 text-[13px] text-paper-sage">
          {webhooks.enabled ? (
            webhooks.entries.length > 0 ? (
              <ul className="space-y-1 font-mono text-[12px] text-paper-char">
                {webhooks.entries.slice(0, 4).map((entry) => (
                  <li key={entry} className="truncate">
                    {entry}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                On, with no subscriptions. Add one with <code className="font-mono text-[12px]">hermes webhook subscribe</code>.
              </p>
            )
          ) : (
            <p>
              Not enabled. Turn it on with <code className="font-mono text-[12px]">hermes gateway setup</code>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
