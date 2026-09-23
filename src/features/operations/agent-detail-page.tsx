import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { AgentDetail } from "@shared/usage-types";
import {
  AppShell,
  ErrorState,
  LoadingState,
  Section,
  StatusPill,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useAgentDetail } from "@/lib/agentos/queries";
import { Breakdown, Figure, TotalFigures } from "./figures";
import { formatCost, formatPercent } from "./operations-model";
import { RecentJobs } from "./usage-tab";

/**
 * One agent, in full.
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

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

export function AgentDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const { data, isPending, isFetching, error, refetch } = useAgentDetail(id);

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="operations-agent"
      activeHref="/operations"
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Agent"
            message="Reading the agent…"
            detail="Operations / agents"
          />
        ) : !data ? (
          <ErrorState
            label="Agent unavailable"
            title="That agent has no record."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <Agent agent={data} />
        )}
      </div>
    </AppShell>
  );
}

function Agent({ agent }: { agent: AgentDetail }) {
  return (
    <>
      <header className="border-b border-os-border pb-8">
        <Link
          to="/operations"
          className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Operations
        </Link>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.05] font-normal tracking-[-0.03em]">
              {agent.label}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <StatusPill
                status={agent.available ? "healthy" : "blocked"}
                label={agent.available ? "Ready" : "Unavailable"}
              />
              {agent.role ? (
                <span className="os-meta text-os-subtle">{agent.role}</span>
              ) : null}
            </div>
          </div>

          <span className="os-meta text-os-subtle">{agent.window.label}</span>
        </div>

        {agent.unavailableReason ? (
          <p className="mt-5 max-w-[72ch] text-[13px] leading-5 text-os-warning">
            {agent.unavailableReason}
          </p>
        ) : null}
      </header>

      <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-12">
          <section>
            <TotalFigures total={agent.usage.total} costLabel="Spend" />

            <div className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-4">
              <Figure
                value={{
                  text: String(agent.usage.runs),
                  measurement: "exact",
                }}
                label={agent.agent === "hermes" ? "Runs" : "Jobs"}
                size="small"
                detail={
                  agent.agent === "hermes"
                    ? undefined
                    : `${agent.usage.completed} completed`
                }
              />
              <Figure
                value={{
                  text: String(agent.jobsToday),
                  measurement: "exact",
                }}
                label={agent.agent === "hermes" ? "Runs today" : "Jobs today"}
                size="small"
              />
              <Figure
                value={{
                  text: formatPercent(agent.usage.firstPassReviewRate),
                  measurement:
                    agent.usage.firstPassReviewRate === undefined
                      ? "unknown"
                      : "exact",
                }}
                label="First-pass reviews"
                size="small"
              />
              <Figure
                value={{
                  text: formatCost(agent.usage.avgSuccessfulCostUsd),
                  measurement:
                    agent.usage.avgSuccessfulCostUsd === undefined
                      ? "unknown"
                      : "exact",
                }}
                label="Cost / success"
                size="small"
                detail={
                  agent.usage.avgRevisions === undefined
                    ? undefined
                    : `${agent.usage.avgRevisions.toFixed(1)} revisions avg`
                }
              />
            </div>
          </section>

          <Breakdown
            rows={agent.operations}
            label="By operation"
            empty="Nothing recorded this month."
          />

          {agent.models.length > 0 ? (
            <Breakdown rows={agent.models} label="By model" />
          ) : null}

          <RecentJobs jobs={agent.recentJobs} />
        </div>

        <div className="min-w-0">
          <Section label="Configuration">
            <dl className="space-y-4">
              {agent.configuration.map((row) => (
                <div key={row.label}>
                  <dt className="os-meta text-os-subtle">{row.label}</dt>
                  <dd className="mt-1.5 font-mono text-[12px] leading-5 break-words text-os-muted">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            {agent.configuration.length === 0 ? (
              <p className="text-[15px] leading-6 text-os-muted">
                Nothing configurable.
              </p>
            ) : null}
          </Section>
        </div>
      </div>
    </>
  );
}
