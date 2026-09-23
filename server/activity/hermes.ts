import type { ActivityEvent } from "../../shared/agentos-types";
import { GENERAL_LANE, readSessionMap } from "../agentos/session-store";
import { listSessions } from "../hermes/sessions";

/**
 * Conversations Hermes holds.
 *
 * Hermes owns its own history, so this asks rather than mirrors: sessions are
 * read from Hermes and attributed to a project using the lane map AgentOS
 * already keeps. Nothing is copied into the vault.
 *
 * Run *outcomes* are not here. A run's end is known to whoever watched it
 * finish, and that is recorded once, in the UI event store — reconstructing it
 * from session state afterwards would be guesswork.
 */

/** Inverts the lane map: session id → the project it belongs to. */
async function projectsBySession(): Promise<Map<string, string>> {
  const lanes = await readSessionMap();

  return new Map(
    Object.entries(lanes)
      .filter(([lane]) => lane !== GENERAL_LANE)
      .map(([lane, sessionId]) => [sessionId, lane]),
  );
}

/** Every recent Hermes session, unsorted. */
export async function readHermesActivity(
  limit: number,
): Promise<ActivityEvent[]> {
  const [sessions, projects] = await Promise.all([
    listSessions(limit),
    projectsBySession(),
  ]);

  return sessions.flatMap((session) => {
    // A session Hermes cannot date cannot be placed on a timeline, and a
    // guessed position is worse than an absent one.
    if (!session.createdAt) return [];

    return [
      {
        id: `hermes-session-${session.id}`,
        timestamp: session.createdAt,
        source: "hermes",
        level: "info",
        type: "session.started",
        title: "Hermes session started",
        description: session.title,
        project: projects.get(session.id),
        sessionId: session.id,
        metadata:
          session.messageCount === undefined
            ? undefined
            : { messages: session.messageCount },
      } satisfies ActivityEvent,
    ];
  });
}
