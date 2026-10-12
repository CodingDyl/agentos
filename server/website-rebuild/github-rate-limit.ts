/**
 * GitHub (and Vercel-via-GitHub) rate limits.
 *
 * Secondary limits come back as 403 with a "secondary rate limit" message, or
 * as 429. Automatic retries keep the limit from recovering, so those stop
 * here and tell the person when to retry. Transient 5xx answers still back
 * off with jitter.
 */

export type HeaderMap = { get(name: string): string | null };

export function bodyMessage(body: unknown): string {
  if (typeof body === "string") return body;
  if (typeof body === "object" && body) {
    if ("message" in body && typeof (body as { message: unknown }).message === "string") {
      return (body as { message: string }).message;
    }
    const nested = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof nested === "string") return nested;
  }
  return "";
}

export function isRateLimitText(text: string): boolean {
  return /rate limit|secondary rate|too many requests|abuse detection/i.test(text);
}

export function isGithubRateLimited(status: number, body: unknown): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return isRateLimitText(bodyMessage(body));
}

export function retryAfterMs(headers: HeaderMap, now = Date.now()): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset) {
    const unix = Number(reset);
    if (Number.isFinite(unix)) return Math.max(0, unix * 1000 - now);
  }
  return undefined;
}

export function formatRetryAfter(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function githubRateLimitMessage(waitMs?: number): string {
  return `GitHub rate-limited, retry after ${waitMs != null ? formatRetryAfter(waitMs) : "a few minutes"}.`;
}

export function backoffDelayMs(
  attempt: number,
  options: { retryAfterMs?: number; random?: () => number; baseMs?: number; maxMs?: number } = {},
): number {
  if (options.retryAfterMs != null && options.retryAfterMs > 0) return options.retryAfterMs;
  const base = options.baseMs ?? 1_000;
  const max = options.maxMs ?? 60_000;
  const random = options.random ?? Math.random;
  const cap = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(random() * cap);
}

export type GithubCallDecision =
  | { action: "ok" }
  | { action: "rate-limited"; retryAfterMs?: number; message: string }
  | { action: "auth"; message: string }
  | { action: "retry"; waitMs: number }
  | { action: "error"; message: string };

export function decideGithubCall(input: {
  status: number;
  body: unknown;
  headers: HeaderMap;
  attempt: number;
  maxAttempts?: number;
  random?: () => number;
  now?: number;
}): GithubCallDecision {
  const { status, body, headers, attempt } = input;
  const maxAttempts = input.maxAttempts ?? 4;
  const now = input.now ?? Date.now();
  const wait = retryAfterMs(headers, now);

  if (status >= 200 && status < 300) return { action: "ok" };

  if (isGithubRateLimited(status, body)) {
    return { action: "rate-limited", retryAfterMs: wait, message: githubRateLimitMessage(wait) };
  }

  if (status === 401 || status === 403) {
    return { action: "auth", message: bodyMessage(body) || `refused the token (${status})` };
  }

  if (status >= 500 && attempt < maxAttempts) {
    return { action: "retry", waitMs: backoffDelayMs(attempt, { retryAfterMs: wait, random: input.random }) };
  }

  return { action: "error", message: bodyMessage(body) || `status ${status}` };
}
