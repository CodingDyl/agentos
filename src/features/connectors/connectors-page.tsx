import { ArrowRight, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ConnectorRecommendation, ConnectorSummary } from "@shared/connector-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperCard, PaperSection, PaperStage, PaperSwitch, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useConnectors, useSetConnectorEnabled } from "@/lib/agentos/connectors";
import { cn } from "@/lib/utils";
import { ConnectorIcon } from "./connector-icon";
import { formatWhen, groupConnectors, statusLabel, statusTone, switchNote, TIER_LABEL } from "./connectors-model";

/**
 * Connectors: the capability registry.
 *
 * Every service AgentOS can reach, whether it is set up on this machine, and
 * whether it is switched on *for AgentOS* — two different facts, because an
 * authenticated account can still be one AgentOS must not touch.
 *
 * Opening this page makes no call to any service. Status comes from local
 * configuration and the last "Test connection".
 */
export function ConnectorsPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useConnectors();

  const groups = useMemo(() => groupConnectors(data?.connectors ?? []), [data]);
  const connected = groups.setUp.filter((connector) => connector.status === "connected").length;

  return (
    <AppShell navigationItems={navigationItems} pageId="connectors" activeHref="/connectors" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">
              Connectors
            </h1>
            <p className="mt-1 text-[13px] text-paper-sage" aria-live="polite">
              What AgentOS can reach, and what it may do there
              {data ? ` · ${connected} connected` : ""}
              {isFetching && data ? " · Updating…" : ""}
            </p>
          </div>
          <PaperButton variant="quiet" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "size-3.5 motion-safe:animate-spin" : "size-3.5"} aria-hidden="true" />
            Refresh
          </PaperButton>
        </header>

        {isPending ? (
          <div aria-busy="true" aria-label="Reading connectors" className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-40 rounded-none border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
            ))}
          </div>
        ) : !data ? (
          <div role="alert" className="mt-10 rounded-none border border-paper-mist px-5 py-4">
            <p className="font-semibold text-paper-moss">Connectors couldn't be read.</p>
            <p className="mt-1 max-w-[72ch] text-[13.5px] leading-6 text-paper-char">{error?.message}</p>
            <PaperButton variant="amber" className="mt-4" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <>
            <PaperSection label="Connected" count={groups.setUp.length} className="mt-10">
              {groups.setUp.length === 0 ? (
                <p className="text-[14px] text-paper-sage">Nothing is set up yet. Start with a core connector below.</p>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {groups.setUp.map((connector) => (
                    <li key={connector.id}>
                      <ConnectorCard connector={connector} />
                    </li>
                  ))}
                </ul>
              )}
            </PaperSection>

            {data.recommendations.length > 0 ? (
              <PaperSection label="Recommended" count={data.recommendations.length} className="mt-12">
                <ul className="grid gap-4 lg:grid-cols-2">
                  {data.recommendations.map((recommendation) => (
                    <li key={`${recommendation.connectorId}:${recommendation.projectSlug ?? ""}`}>
                      <RecommendationCard recommendation={recommendation} />
                    </li>
                  ))}
                </ul>
              </PaperSection>
            ) : null}

            <PaperSection label="Available" count={groups.available.length} className="mt-12">
              <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
                {groups.available.map((connector) => (
                  <AvailableRow key={connector.id} connector={connector} />
                ))}
              </ul>
            </PaperSection>
          </>
        )}
      </PaperStage>
    </AppShell>
  );
}

function StatusTag({ connector }: { connector: Pick<ConnectorSummary, "status"> }) {
  return (
    <Tag tone={statusTone(connector.status)} className="gap-1.5">
      <span aria-hidden="true">●</span>
      {statusLabel(connector.status)}
    </Tag>
  );
}

/**
 * One set-up connector. The name is the link and stretches over the card;
 * the switch sits above that layer so pressing it never navigates.
 */
function ConnectorCard({ connector }: { connector: ConnectorSummary }) {
  const setEnabled = useSetConnectorEnabled();
  const note = switchNote(connector);
  const locked = connector.enabledSource === "required";
  const pending = setEnabled.isPending && setEnabled.variables?.id === connector.id;

  return (
    <PaperCard className="relative flex h-full flex-col gap-3 p-5 transition-colors duration-150 focus-within:bg-paper-cream hover:bg-paper-cream">
      <div className="flex items-start justify-between gap-3">
        <ConnectorIcon icon={connector.icon} />
        <StatusTag connector={connector} />
      </div>

      <div className="min-w-0">
        <h3 className="font-paper-display text-[16px] font-bold tracking-[-0.01em] text-paper-moss">
          <Link
            to={`/connectors/${encodeURIComponent(connector.id)}`}
            className={cn("rounded-[2px] after:absolute after:inset-0 after:content-['']", PAPER_FOCUS)}
          >
            {connector.name}
          </Link>
        </h3>
        <p className="mt-0.5 truncate text-[12.5px] text-paper-sage">
          {connector.status === "error" ? (connector.statusDetail ?? "The last test failed.") : (connector.account ?? connector.description)}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-paper-stone pt-3">
        <span className="flex min-h-6 items-center text-[13px] font-medium text-paper-char" title={note}>
          {locked ? "Always on" : connector.enabled ? "Enabled" : "Disabled"}
        </span>
        {locked ? null : (
          <span className="relative z-10">
            <PaperSwitch
              checked={connector.enabled}
              disabled={pending}
              label={`${connector.enabled ? "Disable" : "Enable"} ${connector.name} for AgentOS`}
              onChange={(enabled) => setEnabled.mutate({ id: connector.id, enabled })}
            />
          </span>
        )}
      </div>
      <p className="text-[12px] text-paper-sage tabular-nums">
        {connector.implementedCount} of {connector.capabilityCount} capabilities built · used {formatWhen(connector.lastUsed).toLowerCase()}
      </p>
      {setEnabled.isError && setEnabled.variables?.id === connector.id ? (
        <p role="alert" className="text-[12.5px] text-paper-flame-deep">
          {setEnabled.error.message}
        </p>
      ) : null}
    </PaperCard>
  );
}

function RecommendationCard({ recommendation }: { recommendation: ConnectorRecommendation }) {
  return (
    <PaperCard className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <ConnectorIcon icon={recommendation.icon} size="sm" />
        <div className="min-w-0">
          {recommendation.projectName ? (
            <p className="font-paper-utility text-[12px] font-medium tracking-[0.1em] text-paper-sage uppercase">
              For {recommendation.projectName}
            </p>
          ) : null}
          <h3 className="font-paper-display text-[15.5px] font-bold tracking-[-0.01em] text-paper-moss">{recommendation.connectorName}</h3>
        </div>
      </div>
      <div className="text-[13.5px] leading-[1.55] text-paper-char">
        <p className="text-[12px] font-semibold text-paper-moss">Why</p>
        <p className="mt-0.5">{recommendation.why}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3">
        {recommendation.status === "unavailable" ? <span className="text-[12px] text-paper-sage">No adapter yet</span> : <span />}
        <Link
          to={`/connectors/${encodeURIComponent(recommendation.connectorId)}`}
          className={cn(
            "inline-flex min-h-8 items-center gap-1.5 rounded-none border-[1.5px] border-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase transition-colors duration-150 hover:bg-paper-linen",
            PAPER_FOCUS,
          )}
          aria-label={`Connect ${recommendation.connectorName}${recommendation.projectName ? ` for ${recommendation.projectName}` : ""}`}
        >
          Connect
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </PaperCard>
  );
}

function AvailableRow({ connector }: { connector: ConnectorSummary }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
      <ConnectorIcon icon={connector.icon} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-paper-moss">
          {connector.name}
          <span className="font-paper-utility text-[12px] font-medium tracking-[0.1em] text-paper-sage uppercase">{TIER_LABEL[connector.tier]}</span>
        </p>
        <p className="truncate text-[12.5px] text-paper-sage">
          {connector.status === "disconnected" ? (connector.statusDetail ?? connector.description) : connector.description}
        </p>
      </div>
      <StatusTag connector={connector} />
      <Link
        to={`/connectors/${encodeURIComponent(connector.id)}`}
        className={cn(
          "inline-flex min-h-8 items-center rounded-none px-3 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen",
          PAPER_FOCUS,
        )}
        aria-label={`${connector.status === "unavailable" ? "View" : "Connect"} ${connector.name}`}
      >
        {connector.status === "unavailable" ? "View" : "Connect"}
      </Link>
    </li>
  );
}
