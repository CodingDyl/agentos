import type { ReactNode } from "react";
import type { AiStackEntry } from "@shared/ai-stack-types";
import type { OperationsData } from "@shared/usage-types";
import { EmptyState, Section } from "@/components/os";
import { useAiStack, useSetAiEnabled } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  EVIDENCE_LABELS,
  monthlyPrice,
  STATUS_DOT,
  STATUS_LABELS,
  subscriptionsFor,
  summarise,
} from "./ai-stack-model";
import { Figure } from "./figures";
import { formatCost, formatTokens } from "./operations-model";

/**
 * The AI stack: every AI on this machine, and which of them AgentOS uses.
 *
 * Two lists, never merged. *Connected* AIs are ones AgentOS actually calls —
 * each has a switch, and the switch is real: a switched-off worker is refused
 * by routing and by the job manager, a switched-off Hermes stops every Hermes
 * request. *On this machine* AIs were found here, but AgentOS has no way to
 * use them yet, so they get no switch — offering one would imply a control
 * that does not exist.
 *
 * Usage comes from two places and says which. AgentOS's own ledger covers what
 * AgentOS ran; a tool's local logs cover what you ran yourself. Local usage is
 * tokens only: without a confirmed price per model, a dollar figure there
 * would be a guess sitting next to real ones.
 */

/** What switching each integration off actually stops, said before it is flipped back. */
const OFF_CONSEQUENCE: Record<string, string> = {
  claude: "No new coding jobs can go to Claude while this is off.",
  grok: "No new coding jobs can go to Grok while this is off.",
  hermes: "Task scoping, milestone planning, routing and reviews stop or fall back while this is off.",
  jev: "Mail still syncs, but new threads are not classified while this is off.",
};

export function AiStackTab({ data }: { data: OperationsData }) {
  const stack = useAiStack();
  const toggle = useSetAiEnabled();

  if (stack.isPending) {
    return <p className="text-[15px] leading-6 text-os-muted">Looking for AIs on this machine…</p>;
  }

  if (!stack.data) {
    return <EmptyState label="AI stack unavailable" description={stack.error?.message ?? "The AI stack could not be read."} />;
  }

  const entries = stack.data.entries;
  const connected = entries.filter((entry) => entry.toggleable);
  const elsewhere = entries.filter((entry) => !entry.toggleable);
  const counts = summarise(entries);

  // The page header already shows AgentOS's own spend; the new figure here is
  // what ran *outside* AgentOS, which nothing else on the screen can show.
  const localTokens = entries.reduce((sum, entry) => sum + (entry.localUsage?.total ?? 0), 0);
  const localSources = entries.filter((entry) => entry.localUsage).map((entry) => entry.name);

  const plansPerMonth = data.subscriptions
    .filter((subscription) => subscription.active && subscription.type === "subscription")
    .reduce((sum, subscription) => sum + (monthlyPrice(subscription) ?? 0), 0);

  return (
    <div className="space-y-14">
      <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          value={{ text: `${counts.live} / ${connected.length}`, measurement: "exact" }}
          label="Live in AgentOS"
          detail={counts.off + counts.unavailable > 0 ? `${counts.off} off · ${counts.unavailable} unavailable` : "Everything connected is running"}
        />
        <Figure
          value={{ text: String(counts.detected), measurement: "exact" }}
          label="Found on this machine"
          detail={`${counts.notConnected} not connected to AgentOS`}
        />
        <Figure
          value={{ text: localTokens > 0 ? formatTokens(localTokens) : "—", measurement: localTokens > 0 ? "exact" : "unknown" }}
          label="Tokens outside AgentOS"
          detail={localSources.length > 0 ? `${localSources.join(", ")} · ${stack.data.windowLabel}` : "No local logs found"}
        />
        <Figure
          value={{ text: formatCost(plansPerMonth), measurement: plansPerMonth > 0 ? "exact" : "unknown" }}
          label="Plans / month"
          detail={plansPerMonth > 0 ? "Active subscriptions, recorded under Cost" : "Record your plans under Cost"}
        />
      </div>

      {toggle.error ? <p className="-mt-6 text-[13px] leading-5 text-os-danger">{toggle.error.message}</p> : null}

      <Section
        label="Connected to AgentOS"
        action={<span className="os-meta text-os-subtle tabular-nums">{connected.length}</span>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {connected.map((entry) => (
            <AiCard
              key={entry.id}
              entry={entry}
              data={data}
              switching={toggle.isPending && toggle.variables?.id === entry.id}
              onToggle={(enabled) => toggle.mutate({ id: entry.id, enabled })}
            />
          ))}
        </div>
      </Section>

      {elsewhere.length > 0 ? (
        <Section
          label="On this machine"
          action={<span className="os-meta text-os-subtle tabular-nums">{elsewhere.length}</span>}
        >
          <p className="-mt-1 mb-5 max-w-[68ch] text-[14px] leading-5 text-os-subtle">
            Found here, but AgentOS has no integration with them yet — so there is nothing to switch on.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {elsewhere.map((entry) => (
              <AiCard key={entry.id} entry={entry} data={data} />
            ))}
          </div>
        </Section>
      ) : null}

      <p className="max-w-[80ch] border-t border-os-border pt-6 text-[13px] leading-5 text-os-subtle">
        Detection only looks: CLIs on the PATH, apps in /Applications, config folders, key names in .env (never their values), and local model
        servers on 127.0.0.1. Local usage is read from Claude Code and Codex logs — token counts and model names only, never conversation content.
      </p>
    </div>
  );
}

function AiCard({
  entry,
  data,
  switching = false,
  onToggle,
}: {
  entry: AiStackEntry;
  data: OperationsData;
  switching?: boolean;
  onToggle?: (enabled: boolean) => void;
}) {
  const agent = entry.ledgerAgent ? data.agents.find((row) => row.agent === entry.ledgerAgent) : undefined;
  const plans = subscriptionsFor(entry, data.subscriptions);
  const local = entry.localUsage;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-os-surface p-5 transition-colors duration-150",
        entry.status === "live" ? "border-os-border-strong" : "border-os-border",
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className={cn("text-[20px] leading-7 tracking-[-0.01em]", entry.status === "live" ? "text-foreground" : "text-os-muted")}>
              {entry.name}
            </h3>
            <span className="os-meta text-os-subtle">{entry.vendor}</span>
          </div>

          <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] leading-5">
            <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[entry.status])} aria-hidden="true" />
            <span className={entry.status === "live" ? "text-os-success" : entry.status === "unavailable" ? "text-os-warning" : "text-os-muted"}>
              {STATUS_LABELS[entry.status]}
            </span>
            {entry.statusReason ? <span className="truncate text-os-subtle">· {entry.statusReason}</span> : null}
          </p>
        </div>

        {entry.toggleable && onToggle ? (
          <Switch
            checked={entry.enabled}
            disabled={switching}
            label={`${entry.enabled ? "Switch off" : "Switch on"} ${entry.name}`}
            onChange={onToggle}
          />
        ) : null}
      </header>

      {entry.integration ? <p className="mt-3 text-[14px] leading-5 text-os-muted">{entry.integration}</p> : null}

      {entry.toggleable && !entry.enabled && OFF_CONSEQUENCE[entry.id] ? (
        <p className="mt-2 text-[13px] leading-5 text-os-warning">{OFF_CONSEQUENCE[entry.id]}</p>
      ) : null}

      <dl className="mt-5 space-y-2.5 border-t border-os-border pt-4 text-[14px] leading-5">
        {entry.ledgerAgent ? (
          <Readout label="In AgentOS">
            {agent && agent.total.records > 0 ? (
              <>
                {formatTokens(agent.total.tokens)} tokens
                <Sep />
                {formatCost(agent.total.costUsd)}
                <Sep />
                {agent.runs} {agent.runs === 1 ? "run" : "runs"}
              </>
            ) : (
              <span className="text-os-subtle">Nothing run this month</span>
            )}
          </Readout>
        ) : null}

        {local ? (
          <Readout label="On this machine" title={local.byModel.slice(0, 4).map((row) => `${row.model}: ${formatTokens(row.total)}`).join("\n")}>
            {formatTokens(local.total)} tokens
            <span className="text-os-subtle"> ({formatTokens(local.cachedInput)} cached)</span>
            <Sep />
            {local.sessions} {local.sessions === 1 ? "session" : "sessions"}
            {local.byModel[0] ? <span className="block text-[12.5px] text-os-subtle">Mostly {local.byModel[0].model} · {local.source}</span> : null}
          </Readout>
        ) : null}

        <Readout label="Plan">
          {plans.length > 0 ? (
            plans.map((plan, index) => (
              <span key={plan.id}>
                {index > 0 ? <Sep /> : null}
                {plan.name}
                {monthlyPrice(plan) !== undefined ? <span className="text-os-subtle"> · {formatCost(monthlyPrice(plan))}/mo</span> : null}
              </span>
            ))
          ) : (
            <span className="text-os-subtle">None recorded</span>
          )}
        </Readout>
      </dl>

      {entry.evidence.length > 0 ? (
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-4">
          {entry.evidence.map((evidence) => (
            <li
              key={`${evidence.kind}-${evidence.label}`}
              title={evidence.detail}
              className="os-meta inline-flex items-center gap-1.5 rounded-sm border border-os-border px-2 py-0.5 text-os-subtle"
            >
              <span className="text-os-muted">{EVIDENCE_LABELS[evidence.kind]}</span>
              {/* Paths and key names keep their real case; the label style would shout them. */}
              <span className="normal-case">
                {evidence.kind === "config" ? evidence.detail : evidence.label.replace(/ (CLI|app)$/, "")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-auto pt-4 text-[13px] leading-5 text-os-subtle">Not found on this machine.</p>
      )}
    </article>
  );
}

function Readout({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4" title={title}>
      <dt className="os-meta pt-0.5 text-os-subtle">{label}</dt>
      <dd className="min-w-0 tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Sep() {
  return <span className="text-os-subtle"> · </span>;
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "os-focus-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 disabled:cursor-wait disabled:opacity-60",
        checked ? "border-os-success/60 bg-os-success/15" : "border-os-border bg-transparent",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-4 rounded-full transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-[22px] bg-os-success" : "translate-x-[3px] bg-os-subtle",
        )}
      />
    </button>
  );
}
