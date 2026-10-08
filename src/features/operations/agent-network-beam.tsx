import { useRef, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import type { LiveAgent } from "@shared/usage-types";
import { AnimatedBeam, BeamNode } from "@/components/ui/animated-beam-integration";
import { cn } from "@/lib/utils";
import { PAPER_FOCUS, PaperSection } from "@/components/paper";
import { pickTask, toNode, type NodeState, type WorkerNodeModel } from "./agent-network-model";

/**
 * The workforce as a wiring diagram.
 *
 * Hermes sits in the middle because it is the one that scopes work and hands
 * it out; every worker hangs off it. A beam only travels along a line while
 * that worker has a job in flight, so movement on this panel always means
 * something is running. Ready workers keep a still hairline; offline ones a
 * dashed one. Every state is also written under the node, never colour alone.
 *
 * Two inputs, because they answer on different clocks. `live` comes with the
 * Operations read (every minute) and knows which workers exist and whether
 * they are reachable. `activeWork` is the shared Mission Control read (every
 * ten seconds), which is what the header uses too, and knows every kind of
 * task: worker jobs at any stage, Hermes runs and Operator runs. A node is
 * working if either says so, and a working node links to its task.
 */
export function AgentNetworkBeam({
  live,
  activeWork,
}: {
  live: readonly LiveAgent[];
  activeWork: readonly ActiveWorkItem[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);

  const nodes = live.map((agent) => toNode(agent, activeWork));
  const running = nodes.filter((node) => node.state === "running").length;
  const ready = nodes.filter((node) => node.state === "ready" || node.state === "uncertain").length;
  const offline = nodes.length - running - ready;

  const hubTask = pickTask(activeWork.filter((item) => item.agent === "hermes" || item.agent === "operator"));
  const hubWorking = hubTask !== undefined && !hubTask.uncertain;

  // Alternate sides so the two columns stay balanced as workers are added.
  const left = nodes.filter((_, index) => index % 2 === 0);
  const right = nodes.filter((_, index) => index % 2 === 1);

  return (
    <PaperSection
      label="Agent network"
      count={live.length}
      action={
        <p className="text-[13px] text-paper-sage tabular-nums">
          <span className="font-medium text-paper-moss">{running} running</span> · {ready} ready · {offline} offline
        </p>
      }
    >
      {live.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-sage">No workers are registered.</p>
      ) : (
        <div
          ref={containerRef}
          className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 overflow-hidden border border-paper-mist bg-paper-white px-3 py-8 text-paper-moss sm:gap-x-10 sm:px-10 sm:py-10"
        >
          <WorkerColumn agents={left} side="left" containerRef={containerRef} hubRef={hubRef} />

          <BeamNode className="flex-col">
            <HubLink task={hubTask}>
              <div
                ref={hubRef}
                className={cn(
                  "relative flex size-16 items-center justify-center border-[1.5px] border-paper-blue bg-paper-white sm:size-20",
                  // A steady ring; the dot carries the pulse, so the mark never fades.
                  hubWorking && "ring-4 ring-paper-blue/20",
                )}
              >
                <img src="/agentos-mark.svg" alt="" className="size-9 sm:size-11" />
                {hubWorking ? <WorkingDot /> : null}
              </div>
              <span className="font-paper-utility text-[11px] font-medium tracking-[0.12em] text-paper-moss uppercase">Hermes</span>
              <span className={cn("max-w-[10rem] truncate text-[11.5px]", hubWorking ? "text-paper-green" : "text-paper-sage")}>
                {hubTask ? (hubWorking ? (hubTask.agent === "operator" ? "Operator running" : "Run in progress") : "May have finished") : "Orchestrator"}
              </span>
            </HubLink>
          </BeamNode>

          <WorkerColumn agents={right} side="right" containerRef={containerRef} hubRef={hubRef} />
        </div>
      )}
    </PaperSection>
  );
}

/** The hub is a link only while it has a task to open; otherwise it is a picture. */
function HubLink({ task, children }: { task: ActiveWorkItem | undefined; children: ReactNode }) {
  const className = "group flex flex-col items-center gap-2 rounded-none";

  if (!task) {
    return (
      <div role="img" aria-label="Hermes, the orchestrator every worker reports to. Nothing running." className={className}>
        {children}
      </div>
    );
  }

  const label = `Hermes — ${task.uncertain ? "may have finished" : "working"}: ${task.title}. Open the task`;
  return (
    <Link to={task.href} aria-label={label} title={task.title} className={cn(className, PAPER_FOCUS)}>
      {children}
    </Link>
  );
}

function WorkingDot() {
  return (
    <span className="absolute -top-1 -right-1 flex size-2.5" aria-hidden="true">
      <span className="absolute inline-flex size-full rounded-full bg-paper-green opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2.5 rounded-full bg-paper-green" />
    </span>
  );
}

function WorkerColumn({
  agents,
  side,
  containerRef,
  hubRef,
}: {
  agents: readonly WorkerNodeModel[];
  side: "left" | "right";
  containerRef: RefObject<HTMLDivElement | null>;
  hubRef: RefObject<HTMLDivElement | null>;
}) {
  // Deliberately not `position: relative`: each beam's SVG must resolve
  // `absolute inset-0` against the whole diagram, not this column.
  return (
    <ul className={cn("flex min-w-0 flex-col justify-center gap-6", side === "left" ? "items-start" : "items-end")}>
      {agents.map((node, index) => (
        <li key={node.agent.agent} className="w-24 max-w-full sm:w-32">
          <WorkerNode
            node={node}
            // Bow the outer lines away from the middle, as a fan.
            curvature={(index - (agents.length - 1) / 2) * 40}
            reverse={side === "right"}
            containerRef={containerRef}
            hubRef={hubRef}
          />
        </li>
      ))}
    </ul>
  );
}

const STATE_WORD: Record<NodeState, string> = {
  running: "Running",
  uncertain: "May have finished",
  ready: "Ready",
  offline: "Offline",
};

function WorkerNode({
  node,
  curvature,
  reverse,
  containerRef,
  hubRef,
}: {
  node: WorkerNodeModel;
  curvature: number;
  reverse: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  hubRef: RefObject<HTMLDivElement | null>;
}) {
  const { agent, state, task } = node;
  const tileRef = useRef<HTMLSpanElement>(null);
  const isRunning = state === "running";
  const isOffline = state === "offline";
  // A working node opens the task it is on; an idle one opens the agent.
  const href = task ? task.href : `/operations/agents/${encodeURIComponent(agent.agent)}`;
  const doing = task?.title ?? agent.detail;
  const description = [agent.label, STATE_WORD[state], doing, task ? "Open the task" : undefined].filter(Boolean).join(" — ");

  return (
    <>
      <BeamNode className="w-full">
        <Link
          to={href}
          aria-label={description}
          title={description}
          className={cn("group flex w-full flex-col items-center gap-2 rounded-none", PAPER_FOCUS)}
        >
          <span
            ref={tileRef}
            className={cn(
              "relative flex size-12 items-center justify-center border bg-paper-white font-paper-utility text-[13px] font-semibold tracking-[0.08em] uppercase transition-colors duration-150",
              isRunning && "border-[1.5px] border-paper-blue text-paper-blue",
              (state === "ready" || state === "uncertain") && "border-paper-ash text-paper-moss group-hover:border-paper-blue",
              isOffline && "border-dashed border-paper-ash text-paper-sage",
            )}
            aria-hidden="true"
          >
            {monogram(agent)}
            {isRunning ? <WorkingDot /> : null}
          </span>
          <span className="flex w-full flex-col items-center text-center" aria-hidden="true">
            <span className="w-full truncate text-[12.5px] font-medium text-paper-moss group-hover:text-paper-blue">{agent.label}</span>
            <span className={cn("w-full truncate text-[11.5px]", isRunning ? "text-paper-green" : "text-paper-sage")}>{STATE_WORD[state]}</span>
          </span>
        </Link>
      </BeamNode>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={hubRef}
        toRef={tileRef}
        curvature={curvature}
        reverse={reverse}
        animated={isRunning}
        pathColor="var(--paper-moss)"
        pathOpacity={isOffline ? 0.18 : isRunning ? 0.25 : 0.14}
        pathDasharray={isOffline ? "4 5" : undefined}
        gradientStartColor="var(--paper-blue)"
        gradientStopColor="var(--paper-blue)"
      />
    </>
  );
}

/** Known workers get a fixed two-letter mark; anything new falls back to its label. */
const MONOGRAMS: Record<string, string> = {
  claude: "CL",
  "claude-code": "CC",
  codex: "CX",
  gemini: "GM",
  grok: "GK",
  "grok-bot": "GB",
  ollama: "OL",
  "hermes-worker": "HW",
  mock: "MK",
};

function monogram(agent: LiveAgent): string {
  if (MONOGRAMS[agent.agent]) return MONOGRAMS[agent.agent];
  const words = agent.label.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : agent.label.slice(0, 2)).toUpperCase();
}
