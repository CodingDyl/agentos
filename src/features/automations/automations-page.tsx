import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { AppShell } from "@/components/os";
import { PaperButton, PaperSection, PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useAutomationSurfaces, useAutomations } from "@/lib/agentos/queries";
import { AutomationRow } from "./automation-row";
import { countActive } from "./automations-model";
import { BackgroundWork, HermesSwitches } from "./hermes-surfaces";

/**
 * Everything Hermes does on its own: scheduled jobs, the skill curator,
 * kanban dispatch, shell hooks and webhooks — and the two switches that decide
 * whether any of it fires.
 *
 * Reading costs no model call. The only changes made from here are pause,
 * resume and run-now on a job, and pause/resume on the curator; creating and
 * editing jobs stays in Hermes.
 */
export function AutomationsPage() {
  const navigationItems = useNavigationItems();
  const jobs = useAutomations();
  const surfaces = useAutomationSurfaces();

  const automations = useMemo(() => jobs.data?.automations ?? [], [jobs.data]);
  const active = countActive(automations);
  const refreshing = jobs.isFetching || surfaces.isFetching;

  const refresh = () => {
    void jobs.refetch();
    void surfaces.refetch();
  };

  return (
    <AppShell navigationItems={navigationItems} pageId="automations" activeHref="/automations" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">
              Automations
            </h1>
            <p className="mt-1 text-[13px] text-paper-sage" aria-live="polite">
              What Hermes does on its own
              {jobs.data ? ` · ${automations.length} scheduled, ${active} active` : ""}
              {refreshing ? " · Updating…" : ""}
            </p>
          </div>
          <PaperButton variant="quiet" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "size-3.5 motion-safe:animate-spin" : "size-3.5"} aria-hidden="true" />
            Refresh
          </PaperButton>
        </header>

        {surfaces.data ? <HermesSwitches surfaces={surfaces.data} /> : null}

        <PaperSection label="Scheduled jobs" count={jobs.data ? automations.length : undefined} className="mt-10">
          {jobs.isPending ? (
            <p className="text-[14px] text-paper-sage">Reading Hermes' schedule…</p>
          ) : !jobs.data ? (
            <div className="rounded-[4px] border border-paper-mist px-5 py-4">
              <p className="font-semibold text-paper-moss">Hermes' schedule couldn't be read.</p>
              <p className="mt-1 max-w-[72ch] text-[13.5px] leading-6 text-paper-char">
                {jobs.error?.message} Automations are read through the Hermes CLI. Check that <code className="font-mono text-[12.5px]">hermes</code> is on
                the server's PATH, or set <code className="font-mono text-[12.5px]">HERMES_CLI_PATH</code>.
              </p>
              <PaperButton variant="amber" className="mt-4" disabled={jobs.isFetching} onClick={() => void jobs.refetch()}>
                {jobs.isFetching ? "Trying again…" : "Try again"}
              </PaperButton>
            </div>
          ) : (
            <>
              {!jobs.data.health.ok ? (
                <div role="status" className="mb-4 rounded-[4px] border border-paper-flame-deep px-5 py-4">
                  <p className="text-[13px] font-semibold text-paper-flame-deep">Hermes' job check found problems</p>
                  <ul className="mt-2 space-y-1 text-[13.5px] leading-6 text-paper-char">
                    {(jobs.data.health.issues.length > 0
                      ? jobs.data.health.issues
                      : ["Hermes could not confirm the health of these jobs."]
                    ).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {automations.length === 0 ? (
                <p className="text-[14px] text-paper-sage">
                  Hermes has no scheduled jobs. Create one with{" "}
                  <code className="font-mono text-[12.5px] text-paper-moss">hermes cron create</code>.
                </p>
              ) : (
                <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
                  {automations.map((automation) => (
                    <AutomationRow key={automation.id} automation={automation} />
                  ))}
                </ul>
              )}
            </>
          )}
        </PaperSection>

        <PaperSection label="Background work" className="mt-12">
          {surfaces.data ? (
            <BackgroundWork surfaces={surfaces.data} />
          ) : surfaces.isPending ? (
            <p className="text-[14px] text-paper-sage">Asking Hermes what else it runs…</p>
          ) : (
            <p className="text-[14px] text-paper-sage">
              Hermes couldn't report its other automations. {surfaces.error?.message}
            </p>
          )}
        </PaperSection>
      </PaperStage>
    </AppShell>
  );
}
