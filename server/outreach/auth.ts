import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";
import { getAccessToken as getPrimaryAccessToken, isGmailConnected as isPrimaryConnected, loopbackOrigin } from "../mail/gmail-auth";

/**
 * The outreach mailbox's connection.
 *
 * A second Google account, kept apart from the inbox AgentOS reads:
 *
 * - its own token file (`outreach-auth.json`), so disconnecting one never
 *   touches the other and neither can be mistaken for the other;
 * - its own narrow grant: `gmail.compose` (drafts and sending) and
 *   `gmail.readonly` (to see who replied). No `gmail.modify`, so it cannot
 *   trash, relabel or delete anything;
 * - a refusal to connect the same account as the main inbox, because the
 *   point of a separate mailbox is that cold mail never runs through the one
 *   that matters.
 *
 * The main inbox code (`server/mail`) never imports this module, so it cannot
 * gain the power to send. This module reads the main connection in one place
 * only: to compare addresses.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

export const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** `state` marks a consent as the outreach one; the shared callback tells the two apart by it. */
export const OUTREACH_STATE_PREFIX = "outreach|";

export class OutreachAuthError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "unauthorized" | "offline" | "failed" | "same-account" | "scope",
  ) {
    super(message);
    this.name = "OutreachAuthError";
  }
}

interface StoredOutreachAuth {
  refreshToken: string;
  address: string;
  obtainedAt: string;
  scope?: string;
}

function authFile(): string {
  return path.join(uiStateDir(), "outreach-auth.json");
}

export function isOutreachConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new OutreachAuthError("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.", "not-configured");
  return { clientId, clientSecret };
}

/** The same address the inbox connection registered with Google, so no second redirect needs adding. */
function redirectUri(): string {
  return `http://127.0.0.1:${Number(process.env.AGENTOS_PORT ?? 8787)}/api/mail/oauth/callback`;
}

/** The address the shared callback should treat as an outreach consent, and where to send the browser after. */
export function parseOutreachState(state: string | undefined): { origin?: string } | undefined {
  if (!state?.startsWith(OUTREACH_STATE_PREFIX)) return undefined;
  return { origin: loopbackOrigin(state.slice(OUTREACH_STATE_PREFIX.length)) };
}

export function buildOutreachConsentUrl(returnOrigin?: string): string {
  const { clientId } = credentials();
  const origin = loopbackOrigin(returnOrigin);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `${COMPOSE_SCOPE} ${READ_SCOPE}`,
    access_type: "offline",
    // The account chooser matters here: the browser is usually signed in to
    // the main mailbox, and Google would otherwise pick it without asking.
    prompt: "consent select_account",
    state: `${OUTREACH_STATE_PREFIX}${origin ?? ""}`,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function readStored(): Promise<StoredOutreachAuth | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(authFile(), "utf8"));
    const value = parsed as Partial<StoredOutreachAuth>;
    return typeof value.refreshToken === "string" && typeof value.address === "string" ? (value as StoredOutreachAuth) : undefined;
  } catch {
    return undefined;
  }
}

async function writeStored(auth: StoredOutreachAuth): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const target = authFile();
  const temporary = `${target}.${process.pid}.tmp`;
  // Owner-only: the refresh token is a credential for sending mail.
  await fs.writeFile(temporary, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

export async function outreachAddress(): Promise<string | undefined> {
  return (await readStored())?.address;
}

export async function isOutreachConnected(): Promise<boolean> {
  return (await readStored()) !== undefined;
}

export async function disconnectOutreach(): Promise<void> {
  cached = undefined;
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

async function profileAddress(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(PROFILE_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { emailAddress?: unknown };
    return typeof body.emailAddress === "string" ? body.emailAddress.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** The main inbox's address, when it is connected and answers; otherwise unknown. */
async function mainInboxAddress(): Promise<string | undefined> {
  try {
    return (await isPrimaryConnected()) ? await profileAddress(await getPrimaryAccessToken()) : undefined;
  } catch {
    return undefined;
  }
}

/** True when the granted scopes cover what outreach needs. */
export function grantsOutreachScopes(scope: string | undefined): boolean {
  const granted = new Set((scope ?? "").split(" "));
  return granted.has(COMPOSE_SCOPE) && granted.has(READ_SCOPE);
}

/**
 * Exchanges the consent code and stores the connection, unless it is wrong.
 *
 * Refused (and nothing stored) when the account is the main inbox, or when
 * the person unticked a permission Google offered.
 */
export async function completeOutreachConnection(code: string): Promise<{ address: string }> {
  const { clientId, clientSecret } = credentials();

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" }),
    });
  } catch {
    throw new OutreachAuthError("Could not reach Google to connect the outreach mailbox.", "offline");
  }
  if (!response.ok) throw new OutreachAuthError("Google rejected that authorization code.", "unauthorized");

  const payload = (await response.json()) as TokenResponse;
  if (!payload.refresh_token) throw new OutreachAuthError("Google did not return a refresh token. Try connecting again.", "failed");

  if (!grantsOutreachScopes(payload.scope)) {
    throw new OutreachAuthError("Both permissions are needed (write emails, and read replies). Connect again and leave both ticked.", "scope");
  }

  const address = await profileAddress(payload.access_token);
  if (!address) throw new OutreachAuthError("Google connected, but the mailbox's address could not be read.", "failed");

  if (address === (await mainInboxAddress())) {
    throw new OutreachAuthError(
      `${address} is your main inbox. Outreach goes from a separate mailbox: connect a different account, and choose it in Google's account list.`,
      "same-account",
    );
  }

  await writeStored({ refreshToken: payload.refresh_token, address, obtainedAt: new Date().toISOString(), scope: payload.scope });
  cached = undefined;
  return { address };
}

let cached: { token: string; expiresAt: number } | undefined;

/** A fresh access token for the outreach mailbox, minted from its own refresh token. */
export async function getOutreachAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const stored = await readStored();
  if (!stored) throw new OutreachAuthError("The outreach mailbox is not connected.", "unauthorized");

  const { clientId, clientSecret } = credentials();
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: stored.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }),
    });
  } catch {
    throw new OutreachAuthError("Could not reach Google to refresh the outreach mailbox's access.", "offline");
  }

  if (!response.ok) {
    await disconnectOutreach();
    throw new OutreachAuthError("The outreach mailbox's access expired or was revoked. Reconnect it.", "unauthorized");
  }

  const payload = (await response.json()) as TokenResponse;
  cached = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return cached.token;
}

/** Test-only. */
export function resetOutreachTokenCache(): void {
  cached = undefined;
}
