import { useMemo, useState } from "react";
import {
  defaultOllamaModelConfig,
  type OllamaModelConfig,
  type OllamaSettings,
  type ProbeRecord,
} from "@shared/route-policy-types";
import { CommandButton, FilterBar, HairlineCard, SectionLabel, StatusPill } from "@/components/os";
import { formatRelativeTime } from "@/lib/format";
import { useOllamaStatus, useProbeOllamaModel, useSaveOllamaSettings } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  enableWarning,
  formatMs,
  modelConfigProblem,
  probeBadge,
  shortDigest,
  TASK_CATEGORIES,
  toggleCategory,
} from "./route-policy-model";

/**
 * Local models. Discovery shows what Ollama has installed; nothing becomes
 * routable until it is enabled here with its categories and limits. Installed
 * does not prove suitable, so nothing is enabled by default and embedding-only
 * models cannot be enabled at all. Models stay under Ollama's management:
 * AgentOS never downloads, copies or deletes them.
 */

const CHECKBOX = "os-focus-ring mt-0.5 size-3.5 shrink-0 cursor-pointer accent-os-amber";
const NUMBER_INPUT =
  "os-focus-ring mt-2 min-h-9 w-32 rounded-md border border-os-border bg-transparent px-3 font-mono text-[13px] tabular-nums text-foreground";

interface ModelRow {
  name: string;
  digest?: string;
  installed: boolean;
  loaded: boolean;
  embeddingOnly: boolean;
  config: OllamaModelConfig;
}

export function OllamaPanel() {
  const status = useOllamaStatus();
  const save = useSaveOllamaSettings();
  const probe = useProbeOllamaModel();
  // Edits sit over the server's settings until saved or discarded, so there is
  // no copy to keep in step with it.
  const [edits, setDraft] = useState<OllamaSettings>();
  const [open, setOpen] = useState<string>();
  const draft = edits ?? status.data?.settings;

  const rows: ModelRow[] = useMemo(() => {
    if (!status.data || !draft) return [];
    const options = new Map(status.data.options.map((option) => [option.modelId, option]));
    const installed = new Map(status.data.state.installed.map((model) => [model.name, model]));
    const names = new Set([...installed.keys(), ...Object.keys(draft.models)]);

    return [...names].sort().map((name) => ({
      name,
      digest: installed.get(name)?.digest,
      installed: installed.has(name),
      loaded: status.data.state.loaded.includes(name),
      // From the server's flag, else from what Ollama reports: a model with no
      // "completion" capability cannot generate, so it is never testable or enableable.
      embeddingOnly:
        options.get(name)?.embeddingOnly ??
        (installed.get(name)?.capabilities ? !installed.get(name)?.capabilities?.includes("completion") : false),
      config: draft.models[name] ?? defaultOllamaModelConfig(),
    }));
  }, [status.data, draft]);

  if (status.isPending) {
    return <p className="os-meta text-os-subtle">Checking Ollama…</p>;
  }
  if (!status.data || !draft) {
    return (
      <p className="text-[13px] leading-5 text-os-danger">
        Could not read Ollama status. {status.error?.message}
      </p>
    );
  }

  const { state } = status.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(status.data.settings);

  const problems = rows
    .filter((row) => draft.models[row.name])
    .map((row) => ({ name: row.name, message: modelConfigProblem(row.config) }))
    .filter((entry): entry is { name: string; message: string } => Boolean(entry.message));

  const setModel = (name: string, next: OllamaModelConfig) =>
    setDraft({ ...draft, models: { ...draft.models, [name]: next } });

  return (
    <HairlineCard>
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Connection</SectionLabel>
            <p className="mt-2 font-mono text-[13px] leading-5 text-os-muted">{draft.baseUrl}</p>
          </div>
          <StatusPill
            status={state.reachable ? "healthy" : "paused"}
            label={state.reachable ? "Connected" : "Not reachable"}
          />
        </div>
        {!state.reachable ? (
          <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
            {state.unreachableReason} Other workers are unaffected. Tasks marked local-only wait for Ollama and are never sent
            to the cloud.
          </p>
        ) : null}

        <div className="mt-6 border-t border-os-border pt-5">
          <SectionLabel>Models</SectionLabel>
          {rows.length === 0 ? (
            <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
              {state.reachable
                ? "Ollama has no models installed. Install one with Ollama (AgentOS does not download models), for example qwen3:4b."
                : "Models appear here once Ollama is running."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-os-border">
              {rows.map((row) => (
                <ModelItem
                  key={row.name}
                  row={row}
                  expanded={open === row.name}
                  onToggle={() => setOpen(open === row.name ? undefined : row.name)}
                  onChange={(next) => setModel(row.name, next)}
                  record={status.data.probes?.[row.name]}
                  canTest={state.reachable && row.installed}
                  testing={probe.isPending && probe.variables?.model === row.name}
                  testingAny={probe.isPending}
                  testError={probe.isError && probe.variables?.model === row.name ? probe.error.message : undefined}
                  onTest={() => probe.mutate({ model: row.name, config: row.config })}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 grid gap-6 border-t border-os-border pt-5 sm:grid-cols-2">
          <label className="block">
            <SectionLabel>Concurrent local jobs</SectionLabel>
            <input
              type="number"
              min={1}
              value={draft.maxConcurrent}
              onChange={(event) => setDraft({ ...draft, maxConcurrent: Math.max(1, Number(event.target.value) || 1) })}
              className={NUMBER_INPUT}
            />
            <span className="os-meta mt-2 block text-os-subtle">One is the safe default for a laptop</span>
          </label>

          <div>
            <SectionLabel>If a local model fails</SectionLabel>
            <FilterBar<"none" | "cloud">
              label="Fallback policy"
              className="mt-3"
              value={draft.fallback}
              onChange={(fallback) => setDraft({ ...draft, fallback })}
              options={[
                { value: "none", label: "Fail" },
                { value: "cloud", label: "Try a cloud worker" },
              ]}
            />
            <span className="os-meta mt-2 block text-os-subtle">
              One fallback at most. Local-only tasks never use the cloud, whatever this says
            </span>
          </div>
        </div>

        <p className="mt-6 max-w-[62ch] text-[12px] leading-5 text-os-subtle">
          Limits are conservative starting policies, not measured hardware guarantees. Loading a model from disk counts toward
          the timeout, so the first run after a cold start is the slowest.
        </p>

        {problems.map((problem) => (
          <p key={problem.name} className="mt-2 text-[13px] leading-5 text-os-danger">
            {problem.name}: {problem.message}
          </p>
        ))}
        {save.isError ? (
          <p className="mt-2 text-[13px] leading-5 text-os-danger">{save.error.message}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <CommandButton
            variant="primary"
            disabled={!dirty || problems.length > 0 || save.isPending}
            loading={save.isPending}
            loadingLabel="Saving"
            onClick={() =>
              save.mutate(draft, { onSuccess: () => setDraft(undefined) })
            }
          >
            Save
          </CommandButton>
          {dirty ? (
            <CommandButton variant="quiet" onClick={() => setDraft(undefined)}>
              Discard changes
            </CommandButton>
          ) : null}
        </div>
      </div>
    </HairlineCard>
  );
}

function ModelItem({
  row,
  expanded,
  onToggle,
  onChange,
  record,
  canTest,
  testing,
  testingAny,
  testError,
  onTest,
}: {
  row: ModelRow;
  expanded: boolean;
  onToggle: () => void;
  onChange: (config: OllamaModelConfig) => void;
  record: ProbeRecord | undefined;
  canTest: boolean;
  testing: boolean;
  testingAny: boolean;
  testError: string | undefined;
  onTest: () => void;
}) {
  const { config } = row;
  const digest = shortDigest(row.digest);
  const set = (patch: Partial<OllamaModelConfig>) => onChange({ ...config, ...patch });

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex min-w-0 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={config.enabled && !row.embeddingOnly}
            disabled={row.embeddingOnly}
            onChange={(event) => set({ enabled: event.target.checked })}
            className={CHECKBOX}
            aria-label={`Enable ${row.name} for routing`}
          />
          <span className="min-w-0">
            <span className="block font-mono text-[14px] leading-5 text-foreground">{row.name}</span>
            <span className="os-meta mt-1 block text-os-subtle">
              {[
                digest ? `digest ${digest}` : undefined,
                row.loaded ? "loaded in memory" : row.installed ? "not loaded" : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          {row.embeddingOnly ? (
            <span className="os-meta text-os-subtle">Embedding-only: never used for generation</span>
          ) : !row.installed ? (
            <span className="os-meta text-os-amber">Not installed</span>
          ) : config.enabled ? (
            <span className="os-meta text-os-muted">Enabled</span>
          ) : (
            <span className="os-meta text-os-subtle">Installed, not enabled</span>
          )}
          {!row.embeddingOnly && canTest ? (
            <button
              type="button"
              onClick={onTest}
              disabled={testingAny}
              aria-label={`Test ${row.name} for suitability`}
              className="os-focus-ring os-meta cursor-pointer rounded-md text-os-muted transition-colors duration-150 hover:text-foreground disabled:cursor-default disabled:opacity-60"
            >
              {testing ? "Testing…" : "Test model"}
            </button>
          ) : null}
          {!row.embeddingOnly ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              {expanded ? "Hide settings" : "Settings"}
            </button>
          ) : null}
        </div>
      </div>

      {testing ? (
        <p role="status" className="os-meta mt-3 text-os-subtle">
          Running a real five-bullet task against {row.name} with your limits. A cold model can take up to a minute or two.
        </p>
      ) : null}
      {testError ? <p className="mt-3 text-[13px] leading-5 text-os-danger">{testError}</p> : null}
      {record && !row.embeddingOnly ? <ProbeReport record={record} config={row.config} /> : null}
      {!record && !row.embeddingOnly && canTest ? (
        <p className="os-meta mt-2 text-os-subtle">Not tested. Installed does not prove suitable.</p>
      ) : null}
      {enableWarning(record, config) ? (
        <p role="alert" className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-danger">
          {enableWarning(record, config)}
        </p>
      ) : null}

      {expanded && !row.embeddingOnly ? (
        <div className="mt-4 space-y-5 border-l border-os-border pl-5">
          <div>
            <SectionLabel>Task categories</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {TASK_CATEGORIES.filter((category) => category !== "other").map((category) => (
                <label key={category} className="flex cursor-pointer items-center gap-2 text-[13px] text-os-muted">
                  <input
                    type="checkbox"
                    checked={config.categories.includes(category)}
                    onChange={() => set({ categories: toggleCategory(config.categories, category) })}
                    className={CHECKBOX}
                  />
                  {category}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="block">
              <SectionLabel>Input limit (tokens)</SectionLabel>
              <input
                type="number"
                min={1}
                value={config.maxInputTokens}
                onChange={(event) => set({ maxInputTokens: Number(event.target.value) })}
                className={NUMBER_INPUT}
              />
            </label>
            <label className="block">
              <SectionLabel>Output limit (tokens)</SectionLabel>
              <input
                type="number"
                min={1}
                value={config.maxOutputTokens}
                onChange={(event) => set({ maxOutputTokens: Number(event.target.value) })}
                className={NUMBER_INPUT}
              />
            </label>
            <label className="block">
              <SectionLabel>Timeout (seconds)</SectionLabel>
              <input
                type="number"
                min={1}
                value={Math.round(config.timeoutMs / 1000)}
                onChange={(event) => set({ timeoutMs: Number(event.target.value) * 1000 })}
                className={NUMBER_INPUT}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={config.structuredOutput}
              onChange={(event) => set({ structuredOutput: event.target.checked })}
              className={CHECKBOX}
            />
            <span className="max-w-[62ch] text-[13px] leading-5 text-os-muted">
              Supports structured (JSON) output. Only models marked here are given JSON tasks.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={config.allowThinking}
              onChange={(event) => set({ allowThinking: event.target.checked })}
              className={CHECKBOX}
            />
            <span className="max-w-[62ch] text-[13px] leading-5 text-os-muted">
              Allow thinking mode. Off by default: it adds latency to tasks that do not need it.
            </span>
          </label>
        </div>
      ) : null}
    </li>
  );
}

const TONE = { good: "text-foreground", bad: "text-os-danger", neutral: "text-os-subtle" } as const;

/** The last suitability test: verdict, each check, the advice, and what the model actually did. */
function ProbeReport({ record, config }: { record: ProbeRecord; config: OllamaModelConfig }) {
  const badge = probeBadge(record, config);

  return (
    <div className="mt-3 border-l border-os-border pl-5">
      <p className={cn("os-meta", TONE[badge.tone])}>
        {badge.label} · {formatRelativeTime(record.testedAt)}
      </p>
      <p className="mt-1.5 max-w-[62ch] text-[13px] leading-5 text-os-muted">{record.summary}</p>

      {record.checks.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {record.checks.map((check) => (
            <li key={check.name} className="max-w-[70ch] text-[13px] leading-5 text-os-muted">
              <span className={cn("os-meta mr-2", check.passed ? "text-os-subtle" : "text-os-danger")}>
                {check.passed ? "Pass" : "Fail"}
              </span>
              <span className="text-foreground">{check.name}</span> · {check.detail}
            </li>
          ))}
        </ul>
      ) : null}

      {record.recommendation ? (
        <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-amber">{record.recommendation}</p>
      ) : null}

      {record.variants.length > 0 ? (
        <details className="mt-3">
          <summary className="os-focus-ring os-meta cursor-pointer text-os-subtle hover:text-foreground">
            What the model did
          </summary>
          <ul className="mt-2 space-y-2">
            {record.variants.map((variant) => (
              <li key={variant.label} className="max-w-[70ch] text-[12px] leading-5 text-os-subtle">
                <span className="text-os-muted">{variant.label}</span>
                {" · "}
                {variant.error
                  ? variant.error
                  : [
                      variant.doneReason ? `ended: ${variant.doneReason}` : undefined,
                      variant.outputTokens !== undefined ? `${variant.outputTokens} tokens` : undefined,
                      variant.thinkingChars ? `${variant.thinkingChars} chars of thinking` : undefined,
                      formatMs(variant.totalMs) ? `${formatMs(variant.totalMs)}` : undefined,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                {variant.startsWith ? (
                  <span className="mt-0.5 block font-mono break-words text-os-subtle">“{variant.startsWith}”</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
