import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import type { HermesAutomationSurfaces } from "@shared/agentos-types";
import { PaperButton, PaperCard, Tag } from "@/components/paper";
import { useControlCurator } from "@/lib/agentos/queries";

/** A command or config path, set as code — the one place mono belongs. */
function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[3px] bg-paper-linen px-1 py-px font-mono text-[12px] text-paper-moss">{children}</code>;
}

/**
 * The two switches that decide whether anything below fires at all: the
 * gateway's scheduler, and Hermes' emergency stop. When the stop is on it
 * leads the page — nothing else on it will run until it's lifted.
 */
export function HermesSwitches({ surfaces }: { surfaces: HermesAutomationSurfaces }) {
  const { scheduler, emergencyStop } = surfaces;

  return (
    <>
      {emergencyStop.engaged ? (
        <div role="alert" className="mt-8 rounded-[4px] border border-paper-flame-deep bg-[#fdf1eb] px-5 py-4">
          <p className="font-paper-display text-[16px] font-bold text-paper-flame-deep">Emergency stop is on</p>
          <p className="mt-1 max-w-[72ch] text-[14px] leading-6 text-paper-moss">
            Hermes won't start any scheduled job, kanban task or new gateway turn until it's lifted
            {emergencyStop.reason ? ` (“${emergencyStop.reason}”)` : ""}. Work already running carries on. Lift it with{" "}
            <Code>hermes resume</Code>.
          </p>
        </div>
      ) : null}

      <dl className="mt-8 grid gap-px overflow-hidden rounded-[4px] border border-paper-mist bg-paper-mist sm:grid-cols-2">
        <div className="bg-paper-white px-5 py-4">
          <dt className="flex items-center gap-2 text-[13px] font-semibold text-paper-moss">
            Scheduler
            <Tag tone={scheduler.running ? "green" : "flame"}>{scheduler.running ? "Running" : "Stopped"}</Tag>
          </dt>
          <dd className="mt-1.5 text-[13.5px] leading-5 text-paper-char">
            {scheduler.running ? (
              "Jobs fire on time while the Hermes gateway is up."
            ) : (
              <>
                Scheduled jobs won't fire. {scheduler.detail ? `${scheduler.detail}. ` : ""}Start it with{" "}
                <Code>hermes gateway run</Code>.
              </>
            )}
          </dd>
        </div>
        <div className="bg-paper-white px-5 py-4">
          <dt className="flex items-center gap-2 text-[13px] font-semibold text-paper-moss">
            Emergency stop
            <Tag tone={emergencyStop.engaged ? "flame" : "muted"}>{emergencyStop.engaged ? "On" : "Off"}</Tag>
          </dt>
          <dd className="mt-1.5 text-[13.5px] leading-5 text-paper-char">
            <Code>hermes pause</Code> halts all new automation work at once; <Code>hermes resume</Code> lifts it.
          </dd>
        </div>
      </dl>
    </>
  );
}

function SurfaceCard({
  title,
  tag,
  description,
  children,
}: {
  title: string;
  tag: ReactNode;
  description: string;
  children: ReactNode;
}) {
  return (
    <PaperCard className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-paper-display text-[15.5px] font-bold tracking-[-0.01em] text-paper-moss">{title}</h3>
        {tag}
      </div>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-paper-char">{description}</p>
      <div className="mt-4 flex flex-1 flex-col gap-3 border-t border-paper-stone pt-4 text-[13px] leading-5 text-paper-sage">
        {children}
      </div>
    </PaperCard>
  );
}

const KANBAN_ORDER = ["triage", "todo", "scheduled", "ready", "running", "blocked", "done"];

/**
 * Everything else in Hermes that runs without being asked. A surface that
 * isn't set up still gets its card, with how to turn it on — the page lists
 * every option Hermes has, not only the ones in use.
 */
export function BackgroundWork({ surfaces }: { surfaces: HermesAutomationSurfaces }) {
  const curatorControl = useControlCurator();
  const { curator, kanban, hooks, webhooks } = surfaces;
  const kanbanCounts = Object.entries(kanban.byStatus)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => KANBAN_ORDER.indexOf(a) - KANBAN_ORDER.indexOf(b));
  const curatorPaused = curator.state === "paused";

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SurfaceCard
        title="Skill curator"
        tag={
          <Tag tone={curator.state === "enabled" ? "green" : curatorPaused ? "marigold" : "muted"}>
            {curator.state === "enabled" ? "On" : curatorPaused ? "Paused" : curator.state === "disabled" ? "Off" : "Unknown"}
          </Tag>
        }
        description="Reviews the skills Hermes creates, marks unused ones stale and archives them. It never deletes one."
      >
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
        {curator.state === "enabled" || curatorPaused ? (
          <div className="flex flex-wrap items-center gap-2">
            <PaperButton
              variant="quiet"
              className="-ml-3"
              disabled={curatorControl.isPending}
              onClick={() => curatorControl.mutate(curatorPaused ? "resume" : "pause")}
            >
              {curatorPaused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
              {curatorControl.isPending ? "Saving…" : curatorPaused ? "Resume curator" : "Pause curator"}
            </PaperButton>
            {curatorControl.isError ? (
              <span className="text-paper-flame-deep" role="alert">
                {curatorControl.error instanceof Error ? curatorControl.error.message : "Hermes didn't accept that."}
              </span>
            ) : null}
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard
        title="Kanban dispatch"
        tag={<Tag tone={kanbanCounts.length > 0 ? "blue" : "muted"}>{kanbanCounts.length > 0 ? "Busy" : "Idle"}</Tag>}
        description="Hands tasks on Hermes' board to its profiles as they become ready, each in its own workspace."
      >
        {!kanban.readable ? (
          <p>Hermes couldn't report the board.</p>
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
            The board is empty. Add a task with <Code>hermes kanban create</Code>.
          </p>
        )}
      </SurfaceCard>

      <SurfaceCard
        title="Shell hooks"
        tag={<Tag tone={hooks.configured ? "green" : "muted"}>{hooks.configured ? "Set up" : "None"}</Tag>}
        description="Your own scripts, run by Hermes on events: before a tool call, after a turn, when a job finishes."
      >
        {hooks.configured ? (
          <ul className="space-y-1 font-mono text-[12px] text-paper-char">
            {hooks.entries.slice(0, 6).map((entry) => (
              <li key={entry} className="truncate">
                {entry}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            None configured. Declare them under <Code>hooks</Code> in <Code>~/.hermes/config.yaml</Code>, then check
            them with <Code>hermes hooks doctor</Code>.
          </p>
        )}
      </SurfaceCard>

      <SurfaceCard
        title="Webhooks"
        tag={<Tag tone={webhooks.enabled ? "green" : "muted"}>{webhooks.enabled ? "On" : "Off"}</Tag>}
        description="Let another service start a Hermes run by calling a URL: a form, a payment, a deploy."
      >
        {webhooks.enabled ? (
          webhooks.entries.length > 0 ? (
            <ul className="space-y-1 font-mono text-[12px] text-paper-char">
              {webhooks.entries.slice(0, 6).map((entry) => (
                <li key={entry} className="truncate">
                  {entry}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              On, with no subscriptions. Add one with <Code>hermes webhook subscribe</Code>.
            </p>
          )
        ) : (
          <p>
            Not enabled. Turn it on with <Code>hermes gateway setup</Code>.
          </p>
        )}
      </SurfaceCard>
    </div>
  );
}
