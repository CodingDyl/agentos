/**
 * The only place the Virtec API key exists.
 *
 * `VIRTEC_BASE_URL` is the Virtec deployment (e.g. `https://crm.virtara.co.za`)
 * and `VIRTEC_API_KEY` is the value Virtec holds as `AGENTOS_API_KEY`. Both are
 * read by the Node server only. The key is attached to requests here and
 * nowhere else — it never reaches a response, an error message or a log line.
 *
 * GET for reads with `VIRTEC_API_KEY`. Writes (four fixed routes) use
 * a separate `VIRTEC_WRITE_API_KEY`, and only when it is set.
 */

const REQUEST_TIMEOUT_MS = 15_000;

/** Every path this client may request. Nothing from a request is ever appended. */
export const VIRTEC_PATHS = {
  leads: "/api/agentos/leads?limit=500",
  inbound: "/api/agentos/inbound-leads?limit=500",
  clients: "/api/agentos/clients?limit=500",
  quotes: "/api/agentos/quotes?limit=500",
  projects: "/api/agentos/projects?limit=500",
  followUps: "/api/agentos/follow-ups?limit=500",
  revenue: "/api/agentos/revenue-summary",
} as const;

export type VirtecPath = (typeof VIRTEC_PATHS)[keyof typeof VIRTEC_PATHS];

export class VirtecError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "unauthorized" | "unavailable" | "redirected" | "bad-response",
    /** The HTTP status, when Virtec answered at all. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "VirtecError";
  }
}

/**
 * Why a request never got an answer, in words that point at the fix.
 *
 * Node's fetch reports every network failure as "fetch failed" and hides the
 * real cause one level down; this digs it out. Only error codes and names are
 * read — nothing that could contain the request's headers.
 */
function networkFailure(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `Virtec did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`;
  }

  // `localhost` can resolve to both ::1 and 127.0.0.1; a failure on both comes
  // back as an AggregateError whose individual errors hold the codes.
  const raw = error instanceof Error ? (error.cause as { code?: string; errors?: { code?: string }[] } | undefined) : undefined;
  const cause = raw ? { code: raw.code ?? raw.errors?.find((entry) => entry.code)?.code } : undefined;
  switch (cause?.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Virtec's host name could not be found. Check VIRTEC_BASE_URL.";
    case "ECONNREFUSED":
      return "Virtec refused the connection. Is the address right, and is it running?";
    case "ECONNRESET":
      return "Virtec closed the connection.";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `Virtec's HTTPS certificate was not accepted (${cause.code}).`;
    default:
      return cause?.code ? `Virtec did not answer (${cause.code}).` : "Virtec did not answer.";
  }
}

/**
 * The deployment to talk to, or undefined when it cannot be used.
 *
 * HTTPS only — the key is a bearer credential and must not cross the network
 * in the clear. Plain HTTP is allowed for a Virtec running on this machine.
 */
export function virtecBaseUrl(): URL | undefined {
  const raw = process.env.VIRTEC_BASE_URL?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function isVirtecConfigured(): boolean {
  return Boolean(virtecBaseUrl() && process.env.VIRTEC_API_KEY?.trim());
}

/**
 * Whether AgentOS may write back to Virtec.
 *
 * A separate key, `VIRTEC_WRITE_API_KEY` (Virtec's `AGENTOS_WRITE_API_KEY`):
 * the read key cannot write, so a read-only setup stays read-only. Virtec
 * refuses a write key equal to the read key, and so does this check.
 */
export function isVirtecWritable(): boolean {
  const write = process.env.VIRTEC_WRITE_API_KEY?.trim();
  return Boolean(isVirtecConfigured() && write && write !== process.env.VIRTEC_API_KEY?.trim());
}

/** Why Virtec cannot be used, in words a person can act on. Never mentions the key's value. */
export function virtecConfigurationProblem(): string | undefined {
  if (!process.env.VIRTEC_BASE_URL?.trim()) return "VIRTEC_BASE_URL is not set.";
  if (!virtecBaseUrl()) return "VIRTEC_BASE_URL must be an https:// address (http:// only for localhost).";
  if (!process.env.VIRTEC_API_KEY?.trim()) return "VIRTEC_API_KEY is not set.";
  return undefined;
}

export async function getVirtec(path: VirtecPath, fetcher: typeof fetch = fetch): Promise<unknown> {
  const key = process.env.VIRTEC_API_KEY?.trim();
  return requestVirtec("GET", path, key, undefined, fetcher);
}

/** Firestore-style ids only — never a path fragment. */
const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The only writes AgentOS can make to Virtec, each to one fixed route with a
 * body of known fields. Virtec enforces the same allow-list on its side.
 */
export type VirtecWrite =
  | { kind: "follow-up"; id: string; body: { status: "sent" | "dismissed" } | { status: "snoozed"; snoozedUntil: string } }
  | { kind: "lead"; id: string; body: { status: "new" | "reviewing" | "qualified" | "disqualified" } }
  | { kind: "inbound-lead"; id: string; body: { status: InboundLeadWriteStatus } }
  /** Publishes a lead magnet's signup email. The id is the magnet's slug. */
  | { kind: "magnet-email"; id: string; body: MagnetEmailWrite };

export interface MagnetEmailWrite {
  track: "virtara" | "jurivo";
  subject: string;
  body: string;
  readUrl: string;
  enabled: boolean;
}

/** What AgentOS may set on a website lead. `won` is decided in Virtec. */
export type InboundLeadWriteStatus = "reviewing" | "replied" | "not_a_fit" | "spam";

const WRITE_PATHS: Record<VirtecWrite["kind"], string> = {
  "follow-up": "/api/agentos/follow-ups/",
  lead: "/api/agentos/leads/",
  "inbound-lead": "/api/agentos/inbound-leads/",
  "magnet-email": "/api/agentos/lead-magnet-emails/",
};

export async function patchVirtec(write: VirtecWrite, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!DOC_ID.test(write.id)) throw new VirtecError("Not a Virtec record id.", "bad-response");
  if (!isVirtecWritable()) {
    throw new VirtecError("Write-back is off: VIRTEC_WRITE_API_KEY is not set (or equals the read key).", "not-configured");
  }

  const path = `${WRITE_PATHS[write.kind]}${write.id}`;
  // A magnet email is replaced whole; everything else changes one field.
  return requestVirtec(write.kind === "magnet-email" ? "PUT" : "PATCH", path, process.env.VIRTEC_WRITE_API_KEY?.trim(), write.body, fetcher);
}

async function requestVirtec(
  method: "GET" | "PATCH" | "PUT",
  path: string,
  key: string | undefined,
  body: unknown,
  fetcher: typeof fetch,
): Promise<unknown> {
  const base = virtecBaseUrl();
  if (!base || !key) throw new VirtecError(virtecConfigurationProblem() ?? "Virtec is not configured.", "not-configured");

  let response: Response;

  try {
    response = await fetcher(new URL(path, base), {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Never followed: a redirect could carry the Authorization header
      // somewhere else. Read instead, so the fix can be named.
      redirect: "manual",
    });
  } catch (error) {
    throw new VirtecError(networkFailure(error), "unavailable");
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    let target: string | undefined;
    try {
      // Origin only: a redirect target's path or query is not ours to repeat.
      target = location ? new URL(location, base).origin : undefined;
    } catch {
      target = undefined;
    }
    throw new VirtecError(
      target ? `Virtec redirects to ${target}. Set VIRTEC_BASE_URL to that address.` : `Virtec answered with a redirect (${response.status}).`,
      "redirected",
      response.status,
    );
  }

  // Virtec's own refusals are JSON. An HTML 401/403 came from something in
  // front of it — typically Vercel's Deployment Protection — before Virtec's
  // code ever saw the key.
  const html = (response.headers.get("content-type") ?? "").includes("text/html");
  if ((response.status === 401 || response.status === 403) && html) {
    throw new VirtecError(
      `A login page answered instead of Virtec (HTTP ${response.status}), likely Vercel Deployment Protection. Use the production domain, or turn protection off for /api/agentos.`,
      "unauthorized",
      response.status,
    );
  }
  if (response.status === 401) {
    throw new VirtecError(
      method === "GET"
        ? "Virtec refused the API key. VIRTEC_API_KEY here must equal AGENTOS_API_KEY there."
        : "Virtec refused the write key. VIRTEC_WRITE_API_KEY here must equal AGENTOS_WRITE_API_KEY there.",
      "unauthorized",
      401,
    );
  }
  if (response.status === 503) {
    throw new VirtecError(
      method === "GET"
        ? "Virtec has no AGENTOS_API_KEY configured on its side (redeploy after adding it)."
        : "Virtec's write API is off: AGENTOS_WRITE_API_KEY is missing there, or equals the read key (redeploy after fixing).",
      "not-configured",
      503,
    );
  }
  if (response.status === 404) {
    throw new VirtecError(
      method === "GET"
        ? "Virtec has no AgentOS API at this address (404): wrong domain, or not deployed yet."
        : "Virtec has no such record, or this deployment predates the write routes (404).",
      "unavailable",
      404,
    );
  }
  if (!response.ok) {
    // For writes, Virtec's own reason (a 409 "already sent", a 400 field
    // error) is the useful part. It is Virtec's message, never our key.
    const detail =
      method === "PATCH"
        ? await response.json().then(
            (json: unknown) => (typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined),
            () => undefined,
          )
        : undefined;
    throw new VirtecError(
      typeof detail === "string" ? `Virtec answered ${response.status}: ${detail.slice(0, 200)}` : `Virtec answered ${response.status}.`,
      "unavailable",
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    // Usually an HTML page: a login wall, a framework error page, or the wrong site.
    const type = response.headers.get("content-type") ?? "unknown";
    throw new VirtecError(`Virtec returned something that is not JSON (${type.split(";")[0]}).`, "bad-response", response.status);
  }
}
