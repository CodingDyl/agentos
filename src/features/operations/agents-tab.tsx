import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { AgentUsage, LiveAgent, OperationsData } from "@shared/usage-types";
import { cn } from "@/lib/utils";
import { Figure } from "./figures";
import { formatCost, measuredCost, measuredTokens } from "./operations-model";
import { PAPER_FOCUS, PaperCard, PaperSection, RadialMeter, Tag } from "./paper";

/**
 * The workforce.
 *
 * What each agent is doing right now, and what each has cost in this window
 * against what that bought. The pairing is the whole argument: "Claude costs
 * more" is not a routing decision, but "Claude costs $0.91 a job and passes
 * review first time 88% of the time, against Grok at $0.39 and 69%" is.
 */
export function AgentsTab({ data }: { data: OperationsData }) {
  return (
    <div className="space-y-12">
      <LiveStrip live={data.live} />

      <PaperSection label={data.window.label} count={data.agents.length}>
        {data.agents.length === 0 ? (
          <p className="text-[14px] leading-6 text-paper-sage">No agent has run in this window.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.agents.map((agent) => (
              <li key={agent.agent}>
                <AgentCard agent={agent} />
              </li>
            ))}
          </ul>
        )}
      </PaperSection>
    </div>
  );
}

/**
 * What is running, right now.
 *
 * A worker that does not stream usage shows no number at all, and the line
 * underneath says why. Animating a rising estimate would make the panel feel
 * alive and make every figure on this screen untrustworthy.
 */
function LiveStrip({ live }: { live: readonly LiveAgent[] }) {
  const running = live.filter((agent) => agent.state === "running");
  const ready = live.filter((agent) => agent.state === "ready").length;

  return (
    <PaperSection label="Running now" count={running.length}>
      {running.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">
          Nothing is running. <span className="text-paper-sage">{ready} {ready === 1 ? "agent" : "agents"} ready.</span>
        </p>
      ) : (
        <ul className="space-y-2">
          {running.map((agent) => (
            <li key={agent.agent}>
              <PaperCard className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2" aria-hidden="true">
                      <span className="absolute inline-flex size-full rounded-full bg-paper-green opacity-60 motion-safe:animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-paper-green" />
                    </span>
                    <span className="text-[14.5px] font-semibold text-paper-moss">{agent.label}</span>
                    {agent.model ? <Tag>{agent.model}</Tag> : null}
                  </div>
                  <p className="mt-1.5 max-w-[60ch] truncate text-[13.5px] text-paper-char">{agent.detail ?? "Working"}</p>
                </div>

                <div className="shrink-0 text-right">
                  {agent.tokens === undefined ? (
                    <p className="max-w-[24ch] text-[12.5px] leading-5 text-paper-sage">Tokens appear when the run completes</p>
                  ) : (
                    <>
                      <span className="block font-paper-display text-[18px] font-bold text-paper-moss tabular-nums">
                        {measuredTokens({ tokens: agent.tokens, records: 1, measured: 1, costed: agent.costUsd === undefined ? 0 : 1, status: "exact" }).text}
                      </span>
                      <span className="block text-[12px] text-paper-sage">{formatCost(agent.costUsd)}</span>
                    </>
                  )}
                </div>
              </PaperCard>
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

function AgentCard({ agent }: { agent: AgentUsage }) {
  const isHermes = agent.agent === "hermes";

  return (
    <PaperCard className="h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-paper-display text-[19px] leading-7 font-bold tracking-[-0.02em] text-paper-moss">{agent.label}</h3>
          <Link
            to={`/operations/agents/${agent.agent}`}
            className={cn(
              "mt-0.5 inline-flex items-center gap-1 rounded-[2px] text-[13px] text-paper-moss underline decoration-paper-mist decoration-[1.5px] underline-offset-[3px] transition-colors duration-150 hover:text-paper-blue hover:decoration-paper-blue",
              PAPER_FOCUS,
            )}
          >
            Open agent
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        {/* The number that makes two workers comparable, drawn as the ring:
            a cheap worker that needs three attempts is not the cheap worker. */}
        {!isHermes ? (
          <div className="flex items-center gap-2">
            <span className="text-right text-[12px] leading-4 text-paper-sage">
              First-pass
              <br />
              reviews
            </span>
            <RadialMeter value={agent.firstPassReviewRate} label={`${agent.label} first-pass review rate`} size={56} />
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-paper-stone pt-4 sm:grid-cols-4">
        <Figure value={measuredTokens(agent.total)} label="Tokens" size="small" />
        <Figure value={measuredCost(agent.total)} label="Spend" size="small" />
        <Figure
          value={{ text: String(agent.runs), measurement: "exact" }}
          label={isHermes ? "Runs" : "Jobs"}
          size="small"
          detail={isHermes ? undefined : `${agent.completed} completed`}
        />
        <Figure
          value={{ text: formatCost(agent.avgSuccessfulCostUsd), measurement: agent.avgSuccessfulCostUsd === undefined ? "unknown" : "exact" }}
          label="Cost / success"
          size="small"
          detail={agent.avgCostUsd === undefined ? undefined : `${formatCost(agent.avgCostUsd)} / attempt`}
        />
      </div>

      {agent.topOperations.length > 0 ? (
        <p className="mt-4 text-[12.5px] leading-5 text-paper-sage">
          Mostly {agent.topOperations.map((row) => row.label.toLowerCase()).join(" · ")}
        </p>
      ) : null}
    </PaperCard>
  );
}
