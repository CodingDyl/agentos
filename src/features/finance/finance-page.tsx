import { useSearchParams } from "react-router-dom";
import type { FinanceData, FinanceTab } from "@shared/finance-types";
import { AppShell } from "@/components/os";
import { PaperButton, PaperStage, PaperTabs } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useFinance } from "@/lib/agentos/finance";
import { FinanceCashFlowTab } from "./finance-cash-flow-tab";
import { FinanceGoalsTab } from "./finance-goals-tab";
import { FinanceInsightsTab } from "./finance-insights-tab";
import { FinanceInvestmentsTab } from "./finance-investments-tab";
import { SampleNotice } from "./finance-kit";
import { FINANCE_TAB_OPTIONS, isFinanceTab, sourceLabel } from "./finance-model";
import { FinanceOverviewTab } from "./finance-overview-tab";
import { FinanceSettingsTab } from "./finance-settings-tab";
import { FinanceSpendingTab } from "./finance-spending-tab";
import { FinanceSubscriptionsTab } from "./finance-subscriptions-tab";

/**
 * Finance — the money side of the operating system.
 *
 * Read-only by design. AgentOS reads Investec, works out the arithmetic itself,
 * asks Jev only which subscriptions deserve a second look, and asks Hermes only
 * to explain figures that already exist. Nothing on this page can pay, transfer
 * or buy, and the page holds no banking credentials: they live on the server.
 */
export function FinancePage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useFinance();

  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: FinanceTab = isFinanceTab(requested) ? requested : "overview";

  const onTab = (next: FinanceTab) =>
    setSearchParams(
      (params) => {
        const updated = new URLSearchParams(params);
        if (next === "overview") updated.delete("tab");
        else updated.set("tab", next);
        return updated;
      },
      { replace: true },
    );

  return (
    <AppShell navigationItems={navigationItems} pageId="finance" activeHref="/finance" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        {isPending ? (
          <div aria-busy="true" aria-label="Reading Finance">
            <div className="h-9 w-48 rounded-[4px] bg-paper-linen motion-safe:animate-pulse" />
            <div className="mt-8 h-40 rounded-[4px] border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
          </div>
        ) : !data ? (
          <div className="py-4">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">Finance could not be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
              {error?.message ?? "The adapter did not answer."} Finance reads its local store through the AgentOS server; check that it is running.
            </p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <Finance data={data} tab={tab} onTab={onTab} />
        )}
      </PaperStage>
    </AppShell>
  );
}

function Finance({ data, tab, onTab }: { data: FinanceData; tab: FinanceTab; onTab: (tab: FinanceTab) => void }) {
  const month = new Date(`${data.month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    // The app sets `color-scheme: dark`, which turns native radios, checkboxes
    // and date pickers dark inside a white page. This page is paper, so it says so.
    <div className="[color-scheme:light]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Finance</h1>
          <p className="mt-1 text-[13px] text-paper-sage">
            {sourceLabel(data.source)}
            {data.source.lastSyncedAt ? ` · synced ${new Date(data.source.lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <p className="text-[12.5px] font-semibold tracking-[0.1em] text-paper-sage uppercase">{month}</p>
      </header>

      <div className="mt-8">
        <PaperTabs<FinanceTab> options={FINANCE_TAB_OPTIONS} value={tab} onChange={onTab} label="Finance sections" />
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-8">
        {data.source.kind === "sample" && tab !== "settings" ? <SampleNotice onSettings={() => onTab("settings")} /> : null}
        {data.source.error && tab !== "settings" ? (
          <p role="alert" className="mb-8 text-[14px] leading-6 text-paper-flame-deep">
            The last Investec sync failed: {data.source.error}
          </p>
        ) : null}

        {tab === "overview" ? <FinanceOverviewTab data={data} onTab={onTab} /> : null}
        {tab === "cash-flow" ? <FinanceCashFlowTab data={data} /> : null}
        {tab === "spending" ? <FinanceSpendingTab data={data} /> : null}
        {tab === "subscriptions" ? <FinanceSubscriptionsTab data={data} /> : null}
        {tab === "goals" ? <FinanceGoalsTab data={data} /> : null}
        {tab === "investments" ? <FinanceInvestmentsTab data={data} /> : null}
        {tab === "insights" ? <FinanceInsightsTab data={data} /> : null}
        {tab === "settings" ? <FinanceSettingsTab data={data} /> : null}
      </div>
    </div>
  );
}
