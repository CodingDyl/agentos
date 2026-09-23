import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { AgentUsage, LiveAgent, OperationsData } from "@shared/usage-types";
import { HairlineCard, SectionLabel, StatusPill } from "@/components/os";
import { cn } from "@/lib/utils";
import { Figure } from "./figures";
import {
  formatCost,
  formatPercent,
  measuredCost,
  measuredTokens,
  UNKNOWN,
} from "./operations-model";

/**
 * The workforce.
 *
 * What each agent is doing right now, and what each has cost this month
 * against what that bought. The pairing is the whole argument: "Claude costs
 * more" is not a routing decision, but "Claude costs $0.91 a job and passes
 * review first time 88% of the time, against Grok at $0.39 and 69%" is — and
 * whether 2× the price for half the revisions is worth it becomes a question
 * with an answer.
 */
export function AgentsTab({ data }: { data: OperationsData }) {
  return (
    <div className="space-y-12">
      <LiveStrip live={data.live} />

      <section>
        <SectionLabel>This month</SectionLabel>

        <ul className="mt-4 space-y-4">
          {data.agents.map((agent) => (
            <li key={agent.agent}>
              <AgentCard agent={agent} />
            </li>
          ))}
        </ul>

        {data.agents.length === 0 ? (
          <p className="mt-4 text-[15px] leading-6 text-os-muted">
            No agent has run this month.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * What is running, right now.
 *
 * A worker that does not stream usage shows no number at all, and the line
 * underneath says why. Animating a rising estimate would make the panel feel
 * alive and make every figure on this screen untrustworthy — a number that
 * moves is read as a measurement.
 */
function LiveStrip({ live }: { live: readonly LiveAgent[] }) {
  const running = live.filter((agent) => agent.state === "running");

  return (
    <section>
      <SectionLabel>Active</SectionLabel>

      {running.length === 0 ? (
        <p className="mt-4 text-[15px] leading-6 text-os-muted">
          Nothing is running.{" "}
          <span className="text-os-subtle">
            {live.filter((agent) => agent.state === "ready").length} agent
            {live.filter((agent) => agent.state === "ready").length === 1
              ? ""
              : "s"}{" "}
            ready.
          </span>
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {running.map((agent) => (
            <li key={agent.agent}>
              <HairlineCard className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <StatusPill status="running" label={agent.label} />
                    {agent.model ? (
                      <span className="os-meta text-os-subtle">
                        {agent.model}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 max-w-[60ch] truncate text-[15px] leading-6 text-os-muted">
                    {agent.detail ?? "Working"}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {agent.tokens === undefined ? (
                    <p className="max-w-[22ch] text-[13px] leading-5 text-os-subtle">
                      Tokens available when the run completes
                    </p>
                  ) : (
                    <>
                      <span className="block tabular-nums text-[18px] text-foreground">
                        {measuredTokens({
                          tokens: agent.tokens,
                          records: 1,
                          measured: 1,
                          costed: agent.costUsd === undefined ? 0 : 1,
                          status: "exact",
                        }).text}
                      </span>
                      <span className="os-meta mt-1 block text-os-subtle">
                        {formatCost(agent.costUsd)}
                      </span>
                    </>
                  )}
                </div>
              </HairlineCard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentCard({ agent }: { agent: AgentUsage }) {
  const tokens = measuredTokens(agent.total);
  const cost = measuredCost(agent.total);

  return (
    <HairlineCard className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h3 className="text-[16px] leading-6 text-foreground">{agent.label}</h3>

        <Link
          to={`/operations/agents/${agent.agent}`}
          className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-2 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          Detail
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-5 grid gap-x-10 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        <Figure value={tokens} label="Tokens" size="small" />
        <Figure value={cost} label="Spend" size="small" />
        <Figure
          value={{ text: String(agent.runs), measurement: "exact" }}
          label={agent.agent === "hermes" ? "Runs" : "Jobs"}
          size="small"
          detail={
            agent.agent === "hermes"
              ? undefined
              : `${agent.completed} completed`
          }
        />
        <Figure
          value={{
            text: formatPercent(agent.firstPassReviewRate),
            measurement:
              agent.firstPassReviewRate === undefined ? "unknown" : "exact",
          }}
          label="First-pass"
          size="small"
        />
        {/* The figure that makes two workers comparable. A cheap worker that
            needs three attempts is not the cheap worker. */}
        <Figure
          value={{
            text: formatCost(agent.avgSuccessfulCostUsd),
            measurement:
              agent.avgSuccessfulCostUsd === undefined ? "unknown" : "exact",
          }}
          label="Cost / success"
          size="small"
          detail={
            agent.avgCostUsd === undefined
              ? undefined
              : `${formatCost(agent.avgCostUsd)} / attempt`
          }
        />
      </div>

      {agent.topOperations.length > 0 ? (
        <p className="mt-5 border-t border-os-border pt-4 text-[13px] leading-5 text-os-subtle">
          <span className="os-meta">Main usage</span>{" "}
          <span className={cn("ml-2 text-os-muted")}>
            {agent.topOperations.map((row) => row.label).join(" · ")}
          </span>
        </p>
      ) : null}
    </HairlineCard>
  );
}

export { UNKNOWN };
