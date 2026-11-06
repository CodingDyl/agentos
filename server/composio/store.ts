import fs from "node:fs";
import path from "node:path";
import { CapabilityPolicySchema, type CapabilityPolicy } from "../../shared/connector-types";
import type { ComposioActionClass } from "../../shared/composio-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * What the operator decided about each Composio app. Composio itself never
 * hears about any of it: these limits are AgentOS's.
 *
 * One small JSON file outside the vault, read once and held in memory, like
 * the connectors' own state. Only what differs from the default is kept.
 */

export interface AppSettings {
  enabled?: boolean;
  policies?: Partial<Record<ComposioActionClass, CapabilityPolicy>>;
}

const CLASSES: readonly ComposioActionClass[] = ["read", "change", "delete"];

let apps: Map<string, AppSettings> | undefined;

function stateFile(): string {
  return path.join(uiStateDir(), "composio-apps.json");
}

function readSettings(value: unknown): AppSettings {
  const entry = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const policies: NonNullable<AppSettings["policies"]> = {};
  const stored = (entry.policies && typeof entry.policies === "object" ? entry.policies : {}) as Record<string, unknown>;
  for (const actionClass of CLASSES) {
    const policy = CapabilityPolicySchema.safeParse(stored[actionClass]);
    if (policy.success) policies[actionClass] = policy.data;
  }
  return { enabled: typeof entry.enabled === "boolean" ? entry.enabled : undefined, policies };
}

function load(): Map<string, AppSettings> {
  if (apps) return apps;
  apps = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as { apps?: Record<string, unknown> };
    for (const [slug, value] of Object.entries(parsed.apps ?? {})) apps.set(slug, readSettings(value));
  } catch {
    // No file yet, or an unreadable one: every app is on its defaults.
  }
  return apps;
}

function save(): void {
  const target = stateFile();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify({ apps: Object.fromEntries(load()) }, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

export function appSettings(slug: string): AppSettings {
  return load().get(slug) ?? {};
}

export function updateAppSettings(slug: string, patch: { enabled?: boolean; policies?: Partial<Record<ComposioActionClass, CapabilityPolicy | null>> }): void {
  const current = appSettings(slug);
  const policies = { ...current.policies };
  for (const actionClass of CLASSES) {
    const policy = patch.policies?.[actionClass];
    if (policy === null) delete policies[actionClass];
    else if (policy) policies[actionClass] = policy;
  }
  load().set(slug, { enabled: patch.enabled ?? current.enabled, policies });
  save();
}

/** For tests. */
export function resetComposioStore(): void {
  apps = undefined;
}
