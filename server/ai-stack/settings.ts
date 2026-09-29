import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";
import { OllamaSettingsSchema, type OllamaSettings } from "../../shared/route-policy-types";

/**
 * Which AIs the operator has switched on or off, and which model each uses.
 *
 * Two defaults, on purpose. AIs AgentOS has always used (the API workers,
 * Hermes, Jev) are **on unless switched off**, so a fresh install behaves as it
 * did before this switch existed. The operator's own coding CLIs are **off
 * unless switched on**: turning one on spends that tool's plan on AgentOS jobs,
 * and that is a decision a person makes, not a default.
 *
 * Read synchronously and held in memory: the switch is consulted from worker
 * health checks and from the Hermes request path, some of which are
 * synchronous, and a file read per request would be pointless when the only
 * writer is this module.
 */

/** Off until switched on. Everything else is on until switched off. */
export const OPT_IN = new Set(["claude-code", "codex", "gemini", "hermes-worker"]);

interface Settings {
  disabled: Set<string>;
  enabled: Set<string>;
  models: Record<string, string>;
  /** Local Ollama routing configuration; undefined until the operator sets it. */
  ollama?: OllamaSettings;
}

let settings: Settings | undefined;

function settingsFile(): string {
  return path.join(uiStateDir(), "ai-stack.json");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function load(): Settings {
  if (settings) return settings;

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Record<string, unknown>;
    const models =
      parsed.models && typeof parsed.models === "object" && !Array.isArray(parsed.models)
        ? Object.fromEntries(
            Object.entries(parsed.models as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
            ),
          )
        : {};

    const ollama = OllamaSettingsSchema.safeParse(parsed.ollama);

    settings = {
      disabled: new Set(strings(parsed.disabled)),
      enabled: new Set(strings(parsed.enabled)),
      models,
      ollama: ollama.success ? ollama.data : undefined,
    };
  } catch {
    settings = { disabled: new Set(), enabled: new Set(), models: {} };
  }

  return settings;
}

function save(next: Settings): void {
  fs.mkdirSync(uiStateDir(), { recursive: true });

  // Temp file then rename, so a crash mid-write never leaves a half-written
  // file that would read back as "nothing is switched".
  const target = settingsFile();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify(
      { disabled: [...next.disabled].sort(), enabled: [...next.enabled].sort(), models: next.models, ollama: next.ollama },
      null,
      2,
    ),
    "utf8",
  );
  fs.renameSync(temporary, target);

  settings = next;
}

export function isAiEnabled(id: string): boolean {
  const current = load();
  return OPT_IN.has(id) ? current.enabled.has(id) : !current.disabled.has(id);
}

export function setAiEnabled(id: string, enabled: boolean): void {
  const current = load();
  const disabled = new Set(current.disabled);
  const on = new Set(current.enabled);

  if (OPT_IN.has(id)) {
    if (enabled) on.add(id);
    else on.delete(id);
  } else if (enabled) {
    disabled.delete(id);
  } else {
    disabled.add(id);
  }

  save({ ...current, disabled, enabled: on });
}

/** The model the operator chose for an AI, when they chose one. */
export function aiModel(id: string): string | undefined {
  return load().models[id];
}

/** An empty model clears the choice, so the tool falls back to its own default. */
export function setAiModel(id: string, model: string | undefined): void {
  const current = load();
  const models = { ...current.models };
  const trimmed = model?.trim();

  if (trimmed) models[id] = trimmed;
  else delete models[id];

  save({ ...current, models });
}

/** Stored Ollama routing config, or undefined when the operator has set none. */
export function ollamaSettings(): OllamaSettings | undefined {
  return load().ollama;
}

export function setOllamaSettings(next: OllamaSettings): void {
  save({ ...load(), ollama: OllamaSettingsSchema.parse(next) });
}

/** Only tests need this — forgets the in-memory copy so the file is read again. */
export function resetAiSettingsCache(): void {
  settings = undefined;
}

/** What a gated integration says when the operator has switched it off. */
export function switchedOffReason(name: string): string {
  return `${name} is switched off in Operations → AI Stack.`;
}
