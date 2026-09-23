import { TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import {
  AppShell,
  EmptyState,
  ErrorState,
  HairlineCard,
  LoadingState,
  PageHeader,
  SystemIndicator,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useAutomations } from "@/lib/agentos/queries";
import { AutomationRow } from "./automation-row";
import { countActive } from "./automations-model";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

/**
 * What Hermes runs without being asked.
 *
 * The screen is a read of Hermes' own schedule: it starts nothing, changes
 * nothing, and costs no model call to display. Editing schedules deliberately
 * lives in Hermes, not here.
 */
export function AutomationsPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useAutomations();

  const automations = useMemo(() => data?.automations ?? [], [data]);
  const active = countActive(automations);

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="automations"
      activeHref="/automations"
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Automations"
            message="Reading Hermes' schedule…"
            detail="Hermes / cron"
          />
        ) : !data ? (
          <ErrorState
            label="Schedule unavailable"
            title="Could not read Hermes' scheduled jobs."
            detail={error?.message}
            hint={
              <>
                Automations are read through the Hermes CLI. Check that{" "}
                <span className="font-mono text-os-subtle">hermes</span> is on
                the adapter's PATH, or set{" "}
                <span className="font-mono text-os-subtle">HERMES_CLI_PATH</span>.
              </>
            }
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <PageHeader
              title="Automations"
              description="The work Hermes does on its own schedule. Read from Hermes; changed in Hermes."
              actions={
                automations.length > 0 ? (
                  <SystemIndicator
                    state={active > 0 ? "online" : "idle"}
                    label={`${active} active`}
                    detail={
                      automations.length > active
                        ? `${automations.length} total`
                        : undefined
                    }
                  />
                ) : null
              }
            />

            {/* The doctor's verdict, and only when it has something to say. */}
            {!data.health.ok ? (
              <HairlineCard className="mt-10 max-w-[72ch] p-5 md:p-6" role="status">
                <div className="flex gap-3">
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-os-warning"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="os-meta text-os-subtle">Cron doctor</p>
                    {data.health.issues.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {data.health.issues.map((issue) => (
                          <li
                            key={issue}
                            className="text-[15px] leading-6 text-os-muted"
                          >
                            {issue}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-[15px] leading-6 text-os-muted">
                        Hermes could not confirm the health of these jobs.
                      </p>
                    )}
                  </div>
                </div>
              </HairlineCard>
            ) : null}

            {automations.length === 0 ? (
              <EmptyState
                label="No automations"
                description="Hermes has no scheduled jobs. Create one with `hermes cron create`."
                className="mt-10"
              />
            ) : (
              <HairlineCard className="mt-10 overflow-hidden">
                <ul className="divide-y divide-os-border">
                  {automations.map((automation) => (
                    <AutomationRow key={automation.id} automation={automation} />
                  ))}
                </ul>
              </HairlineCard>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
