import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { AgentDetail } from "@shared/usage-types";
import { AppShell } from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useAgentDetail } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { Breakdown, Figure, TotalFigures } from "./figures";
import { formatCost } from "./operations-model";
import { PAPER_FOCUS, PaperButton, PaperCard, PaperSection, PaperStage, RadialMeter, Tag } from "@/components/paper";
import { RecentJobs } from "./usage-tab";

/**
 * One agent, in full — a second page of the same ledger.
 *
 * What turns a worker list into worker management. A roster says a worker
 * exists; this says how it is configured, what it has cost this month, how
 * often its work survives review, and which jobs those numbers came from —
 * which is enough to decide whether to keep routing work to it.
 *
 * Configuration is shown as plain label/value rows because the interesting
 * facts differ per agent: Grok has a binary, Claude has a model and a per-job
 * budget, Hermes has a base URL and a key that is reported only as present or
 * not. A schema covering all three would fit none of them, and printing a key
 * would be indefensible.
 */
export function AgentDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const { data, isPending, isFetching, error, refetch } = useAgentDetail(id);

  return (
    <AppShell navigationItems={navigationItems} pageId="operations-agent" activeHref="/operations" modelLabel="Model / AgentOS V1">
      <PaperStage>
          {isPending ? (
            <div aria-busy="true" aria-label="Reading the agent">
              <div className="h-8 w-48 rounded-none bg-paper-linen motion-safe:animate-pulse" />
              <div className="mt-6 h-40 rounded-none border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
            </div>
          ) : !data ? (
            <div className="py-4">
              <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">That agent has no record.</h1>
              <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "Nothing was returned for this agent."}</p>
              <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? "Trying again…" : "Try again"}
              </PaperButton>
            </div>
          ) : (
            <Agent agent={data} />
          )}
      </PaperStage>
    </AppShell>
  );
}

function Agent({ agent }: { agent: AgentDetail }) {
  const isHermes = agent.agent === "hermes";

  return (
    <div>
      <Link
        to="/operations?tab=agents"
        className={cn("-mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-none px-1 text-[13px] text-paper-sage transition-colors duration-150 hover:text-paper-moss", PAPER_FOCUS)}
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Operations
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-paper-mist pb-6">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[30px] leading-9 font-extrabold tracking-[-0.015em] text-paper-moss">{agent.label}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Tag tone={agent.available ? "green" : "flame"}>{agent.available ? "Ready" : "Unavailable"}</Tag>
            {agent.role ? <span className="text-[13px] text-paper-sage">{agent.role}</span> : null}
          </div>
        </div>
        <span className="text-[13px] text-paper-sage">{agent.window.label}</span>
      </header>

      {agent.unavailableReason ? <p className="mt-4 max-w-[72ch] text-[13.5px] leading-5 text-paper-char">{agent.unavailableReason}</p> : null}

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-12">
          <PaperCard>
            <div className="flex flex-wrap items-center justify-between gap-6">
              <TotalFigures total={agent.usage.total} costLabel="Spend" />
              {!isHermes ? (
                <div className="flex items-center gap-3">
                  <span className="text-right text-[12.5px] leading-4 text-paper-sage">
                    First-pass
                    <br />
                    reviews
                  </span>
                  <RadialMeter value={agent.usage.firstPassReviewRate} label="First-pass review rate" size={72} />
                </div>
              ) : null}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-paper-stone pt-4 sm:grid-cols-3">
              <Figure
                value={{ text: String(agent.usage.runs), measurement: "exact" }}
                label={isHermes ? "Runs" : "Jobs"}
                size="small"
                detail={isHermes ? undefined : `${agent.usage.completed} completed`}
              />
              <Figure value={{ text: String(agent.jobsToday), measurement: "exact" }} label={isHermes ? "Runs today" : "Jobs today"} size="small" />
              <Figure
                value={{ text: formatCost(agent.usage.avgSuccessfulCostUsd), measurement: agent.usage.avgSuccessfulCostUsd === undefined ? "unknown" : "exact" }}
                label="Cost / success"
                size="small"
                detail={agent.usage.avgRevisions === undefined ? undefined : `${agent.usage.avgRevisions.toFixed(1)} revisions avg`}
              />
            </div>
          </PaperCard>

          <Breakdown rows={agent.operations} label="By operation" empty="Nothing recorded this month." />

          {agent.models.length > 0 ? <Breakdown rows={agent.models} label="By model" /> : null}

          <RecentJobs jobs={agent.recentJobs} />
        </div>

        <PaperSection label="Configuration">
          {agent.configuration.length === 0 ? (
            <p className="text-[14px] leading-6 text-paper-sage">Nothing configurable.</p>
          ) : (
            <dl className="divide-y divide-paper-stone rounded-none border border-paper-mist">
              {agent.configuration.map((row) => (
                <div key={row.label} className="px-3.5 py-2.5">
                  <dt className="text-[12.5px] font-medium text-paper-char">{row.label}</dt>
                  <dd className="mt-1 font-mono text-[12px] leading-5 break-words text-paper-moss">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </PaperSection>
      </div>
    </div>
  );
}
