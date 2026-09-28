import { useSearchParams } from "react-router-dom";
import type { OperationsData, UsageRange } from "@shared/usage-types";
import { AppShell } from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useOperations } from "@/lib/agentos/queries";
import { AgentsTab } from "./agents-tab";
import { AiStackTab } from "./ai-stack-tab";
import { Breakdown } from "./figures";
import { Glance, PlansPanel } from "./glance";
import { MoneyTab } from "./money-tab";
import { PaperButton, PaperStage, PaperTabs, SegmentedControl } from "@/components/paper";
import { QuietLink, SystemTab } from "./system-tab";
import { UsageTab } from "./usage-tab";

/**
 * Operations.
 *
 * The third management layer, beside the two that already exist:
 *
 * ```text
 * TODAY        what needs my attention?
 * WORKSPACES   what work needs to get done?
 * OPERATIONS   how is the machinery performing, and what does it cost?
 * ```
 *
 * Since Step 59 this is also where the machinery lives: agents, models,
 * subscriptions and budgets, the system's health, and the ways into the
 * Hermes console and worker jobs. The work itself is organised elsewhere;
 * this is the engine room.
 *
 * The first screen built on the shared paper world (Mail trialled it): the
 * whole page is the ledger. The glance answers the page's question before any
 * tab is touched — what this range cost, what the month's bill is, whether the
 * work is landing, and which plans sit underneath it.
 *
 * Like Mission Control, it owns nothing and can do nothing: every figure is
 * read from the ledger or the job store, and the only writes on the whole
 * screen record what the operator already pays and has already decided.
 */

type Tab = "usage" | "stack" | "agents" | "models" | "projects" | "money" | "system";

const TABS = [
  { value: "usage" as const, label: "Usage" },
  { value: "agents" as const, label: "Agents" },
  { value: "stack" as const, label: "AI Stack" },
  { value: "models" as const, label: "Models" },
  { value: "projects" as const, label: "Workspaces" },
  { value: "money" as const, label: "Subscriptions & budgets" },
  { value: "system" as const, label: "System" },
];

const RANGES: readonly UsageRange[] = ["today", "7d", "month"];

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab.value === value);
}

function isRange(value: string | null): value is UsageRange {
  return (RANGES as readonly (string | null)[]).includes(value);
}

export function OperationsPage() {
  const navigationItems = useNavigationItems();

  // Tab and range live in the URL, so Mission Control can link straight to a
  // view and a reload keeps the one you were reading.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRange = searchParams.get("range");
  const range: UsageRange = isRange(requestedRange) ? requestedRange : "month";

  const { data, isPending, isFetching, error, refetch } = useOperations(range);
  const running = (data?.live ?? []).some((agent) => agent.state === "running");

  const setParam = (key: "tab" | "range", value: string, fallback: string) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="operations"
      activeHref="/operations"
      agentState={running ? "running" : "idle"}
      agentLabel={running ? "Agents / running" : "Agents / idle"}
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
          {isPending ? (
            <LoadingSheet />
          ) : !data ? (
            <div className="py-4">
              <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">Usage could not be read.</h1>
              <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
                {error?.message ?? "The ledger did not answer."} Operations reads the local usage ledger; check that the AgentOS server is running.
              </p>
              <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? "Trying again…" : "Try again"}
              </PaperButton>
            </div>
          ) : (
            <Operations
              data={data}
              refreshing={isFetching}
              tab={isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "usage"}
              onTab={(tab) => setParam("tab", tab, "usage")}
              onRange={(next) => setParam("range", next, "month")}
            />
          )}
      </PaperStage>
    </AppShell>
  );
}

function glanceTitle(data: OperationsData): string {
  if (data.range === "today") return "Today at a glance";
  if (data.range === "7d") return "This week at a glance";
  return `${data.window.label} at a glance`;
}

function Operations({
  data,
  refreshing,
  tab,
  onTab,
  onRange,
}: {
  data: OperationsData;
  refreshing: boolean;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onRange: (range: UsageRange) => void;
}) {
  const month = new Date(data.generatedAt).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance text-paper-moss sm:text-[34px]">{glanceTitle(data)}</h1>
          <p className="mt-1 text-[13px] text-paper-sage" aria-live="polite">
            {data.jobs} {data.jobs === 1 ? "job" : "jobs"} · {data.period.records} recorded {data.period.records === 1 ? "run" : "runs"} · Read{" "}
            {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            {refreshing ? " · Updating…" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        {/* The power-user surfaces, one click away rather than in the sidebar. */}
        <QuietLink to="/agent">Hermes console</QuietLink>
        <QuietLink to="/workers">Worker jobs</QuietLink>
        <SegmentedControl
          label="Range"
          value={data.range}
          onChange={onRange}
          options={[
            { value: "today", label: "Today" },
            { value: "7d", label: "7 days" },
            { value: "month", label: month },
          ]}
        />
        </div>
      </header>

      <div className="mt-6">
        <Glance data={data} />
      </div>

      <div className="mt-10">
        <PlansPanel data={data} onManage={() => onTab("money")} />
      </div>

      <div className="mt-12">
        <PaperTabs<Tab> options={TABS} value={tab} onChange={onTab} label="Operations sections" />
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-8">
        {tab === "usage" ? <UsageTab data={data} /> : null}
        {tab === "stack" ? <AiStackTab data={data} /> : null}
        {tab === "agents" ? <AgentsTab data={data} /> : null}
        {tab === "models" ? <Breakdown rows={data.models} label="By model" empty="No run has reported which model it used." /> : null}
        {tab === "projects" ? (
          <Breakdown rows={data.projects} label="By workspace" by="cost" empty="No usage has been attributed to a workspace yet." />
        ) : null}
        {tab === "money" ? <MoneyTab data={data} /> : null}
        {tab === "system" ? <SystemTab /> : null}
      </div>
    </div>
  );
}

/** The page's own shape, drawn empty while the ledger is read. */
function LoadingSheet() {
  return (
    <div aria-busy="true" aria-label="Reading the ledger">
      <div className="h-8 w-64 rounded-[4px] bg-paper-linen motion-safe:animate-pulse" />
      <div className="mt-3 h-4 w-40 rounded-[4px] bg-paper-linen motion-safe:animate-pulse" />
      <div className="mt-6 grid gap-3 md:grid-cols-[1.45fr_1fr_1fr]">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-56 rounded-[4px] border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
