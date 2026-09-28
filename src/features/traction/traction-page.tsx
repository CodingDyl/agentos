import { useSearchParams } from "react-router-dom";
import type { TractionData } from "@shared/traction-types";
import { AppShell } from "@/components/os";
import { PaperButton, PaperStage, PaperTabs } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useTraction } from "@/lib/agentos/traction";
import { TractionClientsTab } from "./traction-clients-tab";
import { TractionExperimentsTab } from "./traction-experiments-tab";
import { isTractionTab, TRACTION_TABS, type TractionTab } from "./traction-model";
import { TractionOffersTab } from "./traction-offers-tab";
import { TractionOverviewTab } from "./traction-overview-tab";
import { TractionPipelineTab } from "./traction-pipeline-tab";
import { TractionProspectsTab } from "./traction-prospects-tab";
import { TractionReviewTab } from "./traction-review-tab";
import { TractionWaitingTab } from "./traction-waiting-tab";

/**
 * Traction — the customer-acquisition operating system.
 *
 * Named for the purpose: get customers, not "do marketing". The page is
 * action-first. Its first screen says what to do today, and the one number it
 * optimises is qualified customer conversations per week.
 *
 * Nothing on it sends anything. Hermes can research a prospect or draft a
 * message, but only in the agent console, and a person sends every message
 * themselves.
 */
export function TractionPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useTraction();

  // Tab and prospect live in the URL, so the queue's OPEN and Today's links
  // land on the right thing, and a reload keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: TractionTab = isTractionTab(requested) ? requested : "overview";

  const update = (changes: Record<string, string | undefined>) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="traction"
      activeHref="/traction"
      agentState="idle"
      agentLabel="Agents / idle"
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        {isPending ? (
          <div aria-busy="true" aria-label="Reading Traction">
            <div className="h-9 w-48 rounded-[4px] bg-paper-linen motion-safe:animate-pulse" />
            <div className="mt-8 h-40 rounded-[4px] border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
          </div>
        ) : !data ? (
          <div className="py-4">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">Traction could not be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
              {error?.message ?? "The adapter did not answer."} Traction reads its local store through the AgentOS server; check that it is running.
            </p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <Traction
            data={data}
            tab={tab}
            prospectId={searchParams.get("prospect") ?? undefined}
            onTab={(next) => update({ tab: next === "overview" ? undefined : next, prospect: undefined })}
            onProspect={(prospectId) => update({ tab: "prospects", prospect: prospectId })}
          />
        )}
      </PaperStage>
    </AppShell>
  );
}

function Traction({
  data,
  tab,
  prospectId,
  onTab,
  onProspect,
}: {
  data: TractionData;
  tab: TractionTab;
  prospectId: string | undefined;
  onTab: (tab: TractionTab) => void;
  onProspect: (prospectId: string | undefined) => void;
}) {
  const month = new Date(`${data.today}T12:00:00`).toLocaleDateString("en-GB", { month: "long" });

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Traction</h1>
          <p className="mt-1 text-[13px] text-paper-sage">
            {data.icp ? `Selling to ${data.icp.name}${data.icp.geography ? ` · ${data.icp.geography}` : ""}` : "No active ICP yet"}
          </p>
        </div>
        <p className="text-[12.5px] font-semibold tracking-[0.1em] text-paper-sage uppercase">{month}</p>
      </header>

      <div className="mt-8">
        <PaperTabs<TractionTab> options={TRACTION_TABS} value={tab} onChange={onTab} label="Traction sections" />
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-8">
        {tab === "overview" ? <TractionOverviewTab data={data} onTab={onTab} /> : null}
        {tab === "prospects" ? <TractionProspectsTab data={data} selectedId={prospectId} onSelect={onProspect} /> : null}
        {tab === "pipeline" ? <TractionPipelineTab data={data} onOpen={(id) => onProspect(id)} /> : null}
        {tab === "waiting" ? <TractionWaitingTab data={data} /> : null}
        {tab === "clients" ? <TractionClientsTab data={data} /> : null}
        {tab === "offers" ? <TractionOffersTab data={data} /> : null}
        {tab === "experiments" ? <TractionExperimentsTab data={data} /> : null}
        {tab === "review" ? <TractionReviewTab data={data} /> : null}
      </div>
    </div>
  );
}
