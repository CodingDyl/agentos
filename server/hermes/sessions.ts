import type {
  AgentSession,
  AgentSessionMessage,
} from "../../shared/agentos-types";
import { hermesFailure, hermesFetch, HermesError } from "./client";

/**
 * Hermes session management.
 *
 * Hermes owns conversation history; AgentOS owns project state. Nothing here
 * copies a transcript into the vault. Sessions live under Hermes' `/api` base,
 * not `/v1`.
 */

const SESSIONS_PATH = "/sessions";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Reads a session, tolerating snake_case or camelCase and a `session` wrapper. */
export function readSession(payload: unknown): AgentSession {
  const outer = record(payload);
  const source = record(outer?.session) ?? outer;

  const id = source ? asString(pick(source, ["id", "session_id", "sessionId"])) : undefined;

  if (!source || !id) {
    throw new HermesError("Hermes returned an unreadable session.", "failed");
  }

  return {
    id,
    title: asString(pick(source, ["title", "name"])),
    createdAt: asString(pick(source, ["created_at", "createdAt"])),
    updatedAt: asString(pick(source, ["updated_at", "updatedAt", "last_active_at"])),
    messageCount: asCount(
      pick(source, ["message_count", "messageCount", "messages_count", "num_messages"]),
    ),
  };
}

/** Finds the array of items in a list response, whatever it is keyed by. */
function readCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const source = record(payload);
  if (!source) return [];

  for (const key of ["sessions", "messages", "data", "items", "results"]) {
    if (Array.isArray(source[key])) return source[key];
  }

  return [];
}

const MESSAGE_ROLES = new Set(["user", "assistant", "tool", "system"]);

/** Reads one transcript message, dropping anything without a usable role. */
export function readSessionMessage(
  payload: unknown,
  index: number,
): AgentSessionMessage | undefined {
  const source = record(payload);
  if (!source) return undefined;

  const role = asString(pick(source, ["role", "type"]))?.toLowerCase();
  if (!role || !MESSAGE_ROLES.has(role)) return undefined;

  const content = pick(source, ["content", "text", "message"]);

  return {
    id: asString(pick(source, ["id", "message_id", "messageId"])) ?? `message-${index}`,
    role: role as AgentSessionMessage["role"],
    // Structured content (tool calls, parts) is not rendered as prose.
    content: typeof content === "string" ? content : undefined,
    createdAt: asString(pick(source, ["created_at", "createdAt", "timestamp"])),
  };
}

async function request(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
): Promise<unknown> {
  const response = await hermesFetch(path, { method, base: "api", body });

  if (!response.ok) throw hermesFailure(response.status);

  return response.json().catch(() => ({}));
}

export async function createSession(title?: string): Promise<AgentSession> {
  return readSession(await request(SESSIONS_PATH, "POST", title ? { title } : {}));
}

/** Returns `undefined` when the session no longer exists in Hermes. */
export async function getSession(id: string): Promise<AgentSession | undefined> {
  const response = await hermesFetch(`${SESSIONS_PATH}/${encodeURIComponent(id)}`, {
    method: "GET",
    base: "api",
  });

  if (response.status === 404) return undefined;
  if (!response.ok) throw hermesFailure(response.status);

  try {
    return readSession(await response.json());
  } catch {
    return undefined;
  }
}

export async function listSessions(limit = 25): Promise<AgentSession[]> {
  const payload = await request(`${SESSIONS_PATH}?limit=${limit}`, "GET");

  return readCollection(payload)
    .map((entry) => {
      try {
        return readSession(entry);
      } catch {
        return undefined;
      }
    })
    .filter((session): session is AgentSession => session !== undefined);
}

export async function getSessionMessages(
  id: string,
): Promise<AgentSessionMessage[]> {
  const payload = await request(
    `${SESSIONS_PATH}/${encodeURIComponent(id)}/messages`,
    "GET",
  );

  return readCollection(payload)
    .map(readSessionMessage)
    .filter((message): message is AgentSessionMessage => message !== undefined);
}

export async function renameSession(
  id: string,
  title: string,
): Promise<AgentSession | undefined> {
  try {
    return readSession(
      await request(`${SESSIONS_PATH}/${encodeURIComponent(id)}`, "PATCH", {
        title,
      }),
    );
  } catch {
    // A title is a nicety; failing to set one must not fail session creation.
    return undefined;
  }
}

export async function forkSession(id: string): Promise<AgentSession> {
  return readSession(
    await request(`${SESSIONS_PATH}/${encodeURIComponent(id)}/fork`, "POST", {}),
  );
}
