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
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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

/** Where the browser is sent to grant read-only Gmail access. */
export function buildConsentUrl(): string {
  const { clientId } = requireClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    // Forces Google to hand back a refresh token on every connect, even for
    // an account that has consented before.
    prompt: "consent",
  });

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

  await writeStoredAuth({ refreshToken: payload.refresh_token, obtainedAt: new Date().toISOString() });
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
