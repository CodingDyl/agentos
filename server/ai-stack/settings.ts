import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * Which AIs the operator has switched off.
 *
 * Stored as the *off* set, not the on set, so the default is "everything
 * AgentOS integrates is allowed" — a fresh install, or a missing file, behaves
 * exactly as AgentOS did before this switch existed.
 *
 * Read synchronously and held in memory: the switch is consulted from worker
 * health checks and from the Hermes request path, some of which are
 * synchronous, and a file read per request would be pointless when the only
 * writer is this module.
 */

let disabled: Set<string> | undefined;

function settingsFile(): string {
  return path.join(uiStateDir(), "ai-stack.json");
}

function load(): Set<string> {
  if (disabled) return disabled;

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as { disabled?: unknown };
    disabled = new Set(
      Array.isArray(parsed.disabled) ? parsed.disabled.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    disabled = new Set();
  }

  return disabled;
}

export function isAiEnabled(id: string): boolean {
  return !load().has(id);
}

export function setAiEnabled(id: string, enabled: boolean): void {
  const next = new Set(load());
  if (enabled) next.delete(id);
  else next.add(id);

  fs.mkdirSync(uiStateDir(), { recursive: true });

  // Temp file then rename, so a crash mid-write never leaves a half-written
  // file that would read back as "nothing is switched off".
  const target = settingsFile();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ disabled: [...next].sort() }, null, 2), "utf8");
  fs.renameSync(temporary, target);

  disabled = next;
}

/** Only tests need this — forgets the in-memory copy so the file is read again. */
export function resetAiSettingsCache(): void {
  disabled = undefined;
}

/** What a gated integration says when the operator has switched it off. */
export function switchedOffReason(name: string): string {
  return `${name} is switched off in Operations → AI Stack.`;
}
