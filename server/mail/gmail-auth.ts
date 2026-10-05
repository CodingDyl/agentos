import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFailureReason } from "../../shared/agentos-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Gmail OAuth, kept to one file.
 *
 * The refresh token is the only secret this module stores, and it never
 * leaves this process — the browser is only ever redirected, never handed
 * the token itself.
 *
 * Access is `gmail.modify`: read, change labels (mark read, Business and
 * Virtara tags), move to Trash, and send or draft mail a person wrote in the
 * Inbox and pressed Send on. It cannot permanently delete mail. A
 * connection made under the older read-only grant keeps working for reading
 * and reports `canModifyGmail() === false` until the person reconnects.
 *
 * The same connection also carries `calendar.readonly`, so Today can show
 * the day's events. Read-only: AgentOS never creates or changes an event.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export class GmailAuthError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "GmailAuthError";
  }
}

function authFile(): string {
  return path.join(uiStateDir(), "mail-auth.json");
}

interface StoredMailAuth {
  refreshToken: string;
  obtainedAt: string;
  /** Space-separated scopes Google actually granted. Absent on connections made before this was recorded (read-only). */
  scope?: string;
}

export function isGmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function requireClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new GmailAuthError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Copy .env.example to .env and add them.",
      "not-configured",
    );
  }

  return { clientId, clientSecret };
}

/** The Express server's own address — where Google is told to send the browser back. */
function redirectUri(): string {
  const port = Number(process.env.AGENTOS_PORT ?? 8787);
  return `http://127.0.0.1:${port}/api/mail/oauth/callback`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The web app's origin to return to after consent, or undefined when
 * `value` isn't a loopback http origin. Only loopback is accepted, so the
 * OAuth `state` round trip can never be turned into an open redirect.
 */
export function loopbackOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the browser is sent to grant Gmail access. `returnOrigin` rides
 * through Google in `state` so the callback lands back on the exact address
 * the person started from — Vite may be listening on `localhost`/`[::1]`
 * only, where a hard-coded `127.0.0.1` is refused.
 */
export function buildConsentUrl(returnOrigin?: string): string {
  const { clientId } = requireClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `${GMAIL_SCOPE} ${CALENDAR_SCOPE}`,
    access_type: "offline",
    // Forces Google to hand back a refresh token on every connect, even for
    // an account that has consented before.
    prompt: "consent",
  });
  const origin = loopbackOrigin(returnOrigin);
  if (origin) params.set("state", origin);

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function readStoredAuth(): Promise<StoredMailAuth | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(authFile(), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredMailAuth).refreshToken === "string"
    ) {
      return parsed as StoredMailAuth;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function writeStoredAuth(auth: StoredMailAuth): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const target = authFile();
  const temporaryFile = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, target);
}

export async function isGmailConnected(): Promise<boolean> {
  return (await readStoredAuth()) !== undefined;
}

async function hasGrantedScope(scope: string): Promise<boolean> {
  const stored = await readStoredAuth();
  return Boolean(stored?.scope?.split(" ").includes(scope));
}

/** Whether the stored grant covers marking read and moving to Trash. */
export function canModifyGmail(): Promise<boolean> {
  return hasGrantedScope(GMAIL_SCOPE);
}

/** Whether the stored grant covers reading the calendar. */
export function canReadCalendar(): Promise<boolean> {
  return hasGrantedScope(CALENDAR_SCOPE);
}

export async function disconnectGmail(): Promise<void> {
  try {
    await fs.unlink(authFile());
  } catch {
    // Already disconnected.
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** Exchanges a consent code for tokens and stores the refresh token. */
export async function completeGmailConnection(code: string): Promise<void> {
  const { clientId, clientSecret } = requireClientCredentials();

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
  } catch {
    throw new GmailAuthError("Could not reach Google to complete the Gmail connection.", "offline");
  }

  if (!response.ok) {
    throw new GmailAuthError("Google rejected that authorization code.", "unauthorized");
  }

  const payload = (await response.json()) as TokenResponse;

  if (!payload.refresh_token) {
    throw new GmailAuthError(
      "Google did not return a refresh token. Disconnect and reconnect to force a fresh consent.",
      "failed",
    );
  }

  await writeStoredAuth({
    refreshToken: payload.refresh_token,
    obtainedAt: new Date().toISOString(),
    scope: payload.scope,
  });
  cachedAccessToken = undefined;
}

let cachedAccessToken: { token: string; expiresAt: number } | undefined;

/** A fresh access token, minted from the stored refresh token. Cached until near-expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }

  const stored = await readStoredAuth();
  if (!stored) {
    throw new GmailAuthError("Gmail is not connected.", "unauthorized");
  }

  const { clientId, clientSecret } = requireClientCredentials();

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: stored.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GmailAuthError("Could not reach Google to refresh the Gmail token.", "offline");
  }

  if (!response.ok) {
    // A revoked or expired refresh token reads as disconnected, not a crash.
    await disconnectGmail();
    throw new GmailAuthError("Gmail's access has expired or been revoked. Reconnect Gmail.", "unauthorized");
  }

  const payload = (await response.json()) as TokenResponse;
  cachedAccessToken = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return cachedAccessToken.token;
}

/** Test-only: clears the in-memory access-token cache between cases. */
export function resetAccessTokenCache(): void {
  cachedAccessToken = undefined;
}
