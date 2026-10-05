import { useSearchParams } from "react-router-dom";
import type { CareerData } from "@shared/career-types";
import { AppShell } from "@/components/os";
import { PaperButton, PaperStage, PaperTabs } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useCareer } from "@/lib/agentos/career";
import { CareerGrowthTab } from "./career-growth-tab";
import { CareerLinkedInTab } from "./career-linkedin-tab";
import { CAREER_TAB_OPTIONS, isCareerTab } from "./career-model";
import { CareerOverviewTab } from "./career-overview-tab";
import { CareerRoutinesTab } from "./career-routines-tab";
import { CareerTasksTab } from "./career-tasks-tab";
import type { CareerTab } from "./career-types-ui";
import { CareerWorkLogTab } from "./career-work-log-tab";

/**
 * Career — employment admin, the record of the work, and where it is going.
 *
 * Separate from the businesses, wired into the same machinery: tasks are the
 * career workspace's TASKS.md, integrations are Connectors, learnings become
 * memory only through an approved proposal, and anything that writes to
 * another service waits for a person.
 */
export function CareerPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useCareer();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: CareerTab = isCareerTab(requested) ? requested : "overview";

  const onTab = (next: CareerTab) =>
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
    <AppShell navigationItems={navigationItems} pageId="career" activeHref="/career" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        {isPending ? (
          <div aria-busy="true" aria-label="Reading Career">
            <div className="h-9 w-48 rounded-none bg-paper-linen motion-safe:animate-pulse" />
            <div className="mt-8 h-40 rounded-none border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
          </div>
        ) : !data ? (
          <div className="py-4">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">Career could not be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "The adapter did not answer."}</p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <Career data={data} tab={tab} onTab={onTab} />
        )}
      </PaperStage>
    </AppShell>
  );
}

function Career({ data, tab, onTab }: { data: CareerData; tab: CareerTab; onTab: (tab: CareerTab) => void }) {
  return (
    <div className="[color-scheme:light]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Career</h1>
          <p className="mt-1 text-[13px] text-paper-sage">
            {data.growth.role}
            {data.currentWork.project ? ` · ${data.currentWork.project}` : ""}
          </p>
        </div>
        {data.todayItems.length > 0 ? (
          <p className="text-[12.5px] font-semibold tracking-[0.1em] text-paper-flame-deep uppercase">{data.todayItems.length} due today</p>
        ) : null}
      </header>

      <div className="mt-8">
        <PaperTabs<CareerTab> options={CAREER_TAB_OPTIONS} value={tab} onChange={onTab} label="Career sections" />
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-8">
        {tab === "overview" ? <CareerOverviewTab data={data} onTab={onTab} /> : null}
        {tab === "tasks" ? <CareerTasksTab data={data} /> : null}
        {tab === "routines" ? <CareerRoutinesTab data={data} /> : null}
        {tab === "work-log" ? <CareerWorkLogTab data={data} /> : null}
        {tab === "growth" ? <CareerGrowthTab data={data} /> : null}
        {tab === "linkedin" ? <CareerLinkedInTab data={data} /> : null}
      </div>
    </div>
  );
}
