import type { AgentFailureReason, AgentStatus } from "../../shared/agentos-types";
import type { UsageContext, UsageOperation } from "../../shared/usage-types";
import { isAiEnabled, switchedOffReason } from "../ai-stack/settings";
import { collectHermesUsage } from "../usage/collector";
import { touch } from "../connectors/store";
import { NO_EM_DASH_RULE, withoutEmDashes } from "../../shared/plain-text";

/**
 * The only place the Hermes API key exists.
 *
 * The key is read from the server environment and never leaves this process:
 * it is not sent to the browser, not echoed in errors, and not included in the
 * status endpoint. React talks to the local adapter; the adapter talks to
 * Hermes.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:8642/v1";
const DEFAULT_MODEL = "hermes";
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * How long a review may take.
 *
 * A review packet carries a whole diff, so it is the largest thing this server
 * ever sends and the slowest thing Hermes ever answers. At two minutes the
 * reviews of real jobs were being cut off mid-thought and recorded as Hermes
 * being unreachable. Ten minutes is not generous; it is the observed cost of
 * reading a hundred kilobytes of patch.
 */
export const REVIEW_TIMEOUT_MS = 600_000;

export class HermesError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "HermesError";
  }
}

function baseUrl(): string {
  return (process.env.HERMES_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Hermes serves runs and completions under `/v1`, but session management under
 * `/api` — `/v1/sessions` does not exist. The management base is derived from
 * the configured `/v1` URL, and can be overridden outright.
 */
function managementBaseUrl(): string {
  const configured = process.env.HERMES_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  return `${baseUrl().replace(/\/v1$/, "")}/api`;
}

/** Which of Hermes' two bases a request belongs to. */
export type HermesBase = "v1" | "api";

function baseFor(base: HermesBase): string {
  return base === "api" ? managementBaseUrl() : baseUrl();
}

function model(): string {
  return process.env.HERMES_MODEL ?? DEFAULT_MODEL;
}

function requireApiKey(): string {
  const apiKey = process.env.HERMES_API_KEY?.trim();

  if (!apiKey) {
    throw new HermesError(
      "HERMES_API_KEY is not set. Copy .env.example to .env and add your key.",
      "not-configured",
    );
  }

  return apiKey;
}

export interface HermesFetchOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Defaults to `v1`; session management lives under `api`. */
  base?: HermesBase;
  body?: unknown;
  /** Extra headers, e.g. an idempotency key or an SSE Accept. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Omit for no timeout — used by the long-lived event stream. */
  timeoutMs?: number;
}

/**
 * One authenticated request to Hermes.
 *
 * The `Authorization` header is added here and nowhere else, so every Hermes
 * call in the server shares a single place where the key is used.
 */
export async function hermesFetch(
  path: string,
  options: HermesFetchOptions,
): Promise<Response> {
  // Reported as "not configured" deliberately: every caller already degrades
  // gracefully for that reason (fallback plans, "Hermes unavailable" notices),
  // so switching Hermes off takes the same, well-trodden path as never having
  // set it up.
  if (!isAiEnabled("hermes")) {
    throw new HermesError(switchedOffReason("Hermes"), "not-configured");
  }

  const apiKey = requireApiKey();
  touch("hermes");
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...options.headers,
  };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    return await fetch(`${baseFor(options.base ?? "v1")}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A caller-aborted request is a cancellation, not an outage.
    if (options.signal?.aborted) throw error;

    // Nor is a request that ran out of time. The timeout signal is created in
    // here, so `options.signal` is undefined and this used to fall through to
    // "offline" — the console said Hermes could not be reached while Hermes
    // was running perfectly well and simply thinking for longer than allowed.
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new HermesError(
        `Hermes did not answer within ${Math.round(timeoutMs / 1000)}s.`,
        "timed-out",
      );
    }

    throw new HermesError(
      `Could not reach Hermes at ${baseFor(options.base ?? "v1")}.`,
      "offline",
    );
  }
}

/** Turns a non-OK Hermes response into a classified error. */
export function hermesFailure(status: number): HermesError {
  if (status === 401 || status === 403) {
    return new HermesError("Hermes rejected the API key.", "unauthorized");
  }
  return new HermesError(`Hermes responded with ${status}.`, "failed");
}

/** Whether Hermes is configured. Does not contact Hermes. */
export function getHermesStatus(): AgentStatus {
  const configured = Boolean(process.env.HERMES_API_KEY?.trim());
  return configured
    ? { configured, baseUrl: baseUrl(), model: model() }
    : { configured };
}

/** Narrow shape of the OpenAI-compatible reply, kept local to this module. */
interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

function readReplyText(payload: unknown): string {
  const completion = payload as ChatCompletion | null;
  const content = completion?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new HermesError("Hermes returned an empty response.", "failed");
  }

  return content;
}

/**
 * What this call was for, and what it belongs to.
 *
 * Every `sendToHermes` caller supplies one. It is the reason the usage screen
 * can say "visual reviews cost 240k tokens this month" rather than "Hermes
 * cost 900k tokens" — the operation is recorded at the point where it is
 * actually known, instead of being reconstructed later from a prompt.
 *
 * The ids are passed straight through to the ledger, so a review recorded
 * against a job is automatically attributable to that job's task and project.
 */
export interface HermesCallContext {
  operation: UsageOperation;
  project?: string;
  taskId?: string;
  jobId?: string;
  runId?: string;
  /** How much was put in front of the model, when the caller assembled it. */
  context?: UsageContext;
  /** Overrides the default request timeout for calls known to be slow. */
  timeoutMs?: number;
  /** Cancels the call, e.g. when an Operator run is stopped. */
  signal?: AbortSignal;
  /**
   * Instructions that have to outrank Hermes' own persona.
   *
   * Hermes carries a `SOUL.md` persona that tells it to answer briefly and to
   * report finished work as "what changed, what's verified, what's left". That
   * is the right voice for a person at a terminal and the wrong one for a
   * caller that parses the reply: it quietly beat the output contract a skill
   * asked for, and reviews came back as three lines of prose with no JSON.
   *
   * A system message wins where a line of user text does not. Callers whose
   * replies are read by machine put their schema here, not in the prompt.
   */
  system?: string;
  /**
   * Called with the reply's own reference and model, for callers that must
   * cite exactly which Hermes run produced a report.
   */
  onReply?: (meta: { id?: string; model?: string }) => void;
}

/**
 * Sends one prompt to Hermes and returns its reply text.
 *
 * Failures are classified so the console can say what actually went wrong
 * rather than showing a generic error — and never invents a reply.
 *
 * Usage is recorded here because this is the only place that sees the raw
 * reply: the `usage` block is discarded a line later when the text is read
 * out, and every caller above this point deals in prose. Recording is wrapped
 * so that a ledger problem can never fail a review Hermes actually completed —
 * telemetry does not get to break the thing it is measuring.
 */
export async function sendToHermes(
  message: string,
  call: HermesCallContext = { operation: "other" },
): Promise<string> {
  const startedAt = Date.now();

  const response = await hermesFetch("/chat/completions", {
    method: "POST",
    timeoutMs: call.timeoutMs,
    // A caller's signal replaces the default timeout inside `hermesFetch`, so
    // the timeout rides along with it rather than being lost.
    signal: call.signal
      ? AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs ?? REQUEST_TIMEOUT_MS)])
      : undefined,
    body: {
      model: model(),
      // The house style rides on every call as a system message, which
      // outranks Hermes' persona where a line of user text would not.
      messages: [
        { role: "system", content: call.system ? `${call.system}\n\n${NO_EM_DASH_RULE}` : NO_EM_DASH_RULE },
        { role: "user", content: message },
      ],
    },
  });

  if (!response.ok) throw hermesFailure(response.status);

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new HermesError("Hermes returned an unreadable response.", "failed");
  }

  try {
    collectHermesUsage({
      operation: call.operation,
      payload,
      project: call.project,
      taskId: call.taskId,
      jobId: call.jobId,
      runId: call.runId,
      durationMs: Date.now() - startedAt,
      // Characters of prompt, never the prompt. A number cannot leak a secret,
      // and it is what turns "94k input tokens" into "the packet was huge".
      context: call.context ?? {
        characters: message.length + (call.system?.length ?? 0),
      },
    });
  } catch (error) {
    console.error("[agentos] could not record Hermes usage:", error);
  }

  const reply = payload as { id?: unknown; model?: unknown } | null;
  call.onReply?.({
    id: typeof reply?.id === "string" ? reply.id : undefined,
    model: typeof reply?.model === "string" ? reply.model : undefined,
  });

  // The guarantee behind the system rule: nothing Hermes returns here is
  // stored or shown with an em dash. Code in the reply is left untouched.
  return withoutEmDashes(readReplyText(payload));
}
