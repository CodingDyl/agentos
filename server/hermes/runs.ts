import { randomUUID } from "node:crypto";
import type { AgentRun, AgentRunStatus } from "../../shared/agentos-types";
import { hermesFailure, hermesFetch, HermesError } from "./client";

/**
 * Hermes agent runs.
 *
 * A run is asynchronous: starting one returns an id, and progress arrives on a
 * separate event stream. Field names are read tolerantly (`run_id` or `runId`)
 * because the payload shape is not contractual.
 */

const RUN_STATUSES: readonly AgentRunStatus[] = [
  "starting",
  "running",
  "waiting_for_approval",
  "stopping",
  "completed",
  "failed",
  "cancelled",
];

function pick(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) return payload[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Maps whatever Hermes reports onto a known status, defaulting to `running`. */
export function readRunStatus(value: unknown): AgentRunStatus {
  const raw = asString(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return "running";

  const known = RUN_STATUSES.find((status) => status === raw);
  if (known) return known;

  // Tolerate near-misses rather than failing a live run on a naming change.
  if (raw.includes("approval") || raw.includes("wait")) return "waiting_for_approval";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("stop")) return "stopping";
  if (raw.includes("fail") || raw.includes("error")) return "failed";
  if (raw.includes("complete") || raw.includes("succeed") || raw === "done") {
    return "completed";
  }
  if (raw.includes("start") || raw.includes("queue") || raw.includes("pend")) {
    return "starting";
  }

  return "running";
}

/** Reads a run payload, accepting snake_case or camelCase field names. */
export function readRun(payload: unknown): AgentRun {
  if (typeof payload !== "object" || payload === null) {
    throw new HermesError("Hermes returned an unreadable run.", "failed");
  }

  const record = payload as Record<string, unknown>;
  const nested = record.run;
  const source =
    typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)
      : record;

  const runId = asString(pick(source, ["run_id", "runId", "id"]));

  if (!runId) {
    throw new HermesError("Hermes did not return a run id.", "failed");
  }

  return {
    runId,
    status: readRunStatus(pick(source, ["status", "state"])),
    output: asString(pick(source, ["output", "text", "result"])),
    sessionId: asString(pick(source, ["session_id", "sessionId"])),
  };
}

export interface StartRunOptions {
  input: string;
  sessionId?: string;
}

/**
 * Starts a run.
 *
 * Carries an idempotency key so a retried or double-submitted request cannot
 * start the same work twice.
 */
export async function startRun({
  input,
  sessionId,
}: StartRunOptions): Promise<AgentRun> {
  const response = await hermesFetch("/runs", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: sessionId ? { input, session_id: sessionId } : { input },
  });

  if (!response.ok) throw hermesFailure(response.status);

  return readRun(await response.json());
}

export async function getRun(runId: string): Promise<AgentRun> {
  const response = await hermesFetch(`/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
  });

  if (!response.ok) throw hermesFailure(response.status);

  return readRun(await response.json());
}

/** Asks Hermes to stop a run. It transitions through `stopping` to `cancelled`. */
export async function stopRun(runId: string): Promise<AgentRun | undefined> {
  const response = await hermesFetch(
    `/runs/${encodeURIComponent(runId)}/stop`,
    { method: "POST", body: {} },
  );

  if (!response.ok) throw hermesFailure(response.status);

  // Some builds answer with the run, others with an empty acknowledgement.
  try {
    return readRun(await response.json());
  } catch {
    return undefined;
  }
}

/** Queues guidance into an active run, applied at the next tool boundary. */
export async function steerRun(runId: string, guidance: string): Promise<void> {
  const response = await hermesFetch(
    `/runs/${encodeURIComponent(runId)}/steer`,
    { method: "POST", body: { input: guidance } },
  );

  if (!response.ok) throw hermesFailure(response.status);
}

/**
 * Opens the run's event stream.
 *
 * Returns the raw upstream response so the local endpoint can forward the SSE
 * bytes untouched — events are interpreted in the browser, not re-encoded here.
 */
export async function openRunEvents(
  runId: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await hermesFetch(
    `/runs/${encodeURIComponent(runId)}/events`,
    {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    },
  );

  if (!response.ok) throw hermesFailure(response.status);

  return response;
}
