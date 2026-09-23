import { useState } from "react";
import type { OperationsData } from "@shared/usage-types";
import {
  AppShell,
  ErrorState,
  LoadingState,
  TabBar,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useOperations } from "@/lib/agentos/queries";
import { AgentsTab } from "./agents-tab";
import { Breakdown, Figure } from "./figures";
import { MoneyTab } from "./money-tab";
import {
  coverageNote,
  formatPercent,
  measuredCost,
  measuredTokens,
} from "./operations-model";
import { UsageTab } from "./usage-tab";

/**
 * Operations.
 *
 * The third management layer, beside the two that already exist:
 *
 * ```text
 * MISSION CONTROL   what needs my attention?
 * PROJECTS          what work needs to get done?
 * OPERATIONS        how is my AI workforce performing, and what does it cost?
 * ```
 *
 * Tabs rather than six sidebar entries, deliberately. These are six views of
 * one question, and promoting each to top-level navigation would make the
 * workspace look like a billing product — which this is not. It is a control
 * plane that happens to know what things cost.
 *
 * Like Mission Control, it owns nothing and can do nothing: every figure is
 * read from the ledger or the job store, and the only writes on the whole
 * screen record what the operator already pays and has already decided.
 */

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

type Tab = "usage" | "agents" | "models" | "projects" | "money";

const TABS = [
  { value: "usage" as const, label: "Usage" },
  { value: "agents" as const, label: "Agents" },
  { value: "models" as const, label: "Models" },
  { value: "projects" as const, label: "Projects" },
  { value: "money" as const, label: "Cost" },
];

export function OperationsPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useOperations();

  const running = (data?.live ?? []).some((agent) => agent.state === "running");

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="operations"
      activeHref="/operations"
      agentState={running ? "running" : "idle"}
      agentLabel={running ? "Agents / running" : "Agents / idle"}
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Operations"
            message="Reading the ledger…"
            detail="Usage · cost · workforce"
          />
        ) : !data ? (
          <ErrorState
            label="Operations unavailable"
            title="Usage could not be read."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <Operations data={data} />
        )}
      </div>
    </AppShell>
  );
}

function Operations({ data }: { data: OperationsData }) {
  const [tab, setTab] = useState<Tab>("usage");

  return (
    <>
      <header className="border-b border-os-border pb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h1 className="text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.05] font-normal tracking-[-0.03em]">
            Operations
          </h1>
          <span className="os-meta text-os-subtle">{data.window.label}</span>
        </div>

        <div className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            value={measuredTokens(data.month)}
            label="Tokens"
            detail={coverageNote(data.month)}
          />
          <Figure value={measuredCost(data.month)} label="API spend" />
          <Figure
            value={{ text: String(data.jobsThisMonth), measurement: "exact" }}
            label="Jobs"
          />
          <Figure
            value={{
              text: formatPercent(data.successRate),
              measurement: data.successRate === undefined ? "unknown" : "exact",
            }}
            label="Success rate"
          />
        </div>
      </header>

      <TabBar<Tab>
        options={TABS}
        value={tab}
        onChange={setTab}
        label="Operations sections"
        className="mt-10"
      />

      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="mt-10"
      >
        {tab === "usage" ? <UsageTab data={data} /> : null}
        {tab === "agents" ? <AgentsTab data={data} /> : null}

        {tab === "models" ? (
          <Breakdown
            rows={data.models}
            label="By model"
            empty="No run has reported which model it used."
          />
        ) : null}

        {tab === "projects" ? (
          <Breakdown
            rows={data.projects}
            label="By project"
            by="cost"
            empty="No usage has been attributed to a project yet."
          />
        ) : null}

        {tab === "money" ? <MoneyTab data={data} /> : null}
      </div>
    </>
  );
}
