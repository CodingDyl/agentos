import { useId, useState, type ReactNode } from "react";
import type { AiStackEntry, AiStatus } from "@shared/ai-stack-types";
import type { OperationsData } from "@shared/usage-types";
import { useAiStack, useSetAiEnabled, useSetAiModel } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { EVIDENCE_LABELS, monthlyPrice, STATUS_LABELS, subscriptionsFor, summarise } from "./ai-stack-model";
import { Figure } from "./figures";
import { formatCost, formatTokens } from "./operations-model";
import { PAPER_INPUT, PaperCard, PaperSection, PaperSwitch, Tag } from "@/components/paper";

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
  claude: "No new coding jobs can go to the Claude API while this is off.",
  grok: "No new coding jobs can go to Grok while this is off.",
  "claude-code": "Off until you switch it on. On, AgentOS can send coding jobs here, and they count against your Claude plan.",
  codex: "Off until you switch it on. On, AgentOS can send coding jobs here, and they count against your ChatGPT plan.",
  gemini: "Off until you switch it on. On, AgentOS can send coding jobs here, and they count against your Google plan.",
  "hermes-worker": "Off until you switch it on. On, Hermes can take coding jobs as well as orchestrate them.",
  hermes: "Task scoping, milestone planning, routing and reviews stop or fall back while this is off.",
  jev: "Mail still syncs, but new threads are not classified while this is off.",
};

const DOT: Record<AiStatus, string> = {
  live: "bg-paper-green",
  off: "bg-paper-ash",
  unavailable: "bg-paper-flame",
  "not-integrated": "bg-paper-mist",
};

const STATUS_TEXT: Record<AiStatus, string> = {
  live: "text-paper-moss",
  off: "text-paper-sage",
  // The flame dot carries the alarm; flame text on white fails contrast.
  unavailable: "text-paper-moss",
  "not-integrated": "text-paper-sage",
};

export function AiStackTab({ data }: { data: OperationsData }) {
  const stack = useAiStack();
  const toggle = useSetAiEnabled();
  const setModel = useSetAiModel();

  if (stack.isPending) {
    return <p className="text-[14px] leading-6 text-paper-sage">Looking for AIs on this machine…</p>;
  }

  if (!stack.data) {
    return <p className="text-[14px] leading-6 text-paper-char">{stack.error?.message ?? "The AI stack could not be read."}</p>;
  }

  const entries = stack.data.entries;
  const connected = entries.filter((entry) => entry.toggleable);
  const elsewhere = entries.filter((entry) => !entry.toggleable);
  const counts = summarise(entries);

  // The page's own figures already cover AgentOS spend; the new figure here is
  // what ran *outside* AgentOS, which nothing else on the screen can show.
  const localTokens = entries.reduce((sum, entry) => sum + (entry.localUsage?.total ?? 0), 0);
  const localSources = entries.filter((entry) => entry.localUsage).map((entry) => entry.name);

  return (
    <div className="space-y-12">
      <div className="grid grid-cols-2 gap-x-10 gap-y-6 lg:grid-cols-3">
        <Figure
          value={{ text: `${counts.live} of ${connected.length}`, measurement: "exact" }}
          label="Live in AgentOS"
          detail={counts.off + counts.unavailable > 0 ? `${counts.off} off · ${counts.unavailable} unavailable` : "Everything connected is running"}
        />
        <Figure value={{ text: String(counts.detected), measurement: "exact" }} label="Found on this machine" detail={`${counts.notConnected} not connected to AgentOS`} />
        <Figure
          value={{ text: localTokens > 0 ? formatTokens(localTokens) : "-", measurement: localTokens > 0 ? "exact" : "unknown" }}
          label="Tokens outside AgentOS"
          detail={localSources.length > 0 ? `${localSources.join(", ")} · ${stack.data.windowLabel}` : "No local logs found"}
        />
      </div>

      {toggle.error || setModel.error ? (
        <p role="alert" className="-mt-6 text-[13px] leading-5 text-paper-moss">
          {(toggle.error ?? setModel.error)?.message}
        </p>
      ) : null}

      <PaperSection label="Connected to AgentOS" count={connected.length}>
        <div className="grid gap-3 lg:grid-cols-2">
          {connected.map((entry) => (
            <AiCard
              key={entry.id}
              entry={entry}
              data={data}
              switching={toggle.isPending && toggle.variables?.id === entry.id}
              onToggle={(enabled) => toggle.mutate({ id: entry.id, enabled })}
              savingModel={setModel.isPending && setModel.variables?.id === entry.id}
              onModel={(model) => setModel.mutate({ id: entry.id, model })}
            />
          ))}
        </div>
      </PaperSection>

      {elsewhere.length > 0 ? (
        <PaperSection label="On this machine" count={elsewhere.length}>
          <p className="-mt-1 mb-4 max-w-[68ch] text-[14px] leading-6 text-paper-char">
            Found here, but AgentOS can't hand them work, so there is nothing to switch on. Each card says why.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {elsewhere.map((entry) => (
              <AiCard key={entry.id} entry={entry} data={data} />
            ))}
          </div>
        </PaperSection>
      ) : null}

      <p className="max-w-[80ch] border-t border-paper-stone pt-5 text-[12.5px] leading-5 text-paper-sage">
        Detection only looks: CLIs on the PATH, apps in /Applications, config folders, key names in .env (never their values), and local model servers on
        127.0.0.1. Local usage is read from Claude Code and Codex logs: token counts and model names only, never conversation content.
      </p>
    </div>
  );
}

function AiCard({
  entry,
  data,
  switching = false,
  onToggle,
  savingModel = false,
  onModel,
}: {
  entry: AiStackEntry;
  data: OperationsData;
  switching?: boolean;
  onToggle?: (enabled: boolean) => void;
  savingModel?: boolean;
  onModel?: (model: string) => void;
}) {
  const agent = entry.ledgerAgent ? data.agents.find((row) => row.agent === entry.ledgerAgent) : undefined;
  const plans = subscriptionsFor(entry, data.subscriptions);
  const local = entry.localUsage;

  return (
    <PaperCard className={cn("flex h-full min-w-0 flex-col", entry.status === "not-integrated" && "bg-paper-cream")}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h3 className="font-paper-display text-[19px] leading-7 font-bold tracking-[-0.02em] text-paper-moss">{entry.name}</h3>
            <span className="text-[12.5px] text-paper-sage">{entry.vendor}</span>
          </div>

          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] leading-5">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[entry.status])} aria-hidden="true" />
            <span className={cn("font-medium", STATUS_TEXT[entry.status])}>{STATUS_LABELS[entry.status]}</span>
            {entry.statusReason ? <span className="truncate text-paper-sage">· {entry.statusReason}</span> : null}
          </p>
        </div>

        {entry.toggleable && onToggle ? (
          <PaperSwitch checked={entry.enabled} disabled={switching} label={`${entry.enabled ? "Switch off" : "Switch on"} ${entry.name}`} onChange={onToggle} />
        ) : null}
      </header>

      {entry.integration ? <p className="mt-3 text-[14px] leading-5 text-paper-char">{entry.integration}</p> : null}

      {entry.connectHint ? (
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-paper-char">
          <Tag tone="muted" className="mt-px shrink-0">
            Can't connect
          </Tag>
          <span>{entry.connectHint}</span>
        </p>
      ) : null}

      {entry.toggleable && !entry.enabled && OFF_CONSEQUENCE[entry.id] ? (
        <p className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-paper-char">
          <Tag tone="marigold" className="mt-px shrink-0">
            Off
          </Tag>
          {OFF_CONSEQUENCE[entry.id]}
        </p>
      ) : null}

      <dl className="mt-4 space-y-2 border-t border-paper-stone pt-3.5 text-[13.5px] leading-5">
        {entry.configurableModel && onModel ? (
          <ModelField key={entry.model ?? ""} entry={entry} saving={savingModel} onSave={onModel} />
        ) : null}

        {entry.facts?.map((fact) => (
          <Readout key={fact.label} label={fact.label}>
            {fact.value}
          </Readout>
        ))}

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
              <span className="text-paper-sage">Nothing run in this window</span>
            )}
          </Readout>
        ) : null}

        {local ? (
          <Readout label="On this machine" title={local.byModel.slice(0, 4).map((row) => `${row.model}: ${formatTokens(row.total)}`).join("\n")}>
            {formatTokens(local.total)} tokens
            <span className="text-paper-sage"> ({formatTokens(local.cachedInput)} cached)</span>
            <Sep />
            {local.sessions} {local.sessions === 1 ? "session" : "sessions"}
            {local.byModel[0] ? (
              <span className="block text-[12.5px] text-paper-sage">
                Mostly {local.byModel[0].model} · {local.source}
              </span>
            ) : null}
          </Readout>
        ) : null}

        <Readout label="Plan">
          {plans.length > 0 ? (
            plans.map((plan, index) => (
              <span key={plan.id}>
                {index > 0 ? <Sep /> : null}
                {plan.name}
                {monthlyPrice(plan) !== undefined ? <span className="text-paper-sage"> · {formatCost(monthlyPrice(plan))}/mo</span> : null}
              </span>
            ))
          ) : (
            <span className="text-paper-sage">None recorded</span>
          )}
        </Readout>
      </dl>

      {entry.evidence.length > 0 ? (
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-4">
          {entry.evidence.map((evidence) => (
            <li
              key={`${evidence.kind}-${evidence.label}`}
              title={evidence.detail}
              className="inline-flex items-center gap-1.5 rounded-full bg-paper-linen px-2 py-px text-[12px] leading-[18px] text-paper-char"
            >
              <span className="font-medium text-paper-moss">{EVIDENCE_LABELS[evidence.kind]}</span>
              {evidence.kind === "config" ? evidence.detail : evidence.label.replace(/ (CLI|app)$/, "")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-auto pt-4 text-[12.5px] leading-5 text-paper-sage">Not found on this machine.</p>
      )}
    </PaperCard>
  );
}

/**
 * Which model a worker runs. Saved on Enter or when focus leaves, so there is
 * no separate button to miss; empty means the tool's own default.
 */
function ModelField({ entry, saving, onSave }: { entry: AiStackEntry; saving: boolean; onSave: (model: string) => void }) {
  const id = useId();
  const saved = entry.model ?? "";
  const [draft, setDraft] = useState(saved);
  const dirty = draft.trim() !== saved;

  const commit = () => {
    if (dirty) onSave(draft.trim());
  };

  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-4">
      <dt>
        <label htmlFor={id} className="block pt-1.5 text-[12.5px] font-medium text-paper-sage">
          Model
        </label>
      </dt>
      <dd className="min-w-0">
        <input
          id={id}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          maxLength={120}
          placeholder={entry.modelPlaceholder ? `e.g. ${entry.modelPlaceholder}` : "Tool default"}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(saved);
              event.currentTarget.blur();
            }
          }}
          className={cn(PAPER_INPUT, "w-full max-w-[22rem] font-mono text-[13px]")}
        />
        <p id={`${id}-hint`} aria-live="polite" className="mt-1 text-[12px] leading-4 text-paper-sage">
          {saving ? "Saving…" : dirty ? "Enter to save · Esc to undo" : saved ? "Used for every job this worker runs" : "Empty uses the tool's own default"}
        </p>
      </dd>
    </div>
  );
}

function Readout({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4" title={title}>
      <dt className="text-[12.5px] font-medium text-paper-sage">{label}</dt>
      <dd className="min-w-0 text-paper-moss tabular-nums">{children}</dd>
    </div>
  );
}

function Sep() {
  return <span className="text-paper-ash"> · </span>;
}
