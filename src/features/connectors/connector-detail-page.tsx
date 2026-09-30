import { AlertTriangle, ArrowLeft, Check, X } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ConnectorCapability, ConnectorDetail } from "@shared/connector-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS, PaperButton, PaperSection, PaperStage, PaperSwitch, SegmentedControl, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import {
  useConnector,
  useDisconnectConnector,
  useSetCapabilityPolicy,
  useSetConnectorEnabled,
  useTestConnector,
} from "@/lib/agentos/connectors";
import { cn } from "@/lib/utils";
import { ConnectorIcon } from "./connector-icon";
import { ConnectorSetupForm } from "./connector-setup-form";
import { DatabaseSetups } from "./database-setups";
import {
  capabilityCounts,
  formatWhen,
  POLICY_OPTIONS,
  policyNote,
  RISK_HINT,
  RISK_LABEL,
  statusLabel,
  statusTone,
  switchNote,
} from "./connectors-model";

/**
 * One connector: its account, its switch, every capability with its risk and
 * policy, what it was last used for, and how to set it up.
 *
 * Setup is a form (see `connector-setup-form.tsx`): keys go in, and never
 * come back — the server only ever sends names and done/not done.
 */
export function ConnectorDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const { data, isPending, isFetching, error, refetch } = useConnector(id);

  return (
    <AppShell navigationItems={navigationItems} pageId="connector" activeHref="/connectors" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <Link
          to="/connectors"
          className={cn("inline-flex items-center gap-1.5 rounded-[2px] text-[13px] font-medium text-paper-sage hover:text-paper-moss", PAPER_FOCUS)}
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Connectors
        </Link>

        {isPending ? (
          <div aria-busy="true" aria-label="Reading the connector" className="mt-6">
            <div className="h-8 w-48 rounded-none bg-paper-linen motion-safe:animate-pulse" />
            <div className="mt-6 h-40 rounded-none border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
          </div>
        ) : !data ? (
          <div className="mt-6">
            <h1 className="font-paper-display text-[21px] font-bold tracking-[-0.02em]">That connector couldn't be read.</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{error?.message ?? "Nothing was returned."}</p>
            <PaperButton variant="amber" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <Connector connector={data} />
        )}
      </PaperStage>
    </AppShell>
  );
}

function Connector({ connector }: { connector: ConnectorDetail }) {
  const setEnabled = useSetConnectorEnabled();
  const test = useTestConnector();
  const disconnect = useDisconnectConnector();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const counts = capabilityCounts(connector.capabilities);
  const note = switchNote(connector);
  const integrated = connector.status !== "unavailable";
  const actionError = test.error ?? disconnect.error ?? setEnabled.error;

  return (
    <article className="mt-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-paper-mist pb-6">
        <div className="flex min-w-0 items-start gap-4">
          <ConnectorIcon icon={connector.icon} size="lg" />
          <div className="min-w-0">
            <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss">{connector.name}</h1>
            <p className="mt-1 max-w-[64ch] text-[14px] leading-6 text-paper-char">{connector.description}</p>
          </div>
        </div>
        <Tag tone={statusTone(connector.status)} className="gap-1.5">
          <span aria-hidden="true">●</span>
          {statusLabel(connector.status)}
        </Tag>
      </header>

      <dl className="mt-6 grid gap-px overflow-hidden rounded-none border border-paper-mist bg-paper-mist sm:grid-cols-3">
        <div className="bg-paper-white px-5 py-4">
          <dt className="text-[12.5px] font-medium text-paper-sage">Account</dt>
          <dd className="mt-1 truncate text-[14px] font-semibold text-paper-moss">
            {connector.account ?? (connector.status === "connected" ? "Run a test to see it" : "—")}
          </dd>
        </div>
        <div className="bg-paper-white px-5 py-4">
          <dt className="text-[12.5px] font-medium text-paper-sage">Enabled for AgentOS</dt>
          <dd className="mt-1 flex items-center gap-3">
            {connector.enabledSource === "required" || !integrated ? (
              <span className="text-[14px] font-semibold text-paper-moss">{integrated ? "Always on" : "—"}</span>
            ) : (
              <PaperSwitch
                checked={connector.enabled}
                disabled={setEnabled.isPending}
                label={`${connector.enabled ? "Disable" : "Enable"} ${connector.name} for AgentOS`}
                onChange={(enabled) => setEnabled.mutate({ id: connector.id, enabled })}
              />
            )}
            {note ? <span className="text-[12.5px] leading-5 text-paper-sage">{note}</span> : null}
          </dd>
        </div>
        <div className="bg-paper-white px-5 py-4">
          <dt className="text-[12.5px] font-medium text-paper-sage">Last test</dt>
          <dd className="mt-1 text-[13.5px] leading-5 text-paper-moss">
            {connector.lastHealthCheck ? (
              <>
                <span className={cn("font-semibold", connector.lastHealthCheck.ok ? "text-paper-moss" : "text-paper-flame-deep")}>
                  {connector.lastHealthCheck.ok ? "Passed" : "Failed"} · {formatWhen(connector.lastHealthCheck.checkedAt)}
                </span>
                <span className="block text-[12.5px] text-paper-char">{connector.lastHealthCheck.detail}</span>
              </>
            ) : (
              "Not tested yet"
            )}
          </dd>
        </div>
      </dl>

      {integrated ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PaperButton
            variant="amber"
            disabled={test.isPending || !connector.enabled || connector.status === "disconnected"}
            onClick={() => test.mutate(connector.id)}
            title={!connector.enabled ? "Turn it on to test it" : connector.status === "disconnected" ? "Set it up first" : undefined}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </PaperButton>
          {connector.connectUrl ? (
            // A real navigation: it hands the browser to the provider's own consent screen.
            <a
              href={connector.connectUrl}
              className={cn(
                "inline-flex min-h-8 items-center rounded-none border-[1.5px] border-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen",
                PAPER_FOCUS,
              )}
            >
              Connect
            </a>
          ) : null}
          {connector.canDisconnect ? (
            confirmingDisconnect ? (
              <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm disconnect">
                <span className="text-[13px] text-paper-char">Disconnect {connector.name}? You'll need to sign in again.</span>
                <PaperButton
                  variant="danger"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(connector.id, { onSettled: () => setConfirmingDisconnect(false) })}
                >
                  {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
                </PaperButton>
                <PaperButton variant="quiet" onClick={() => setConfirmingDisconnect(false)}>
                  Cancel
                </PaperButton>
              </span>
            ) : (
              <PaperButton variant="danger" onClick={() => setConfirmingDisconnect(true)}>
                Disconnect
              </PaperButton>
            )
          ) : null}
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {actionError.message}
        </p>
      ) : null}

      {connector.id === "supabase" ? (
        <PaperSection label="Databases" className="mt-10">
          <DatabaseSetups />
        </PaperSection>
      ) : null}

      <PaperSection
        label="Capabilities"
        count={connector.capabilities.length}
        className="mt-10"
        action={
          <span className="text-[12.5px] text-paper-sage tabular-nums">
            {counts.built} built · {counts.approval} need approval · {counts.disabled} off
          </span>
        }
      >
        <p className="mb-4 max-w-[76ch] text-[13px] leading-5 text-paper-char">
          <strong className="font-semibold">Approval</strong> holds an agent back until a person confirms; pressing the button in AgentOS is that
          confirmation. <strong className="font-semibold">Off</strong> refuses everyone. A policy can be set before AgentOS has the code for it, and
          holds when the code lands.
        </p>
        <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
          {connector.capabilities.map((capability) => (
            <CapabilityRow key={capability.id} connectorId={connector.id} capability={capability} />
          ))}
        </ul>
      </PaperSection>

      <PaperSection label="Last used" className="mt-10">
        {connector.recentUses.length === 0 ? (
          <p className="text-[14px] text-paper-sage">
            {connector.lastUsed ? `Read ${formatWhen(connector.lastUsed)}. No actions recorded yet.` : "AgentOS hasn't used it yet."}
          </p>
        ) : (
          <ol className="divide-y divide-paper-stone rounded-none border border-paper-mist">
            {connector.recentUses.map((use) => (
              <li key={`${use.at}:${use.capabilityId}`} className="grid grid-cols-[5.5rem_1fr] gap-3 px-4 py-3 text-[13.5px]">
                <time dateTime={use.at} className="font-mono text-[12.5px] text-paper-sage tabular-nums">
                  {formatWhen(use.at)}
                </time>
                <span className="min-w-0">
                  <span className="font-semibold text-paper-moss">{use.capabilityName}</span>
                  {use.detail ? <span className="block truncate text-paper-char">{use.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </PaperSection>

      <PaperSection label="Setup" className="mt-10">
        <ConnectorSetupForm connector={connector} />
      </PaperSection>
    </article>
  );
}

const MARK = {
  allowed: { Icon: Check, className: "text-paper-green", label: "Allowed" },
  approval: { Icon: AlertTriangle, className: "text-paper-moss", label: "Requires approval" },
  disabled: { Icon: X, className: "text-paper-flame-deep", label: "Disabled" },
} as const;

function CapabilityRow({ connectorId, capability }: { connectorId: string; capability: ConnectorCapability }) {
  const setPolicy = useSetCapabilityPolicy();
  const mark = MARK[capability.policy];
  const note = policyNote(capability);

  return (
    <li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <mark.Icon className={cn("mt-0.5 size-4 shrink-0", mark.className)} aria-label={mark.label} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-paper-moss">
            {capability.name}
            <span title={RISK_HINT[capability.risk]}>
              <Tag tone={capability.risk === "destructive" ? "flame" : capability.risk === "read" ? "muted" : "blue"}>{RISK_LABEL[capability.risk]}</Tag>
            </span>
            {!capability.implemented ? <Tag tone="muted">Not built</Tag> : null}
          </p>
          <p className="mt-0.5 text-[12.5px] text-paper-sage">
            <code className="font-mono text-[11.5px]">{capability.id}</code>
            {note ? ` · ${note}` : ""}
            {capability.implemented && capability.unavailableReason ? ` · ${capability.unavailableReason}` : ""}
          </p>
          {setPolicy.isError ? (
            <p role="alert" className="mt-1 text-[12.5px] text-paper-flame-deep">
              {setPolicy.error.message}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-7 md:pl-0">
        {capability.policyOverridden ? (
          <PaperButton
            variant="quiet"
            className="min-h-7 px-2 text-[11.5px]"
            disabled={setPolicy.isPending}
            onClick={() => setPolicy.mutate({ id: connectorId, capabilityId: capability.id, policy: null })}
            title={`Back to the default: ${capability.defaultPolicy}`}
          >
            Reset
          </PaperButton>
        ) : null}
        <SegmentedControl
          label={`Policy for ${capability.name}`}
          options={POLICY_OPTIONS}
          value={capability.policy}
          onChange={(policy) => {
            if (policy !== capability.policy) setPolicy.mutate({ id: connectorId, capabilityId: capability.id, policy });
          }}
        />
      </div>
    </li>
  );
}
