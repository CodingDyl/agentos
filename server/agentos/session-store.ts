import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Project → Hermes session mappings.
 *
 * This is the only thing AgentOS writes, and it writes *outside* the vault:
 * `~/.agentos-ui/sessions.json` is private UI state, so `~/AgentOS` stays a
 * clean, human-owned source of truth with no machine bookkeeping in it. The
 * vault adapter remains strictly read-only.
 *
 * The file holds identifiers only — never transcripts. Hermes owns those.
 */

/**
 * Resolved per call, not at import time, so the location always reflects the
 * current environment — a module-level constant would bake in whatever was set
 * when this file happened to be first imported.
 */
export function uiStateDir(): string {
  return process.env.AGENTOS_UI_DIR ?? path.join(os.homedir(), ".agentos-ui");
}

function sessionsFile(): string {
  return path.join(uiStateDir(), "sessions.json");
}

/** The lane used when no project is selected. */
export const GENERAL_LANE = "general";

export type SessionMap = Record<string, string>;

function isMap(value: unknown): value is SessionMap {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/** Reads the mappings. A missing or corrupt file simply means "none yet". */
export async function readSessionMap(): Promise<SessionMap> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(sessionsFile(), "utf8"));
    return isMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Records one project's session.
 *
 * Written atomically via a temp file and rename, so a crash mid-write cannot
 * leave a truncated mapping behind.
 */
export async function setProjectSession(
  lane: string,
  sessionId: string,
): Promise<SessionMap> {
  const current = await readSessionMap();
  const next: SessionMap = { ...current, [lane]: sessionId };

  const target = sessionsFile();
  await fs.mkdir(uiStateDir(), { recursive: true });

  const temporaryFile = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, target);

  return next;
}

/** Normalises a project slug into a lane key, falling back to `general`. */
export function laneFor(project: string | undefined): string {
  const slug = project?.trim().toLowerCase();
  return slug && slug.length > 0 ? slug : GENERAL_LANE;
}
