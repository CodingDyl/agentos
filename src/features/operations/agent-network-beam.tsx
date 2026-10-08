import { useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { LiveAgent } from "@shared/usage-types";
import { AnimatedBeam, BeamNode } from "@/components/ui/animated-beam-integration";
import { cn } from "@/lib/utils";
import { PAPER_FOCUS, PaperSection } from "@/components/paper";

/**
 * The workforce as a wiring diagram.
 *
 * Hermes sits in the middle because it is the one that scopes work and hands
 * it out; every worker hangs off it. A beam only travels along a line while
 * that worker has a job in flight, so movement on this panel always means
 * something is running. Ready workers keep a still hairline; offline ones a
 * dashed one. Every state is also written under the node, never colour alone.
 */
export function AgentNetworkBeam({ live }: { live: readonly LiveAgent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);

  const running = live.filter((agent) => agent.state === "running").length;
  const ready = live.filter((agent) => agent.state === "ready").length;
  const offline = live.length - running - ready;

  // Alternate sides so the two columns stay balanced as workers are added.
  const left = live.filter((_, index) => index % 2 === 0);
  const right = live.filter((_, index) => index % 2 === 1);

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

          <BeamNode className="flex-col gap-2">
            <div
              ref={hubRef}
              role="img"
              aria-label="Hermes, the orchestrator every worker reports to"
              className="flex size-16 items-center justify-center border-[1.5px] border-paper-blue bg-paper-white sm:size-20"
            >
              <img src="/agentos-mark.svg" alt="" className="size-9 sm:size-11" />
            </div>
            <span className="font-paper-utility text-[11px] font-medium tracking-[0.12em] text-paper-moss uppercase">Hermes</span>
          </BeamNode>

          <WorkerColumn agents={right} side="right" containerRef={containerRef} hubRef={hubRef} />
        </div>
      )}
    </PaperSection>
  );
}

function WorkerColumn({
  agents,
  side,
  containerRef,
  hubRef,
}: {
  agents: readonly LiveAgent[];
  side: "left" | "right";
  containerRef: RefObject<HTMLDivElement | null>;
  hubRef: RefObject<HTMLDivElement | null>;
}) {
  // Deliberately not `position: relative`: each beam's SVG must resolve
  // `absolute inset-0` against the whole diagram, not this column.
  return (
    <ul className={cn("flex min-w-0 flex-col justify-center gap-6", side === "left" ? "items-start" : "items-end")}>
      {agents.map((agent, index) => (
        <li key={agent.agent} className="w-24 max-w-full sm:w-32">
          <WorkerNode
            agent={agent}
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

const STATE_WORD: Record<LiveAgent["state"], string> = {
  running: "Running",
  ready: "Ready",
  offline: "Offline",
};

function WorkerNode({
  agent,
  curvature,
  reverse,
  containerRef,
  hubRef,
}: {
  agent: LiveAgent;
  curvature: number;
  reverse: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  hubRef: RefObject<HTMLDivElement | null>;
}) {
  const tileRef = useRef<HTMLSpanElement>(null);
  const isRunning = agent.state === "running";
  const isOffline = agent.state === "offline";
  const description = [agent.label, STATE_WORD[agent.state], agent.detail].filter(Boolean).join(" — ");

  return (
    <>
      <BeamNode className="w-full">
        <Link
          to={`/operations/agents/${encodeURIComponent(agent.agent)}`}
          aria-label={description}
          title={description}
          className={cn("group flex w-full flex-col items-center gap-2 rounded-none", PAPER_FOCUS)}
        >
          <span
            ref={tileRef}
            className={cn(
              "relative flex size-12 items-center justify-center border bg-paper-white font-paper-utility text-[13px] font-semibold tracking-[0.08em] uppercase transition-colors duration-150",
              isRunning && "border-[1.5px] border-paper-blue text-paper-blue",
              agent.state === "ready" && "border-paper-ash text-paper-moss group-hover:border-paper-blue",
              isOffline && "border-dashed border-paper-ash text-paper-sage",
            )}
            aria-hidden="true"
          >
            {monogram(agent)}
            {isRunning ? (
              <span className="absolute -top-1 -right-1 flex size-2.5">
                <span className="absolute inline-flex size-full rounded-full bg-paper-green opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex size-2.5 rounded-full bg-paper-green" />
              </span>
            ) : null}
          </span>
          <span className="flex w-full flex-col items-center text-center" aria-hidden="true">
            <span className="w-full truncate text-[12.5px] font-medium text-paper-moss group-hover:text-paper-blue">{agent.label}</span>
            <span className={cn("text-[11.5px]", isRunning ? "text-paper-green" : "text-paper-sage")}>{STATE_WORD[agent.state]}</span>
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
