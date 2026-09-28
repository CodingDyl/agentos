/**
 * The only place the Virtec API key exists.
 *
 * `VIRTEC_BASE_URL` is the Virtec deployment (e.g. `https://crm.virtara.co.za`)
 * and `VIRTEC_API_KEY` is the value Virtec holds as `AGENTOS_API_KEY`. Both are
 * read by the Node server only. The key is attached to requests here and
 * nowhere else — it never reaches a response, an error message or a log line.
 *
 * GET only. Virtec exposes no write API to AgentOS, and this client could not
 * use one if it did.
 */

const REQUEST_TIMEOUT_MS = 15_000;

/** Every path this client may request. Nothing from a request is ever appended. */
export const VIRTEC_PATHS = {
  leads: "/api/agentos/leads?limit=500",
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
    readonly reason: "not-configured" | "unauthorized" | "unavailable" | "bad-response",
  ) {
    super(message);
    this.name = "VirtecError";
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

/** Why Virtec cannot be used, in words a person can act on. Never mentions the key's value. */
export function virtecConfigurationProblem(): string | undefined {
  if (!process.env.VIRTEC_BASE_URL?.trim()) return "VIRTEC_BASE_URL is not set.";
  if (!virtecBaseUrl()) return "VIRTEC_BASE_URL must be an https:// address (http:// only for localhost).";
  if (!process.env.VIRTEC_API_KEY?.trim()) return "VIRTEC_API_KEY is not set.";
  return undefined;
}

export async function getVirtec(path: VirtecPath, fetcher: typeof fetch = fetch): Promise<unknown> {
  const base = virtecBaseUrl();
  const key = process.env.VIRTEC_API_KEY?.trim();
  if (!base || !key) throw new VirtecError(virtecConfigurationProblem() ?? "Virtec is not configured.", "not-configured");

  let response: Response;

  try {
    response = await fetcher(new URL(path, base), {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // A redirect could carry the Authorization header somewhere else.
      redirect: "error",
    });
  } catch {
    throw new VirtecError("Virtec did not answer.", "unavailable");
  }

  if (response.status === 401) throw new VirtecError("Virtec refused the API key.", "unauthorized");
  if (response.status === 503) throw new VirtecError("Virtec has no AGENTOS_API_KEY configured on its side.", "not-configured");
  if (!response.ok) throw new VirtecError(`Virtec answered ${response.status}.`, "unavailable");

  try {
    return await response.json();
  } catch {
    throw new VirtecError("Virtec returned something that is not JSON.", "bad-response");
  }
}
