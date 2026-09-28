import type { AgentSession } from "../../shared/agentos-types";
import {
  createSession,
  forkSession,
  getSession,
  renameSession,
} from "../hermes/sessions";
import { GENERAL_LANE, laneFor, readSessionMap, setProjectSession } from "./session-store";

/**
 * One durable Hermes session per project.
 *
 * The mapping is looked up, verified against Hermes, and only re-created when
 * the session is genuinely gone — so a conversation survives restarts, and a
 * new one is never started per message.
 *
 * The lane is derived from the project on the server. React never chooses a
 * session id, which is what keeps one project's conversation out of another's.
 */

const TITLE_PREFIX = "AgentOS";

/** `pantry-pilot` → `AgentOS — Pantry Pilot`. */
export function sessionTitleFor(lane: string, projectName?: string): string {
  if (lane === GENERAL_LANE) return `${TITLE_PREFIX}: General`;

  const readable =
    projectName ??
    lane
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ");

  return `${TITLE_PREFIX}: ${readable}`;
}

async function startSessionForLane(
  lane: string,
  projectName?: string,
): Promise<AgentSession> {
  const title = sessionTitleFor(lane, projectName);
  const session = await createSession(title);

  // Some builds ignore a title at creation; set it explicitly so session
  // browsing stays legible either way.
  const renamed = session.title ? undefined : await renameSession(session.id, title);
  await setProjectSession(lane, session.id);

  return { ...(renamed ?? session), title: renamed?.title ?? session.title ?? title, project: lane };
}

export interface ResolveOptions {
  project?: string;
  projectName?: string;
  /** Start a fresh session, leaving the previous one intact in Hermes. */
  forceNew?: boolean;
}

/**
 * The active session for a project, creating one if needed.
 *
 * A mapped session that Hermes no longer has is replaced rather than treated as
 * an error — the vault outlives any single Hermes database.
 */
export async function resolveProjectSession({
  project,
  projectName,
  forceNew = false,
}: ResolveOptions = {}): Promise<AgentSession> {
  const lane = laneFor(project);

  if (forceNew) return startSessionForLane(lane, projectName);

  const mapped = (await readSessionMap())[lane];

  if (mapped) {
    const existing = await getSession(mapped);
    if (existing) return { ...existing, project: lane };
  }

  return startSessionForLane(lane, projectName);
}

/**
 * Branches the project's current conversation.
 *
 * The fork becomes the active session; the original stays in Hermes untouched.
 */
export async function forkProjectSession({
  project,
  projectName,
}: ResolveOptions = {}): Promise<AgentSession> {
  const lane = laneFor(project);
  const current = await resolveProjectSession({ project, projectName });

  const forked = await forkSession(current.id);
  const title = `${sessionTitleFor(lane, projectName)} (fork)`;
  const renamed = await renameSession(forked.id, title);

  await setProjectSession(lane, forked.id);

  return { ...(renamed ?? forked), title: renamed?.title ?? title, project: lane };
}
