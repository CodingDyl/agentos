import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import type { LiveAgent } from "@shared/usage-types";
import { AnimatedBeam, BeamNode } from "@/components/ui/animated-beam-integration";
import { elapsed } from "@/features/mission-control/mission-control-model";
import { cn } from "@/lib/utils";
import { PAPER_FOCUS, PaperSection } from "@/components/paper";
import {
  lastSeenAt,
  networkCounts,
  pickTask,
  toNode,
  type NodeState,
  type WorkerNodeModel,
} from "./agent-network-model";

/**
 * The workforce as a wiring diagram.
 *
 * Hermes sits in the middle because it is the one that scopes work and hands
 * it out; every worker hangs off it. Activity is derived once from jobs, so
 * the header counts and the Working On list cannot disagree. A beam only
 * travels along a line while that worker has a job in flight. Unconfirmed
 * work — recorded as running, nothing executing — is amber and still.
 *
 * Two inputs, on different clocks. `live` comes with the Operations read
 * (every minute) and knows which workers exist and whether they are
 * reachable. `activeWork` is the shared Mission Control read (every ten
 * seconds) and is the only source of activity.
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
  const counts = networkCounts(nodes);

  const hubTask = pickTask(activeWork.filter((item) => item.agent === "hermes" || item.agent === "operator"));
  const hubTasks = activeWork.filter((item) => item.agent === "hermes" || item.agent === "operator");
  const hubWorking = hubTask !== undefined && !hubTask.uncertain;
  const hubUnconfirmed = hubTask?.uncertain === true;

  const left = nodes.filter((_, index) => index % 2 === 0);
  const right = nodes.filter((_, index) => index % 2 === 1);

  return (
    <PaperSection
      label="Agent network"
      count={live.length}
      action={
        <p className="text-[13px] text-paper-sage tabular-nums">
          <span className="font-medium text-paper-moss">{counts.running} running</span>
          {counts.unconfirmed > 0 ? (
            <>
              {" · "}
              <span className="text-paper-amber-deep">{counts.unconfirmed} unconfirmed</span>
            </>
          ) : null}
          {` · ${counts.ready} ready · ${counts.offline} offline`}
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
            <HubNode
              task={hubTask}
              tasks={hubTasks}
              hubRef={hubRef}
              working={hubWorking}
              unconfirmed={hubUnconfirmed}
            />
          </BeamNode>

          <WorkerColumn agents={right} side="right" containerRef={containerRef} hubRef={hubRef} />
        </div>
      )}
    </PaperSection>
  );
}

function HubNode({
  task,
  tasks,
  hubRef,
  working,
  unconfirmed,
}: {
  task: ActiveWorkItem | undefined;
  tasks: readonly ActiveWorkItem[];
  hubRef: RefObject<HTMLDivElement | null>;
  working: boolean;
  unconfirmed: boolean;
}) {
  const now = useTicker(unconfirmed);
  const mark = (
    <>
      <div
        ref={hubRef}
        className={cn(
          "relative flex size-16 items-center justify-center border-[1.5px] bg-paper-white sm:size-20",
          working && "border-paper-blue ring-4 ring-paper-blue/20",
          unconfirmed && "border-paper-amber ring-4 ring-paper-amber/20",
          !working && !unconfirmed && "border-paper-blue",
        )}
      >
        <img src="/agentos-mark.svg" alt="" className="size-9 sm:size-11" />
        {working ? <WorkingDot /> : null}
        {tasks.length > 0 ? <JobCountBadge count={tasks.length} tone={working ? "running" : "uncertain"} /> : null}
      </div>
      <span className="font-paper-utility text-[11px] font-medium tracking-[0.12em] text-paper-moss uppercase">Hermes</span>
      <span
        className={cn(
          "max-w-[10rem] truncate text-[11.5px]",
          working ? "text-paper-green" : unconfirmed ? "text-paper-amber-deep" : "text-paper-sage",
        )}
      >
        {task
          ? working
            ? task.agent === "operator"
              ? "Operator running"
              : "Run in progress"
            : "Unconfirmed"
          : "Orchestrator"}
      </span>
      {unconfirmed && task ? (
        <span className="max-w-[10rem] truncate text-[10.5px] text-paper-sage tabular-nums">
          Last seen {elapsed(lastSeenAt(task), now) || "unknown"} ago
        </span>
      ) : null}
    </>
  );

  if (tasks.length === 0) {
    return (
      <div role="img" aria-label="Hermes, the orchestrator every worker reports to. Nothing running." className="group flex flex-col items-center gap-2 rounded-none">
        {mark}
      </div>
    );
  }

  return (
    <NodeTrigger
      tasks={tasks}
      fallbackHref="/agent"
      fallbackLabel="Open Hermes"
      label={`Hermes — ${task?.uncertain ? "unconfirmed" : "working"}: ${task?.title ?? "open jobs"}`}
    >
      {mark}
    </NodeTrigger>
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
  return (
    <ul className={cn("flex min-w-0 flex-col justify-center gap-6", side === "left" ? "items-start" : "items-end")}>
      {agents.map((node, index) => (
        <li key={node.agent.agent} className="w-24 max-w-full sm:w-32">
          <WorkerNode
            node={node}
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
  uncertain: "Unconfirmed",
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
  const { agent, state, task, tasks } = node;
  const tileRef = useRef<HTMLSpanElement>(null);
  const isRunning = state === "running";
  const isUnconfirmed = state === "uncertain";
  const isOffline = state === "offline";
  const agentHref = `/operations/agents/${encodeURIComponent(agent.agent)}`;
  const now = useTicker(isUnconfirmed);
  const seen = task ? elapsed(lastSeenAt(task), now) : "";
  const doing = task?.title ?? agent.detail;
  const description = [agent.label, STATE_WORD[state], doing, isUnconfirmed && seen ? `Last seen ${seen} ago` : undefined, task ? "Open jobs" : undefined]
    .filter(Boolean)
    .join(" — ");

  const tile = (
    <>
      <span
        ref={tileRef}
        className={cn(
          "relative flex size-12 items-center justify-center border bg-paper-white font-paper-utility text-[13px] font-semibold tracking-[0.08em] uppercase transition-colors duration-150",
          isRunning && "border-[1.5px] border-paper-blue text-paper-blue ring-2 ring-paper-blue/25",
          isUnconfirmed && "border-[1.5px] border-paper-amber text-paper-amber-deep",
          state === "ready" && "border-paper-ash text-paper-moss group-hover:border-paper-blue",
          isOffline && "border-dashed border-paper-ash text-paper-sage",
        )}
        aria-hidden="true"
      >
        {monogram(agent)}
        {isRunning ? <WorkingDot /> : null}
        {tasks.length > 0 ? <JobCountBadge count={tasks.length} tone={isRunning ? "running" : "uncertain"} /> : null}
      </span>
      <span className="flex w-full flex-col items-center text-center" aria-hidden="true">
        <span className="w-full truncate text-[12.5px] font-medium text-paper-moss group-hover:text-paper-blue">{agent.label}</span>
        <span
          className={cn(
            "w-full truncate text-[11.5px]",
            isRunning ? "text-paper-green" : isUnconfirmed ? "text-paper-amber-deep" : "text-paper-sage",
          )}
        >
          {STATE_WORD[state]}
        </span>
        {isUnconfirmed && seen ? (
          <span className="w-full truncate text-[10.5px] text-paper-sage tabular-nums">Last seen {seen} ago</span>
        ) : null}
      </span>
    </>
  );

  return (
    <>
      <BeamNode className="w-full">
        {tasks.length === 0 ? (
          <Link to={agentHref} aria-label={description} title={description} className={cn("group flex w-full flex-col items-center gap-2 rounded-none", PAPER_FOCUS)}>
            {tile}
          </Link>
        ) : (
          <NodeTrigger tasks={tasks} fallbackHref={agentHref} fallbackLabel={`Open ${agent.label}`} label={description}>
            {tile}
          </NodeTrigger>
        )}
      </BeamNode>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={hubRef}
        toRef={tileRef}
        curvature={curvature}
        reverse={reverse}
        animated={isRunning}
        pathColor={isUnconfirmed ? "var(--paper-amber-deep)" : "var(--paper-moss)"}
        pathOpacity={isOffline ? 0.18 : isRunning ? 0.25 : isUnconfirmed ? 0.35 : 0.14}
        pathDasharray={isOffline ? "4 5" : isUnconfirmed ? "5 4" : undefined}
        gradientStartColor="var(--paper-blue)"
        gradientStopColor="var(--paper-blue)"
      />
    </>
  );
}

/**
 * One job: a link. Several: a list. The diagram clips overflow, so the list
 * is portalled — otherwise a node at the edge would hide its own jobs.
 */
function NodeTrigger({
  tasks,
  fallbackHref,
  fallbackLabel,
  label,
  children,
}: {
  tasks: readonly ActiveWorkItem[];
  fallbackHref: string;
  fallbackLabel: string;
  label: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  if (tasks.length === 1) {
    const task = tasks[0];
    return (
      <Link
        to={task.href}
        aria-label={label}
        title={task.title}
        className={cn("group flex w-full flex-col items-center gap-2 rounded-none", PAPER_FOCUS)}
      >
        {children}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={anchor !== null}
        aria-haspopup="menu"
        title={label}
        onClick={(event) => setAnchor((current) => (current ? null : event.currentTarget))}
        className={cn("group flex w-full cursor-pointer flex-col items-center gap-2 rounded-none", PAPER_FOCUS)}
      >
        {children}
      </button>
      {anchor
        ? createPortal(
            <JobMenu
              tasks={tasks}
              fallbackHref={fallbackHref}
              fallbackLabel={fallbackLabel}
              anchor={anchor}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function JobMenu({
  tasks,
  fallbackHref,
  fallbackLabel,
  anchor,
  onClose,
}: {
  tasks: readonly ActiveWorkItem[];
  fallbackHref: string;
  fallbackLabel: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();
  const style = {
    top: Math.min(rect.bottom + 8, window.innerHeight - 16),
    left: Math.min(Math.max(8, rect.left + rect.width / 2 - 140), window.innerWidth - 288),
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", top: style.top, left: style.left, width: 280 }}
      className="z-50 border border-paper-mist bg-paper-white py-1"
    >
      {tasks.map((item) => (
        <Link
          key={item.id}
          role="menuitem"
          to={item.href}
          onClick={onClose}
          className={cn("block px-3 py-2 text-left hover:bg-paper-cream", PAPER_FOCUS)}
        >
          <span className="block truncate text-[11.5px] font-medium tracking-[0.06em] text-paper-sage uppercase">
            {item.actor}
            {item.uncertain ? " · unconfirmed" : ""}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-paper-moss">{item.title}</span>
        </Link>
      ))}
      <Link
        role="menuitem"
        to={fallbackHref}
        onClick={onClose}
        className={cn("block border-t border-paper-stone px-3 py-2 text-[12.5px] text-paper-sage hover:bg-paper-cream hover:text-paper-moss", PAPER_FOCUS)}
      >
        {fallbackLabel}
      </Link>
    </div>
  );
}

function JobCountBadge({ count, tone }: { count: number; tone: "running" | "uncertain" }) {
  return (
    <span
      className={cn(
        "absolute -right-1 -bottom-1 flex min-w-4 items-center justify-center border bg-paper-white px-1 font-paper-utility text-[9px] font-semibold tabular-nums",
        tone === "running" ? "border-paper-blue text-paper-blue" : "border-paper-amber text-paper-amber-deep",
      )}
    >
      {count}
    </span>
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

function useTicker(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

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
