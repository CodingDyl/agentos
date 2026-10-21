import fs from "node:fs";
import path from "node:path";
import {
  AgentPatchSchema,
  AgentRecordSchema,
  type AgentPatch,
  type AgentRecord,
} from "../../shared/agent-types";
import { uiStateDir } from "../agentos/session-store";
import { SEED_AGENTS } from "./seeds";

/**
 * The specialist registry.
 *
 * One JSON file outside the vault, same pattern as connectors and the AI
 * stack: read into memory, written atomically. Seeds fill an empty file and
 * any new seed ids a later release introduces; they never overwrite a row
 * the operator has already edited.
 */

interface State {
  agents: AgentRecord[];
  knownSeedIds: string[];
}

let state: State | undefined;
let loadedFrom: string | undefined;

function stateFile(): string {
  return path.join(uiStateDir(), "agents.json");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readAgent(value: unknown): AgentRecord | undefined {
  const parsed = AgentRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeSeeds(existing: AgentRecord[], knownSeedIds: string[]): State {
  const byId = new Map(existing.map((agent) => [agent.id, agent]));
  const known = new Set(knownSeedIds);
  for (const seed of SEED_AGENTS) {
    if (!known.has(seed.id) && !byId.has(seed.id)) {
      byId.set(seed.id, seed);
    } else if (seed.allowedTools.length > 0) {
      const current = byId.get(seed.id);
      if (current && current.allowedTools.length === 0) {
        byId.set(seed.id, { ...current, allowedTools: [...seed.allowedTools] });
      }
    }
    known.add(seed.id);
  }
  return { agents: [...byId.values()], knownSeedIds: [...known].sort() };
}

function load(): State {
  const file = stateFile();
  if (state && loadedFrom === file) return state;

  try {
    const parsed = record(JSON.parse(fs.readFileSync(file, "utf8")));
    const agents = Array.isArray(parsed.agents)
      ? parsed.agents.map(readAgent).filter((agent): agent is AgentRecord => agent !== undefined)
      : [];
    const knownSeedIds = Array.isArray(parsed.knownSeedIds)
      ? parsed.knownSeedIds.filter((id): id is string => typeof id === "string")
      : [];
    state = mergeSeeds(agents, knownSeedIds);
  } catch {
    state = mergeSeeds([], []);
  }

  loadedFrom = file;
  if (!fs.existsSync(file) || mergeChanged(file, state)) save(state);
  return state;
}

function mergeChanged(file: string, next: State): boolean {
  try {
    const parsed = record(JSON.parse(fs.readFileSync(file, "utf8")));
    const diskAgents = Array.isArray(parsed.agents) ? parsed.agents : [];
    const known = Array.isArray(parsed.knownSeedIds) ? parsed.knownSeedIds.length : 0;
    if (diskAgents.length !== next.agents.length || known !== next.knownSeedIds.length) return true;

    const diskTools = new Map<string, number>();
    for (const entry of diskAgents) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as { id?: unknown; allowedTools?: unknown };
      if (typeof row.id !== "string") continue;
      diskTools.set(row.id, Array.isArray(row.allowedTools) ? row.allowedTools.length : 0);
    }
    return next.agents.some((agent) => (diskTools.get(agent.id) ?? 0) !== agent.allowedTools.length);
  } catch {
    return true;
  }
}

function save(next: State): void {
  state = next;
  loadedFrom = stateFile();

  try {
    fs.mkdirSync(uiStateDir(), { recursive: true });
    const target = stateFile();
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ agents: next.agents, knownSeedIds: next.knownSeedIds }, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, target);
  } catch (error) {
    console.error("[agentos] agent registry could not be saved:", error);
  }
}

export function listAgentRecords(): AgentRecord[] {
  return load().agents.map((agent) => ({ ...agent }));
}

export function getAgentRecord(id: string): AgentRecord | undefined {
  const agent = load().agents.find((entry) => entry.id === id);
  return agent ? { ...agent } : undefined;
}

export function updateAgentRecord(id: string, patch: unknown): AgentRecord {
  const parsed = AgentPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new AgentStoreError(parsed.error.issues[0]?.message ?? "That update could not be read.", 400);
  }

  const current = load();
  const index = current.agents.findIndex((agent) => agent.id === id);
  if (index < 0) throw new AgentStoreError("There is no agent with that id.", 404);

  const body = parsed.data;
  const updated: AgentRecord = {
    ...current.agents[index],
    ...stripUndefined(body),
    id,
    updatedAt: new Date().toISOString(),
  };
  const checked = AgentRecordSchema.safeParse(updated);
  if (!checked.success) {
    throw new AgentStoreError(checked.error.issues[0]?.message ?? "That update was not valid.", 400);
  }

  const agents = [...current.agents];
  agents[index] = checked.data;
  save({ ...current, agents });
  return { ...checked.data };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as [keyof T, T[keyof T]][]) {
    if (entry !== undefined) next[key] = entry;
  }
  return next;
}

/** Tests that change `AGENTOS_UI_DIR` after a previous load. */
export function resetAgentsCache(): void {
  state = undefined;
  loadedFrom = undefined;
}

export class AgentStoreError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentStoreError";
    this.status = status;
  }
}

export type { AgentPatch };
