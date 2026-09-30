import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";
import {
  CapabilityPolicySchema,
  type CapabilityPolicy,
  type ConnectorHealth,
  type ConnectorUse,
} from "../../shared/connector-types";

/**
 * What the operator decided about connectors, and what AgentOS last saw.
 *
 * One small JSON file outside the vault. Read synchronously and held in
 * memory, like the AI stack's switches: the guard is consulted from inside
 * clients on every request, and the only writer is this module.
 *
 * Nothing here is a secret. Health keeps a sentence and a public account
 * handle; a use keeps a capability id and a short label.
 */

/**
 * History kept per connector, so a busy one (Gmail's label changes) never
 * pushes a quiet one's last push out of the file.
 */
const USES_PER_CONNECTOR = 25;

/**
 * A read is recorded as "last used" at most this often per connector. Reads
 * are frequent (Inbox polls) and the file is rewritten on each record.
 */
const TOUCH_INTERVAL_MS = 60_000;

export interface StoredHealth extends ConnectorHealth {
  account?: string;
}

interface State {
  disabled: Set<string>;
  policies: Record<string, CapabilityPolicy>;
  health: Record<string, StoredHealth>;
  lastUsed: Record<string, string>;
  uses: ConnectorUse[];
}

let state: State | undefined;

function stateFile(): string {
  return path.join(uiStateDir(), "connectors.json");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readHealth(value: unknown): StoredHealth | undefined {
  const entry = record(value);
  if (typeof entry.ok !== "boolean" || typeof entry.checkedAt !== "string" || typeof entry.detail !== "string") return undefined;
  return {
    ok: entry.ok,
    checkedAt: entry.checkedAt,
    detail: entry.detail,
    account: typeof entry.account === "string" ? entry.account : undefined,
  };
}

function readUse(value: unknown): ConnectorUse | undefined {
  const entry = record(value);
  if (typeof entry.capabilityId !== "string" || typeof entry.capabilityName !== "string" || typeof entry.at !== "string") return undefined;
  return {
    capabilityId: entry.capabilityId,
    capabilityName: entry.capabilityName,
    at: entry.at,
    detail: typeof entry.detail === "string" ? entry.detail : undefined,
  };
}

function load(): State {
  if (state) return state;

  try {
    const parsed = record(JSON.parse(fs.readFileSync(stateFile(), "utf8")));

    const policies: Record<string, CapabilityPolicy> = {};
    for (const [id, value] of Object.entries(record(parsed.policies))) {
      const policy = CapabilityPolicySchema.safeParse(value);
      if (policy.success) policies[id] = policy.data;
    }

    const health: Record<string, StoredHealth> = {};
    for (const [id, value] of Object.entries(record(parsed.health))) {
      const entry = readHealth(value);
      if (entry) health[id] = entry;
    }

    const lastUsed: Record<string, string> = {};
    for (const [id, value] of Object.entries(record(parsed.lastUsed))) {
      if (typeof value === "string") lastUsed[id] = value;
    }

    state = {
      disabled: new Set(Array.isArray(parsed.disabled) ? parsed.disabled.filter((id): id is string => typeof id === "string") : []),
      policies,
      health,
      lastUsed,
      uses: Array.isArray(parsed.uses)
        ? parsed.uses.map(readUse).filter((use): use is ConnectorUse => use !== undefined)
        : [],
    };
  } catch {
    state = { disabled: new Set(), policies: {}, health: {}, lastUsed: {}, uses: [] };
  }

  return state;
}

function save(next: State): void {
  // Cached first: a failed write (read-only disk) must not make the guard
  // forget a switch the operator just turned off in this process.
  state = next;

  try {
    fs.mkdirSync(uiStateDir(), { recursive: true });
    const target = stateFile();
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify(
        {
          disabled: [...next.disabled].sort(),
          policies: next.policies,
          health: next.health,
          lastUsed: next.lastUsed,
          uses: next.uses,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.renameSync(temporary, target);
  } catch (error) {
    console.error("[agentos] connector state could not be saved:", error);
  }
}

/** On unless switched off: every connector AgentOS already used keeps working after this page exists. */
export function isSwitchedOn(connectorId: string): boolean {
  return !load().disabled.has(connectorId);
}

export function setSwitchedOn(connectorId: string, on: boolean): void {
  const current = load();
  const disabled = new Set(current.disabled);
  if (on) disabled.delete(connectorId);
  else disabled.add(connectorId);
  save({ ...current, disabled });
}

export function storedPolicy(capabilityId: string): CapabilityPolicy | undefined {
  return load().policies[capabilityId];
}

/** `null` forgets the override so the catalog default applies again. */
export function setStoredPolicies(changes: Record<string, CapabilityPolicy | null>): void {
  const current = load();
  const policies = { ...current.policies };
  for (const [id, policy] of Object.entries(changes)) {
    if (policy === null) delete policies[id];
    else policies[id] = policy;
  }
  save({ ...current, policies });
}

export function storedHealth(connectorId: string): StoredHealth | undefined {
  return load().health[connectorId];
}

export function saveHealth(connectorId: string, health: StoredHealth): void {
  const current = load();
  save({ ...current, health: { ...current.health, [connectorId]: health } });
}

/** Forgets a connector's last test, e.g. after disconnecting it. */
export function clearHealth(connectorId: string): void {
  const current = load();
  const health = { ...current.health };
  delete health[connectorId];
  save({ ...current, health });
}

export function lastUsed(connectorId: string): string | undefined {
  return load().lastUsed[connectorId];
}

/** A read happened. Throttled: only moves "last used" once a minute. */
export function touch(connectorId: string, now = new Date()): void {
  const current = load();
  const previous = current.lastUsed[connectorId];
  if (previous && now.getTime() - Date.parse(previous) < TOUCH_INTERVAL_MS) return;
  save({ ...current, lastUsed: { ...current.lastUsed, [connectorId]: now.toISOString() } });
}

/** An action happened: kept in the history and moves "last used". */
export function recordUse(connectorId: string, use: ConnectorUse): void {
  const current = load();
  const prefix = `${connectorId}.`;
  const own = current.uses.filter((entry) => entry.capabilityId.startsWith(prefix));
  const others = current.uses.filter((entry) => !entry.capabilityId.startsWith(prefix));
  save({
    ...current,
    lastUsed: { ...current.lastUsed, [connectorId]: use.at },
    uses: [...others, ...[...own, use].slice(-USES_PER_CONNECTOR)],
  });
}

/** Most recent first. */
export function usesFor(connectorId: string, limit = 10): ConnectorUse[] {
  const prefix = `${connectorId}.`;
  return load()
    .uses.filter((use) => use.capabilityId.startsWith(prefix))
    .slice(-limit)
    .reverse();
}

/** Only tests need this — forgets the in-memory copy so the file is read again. */
export function resetConnectorStateCache(): void {
  state = undefined;
}
