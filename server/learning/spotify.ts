import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  SpotifyDevice,
  SpotifyLibrary,
  SpotifyPlayback,
  SpotifyPlaylist,
  SpotifyPlayRequest,
  SpotifyStatus,
  SpotifyTrack,
} from "../../shared/learning-types";
import { uiStateDir } from "../agentos/session-store";
import { authorize, isConnectorEnabled } from "../connectors/policy";

/**
 * Spotify, through its Web API, from the server.
 *
 * The same shape as Gmail: the browser is redirected to Spotify's consent
 * page and back, the server exchanges the code, and the refresh token lives
 * in one file outside the vault (mode 600). The browser never holds it. Every
 * call goes through the connector guard first, so switching Spotify off in
 * Connectors stops AgentOS contacting it.
 *
 * The one thing that reaches the browser is a short-lived *access* token, and
 * only for Spotify's own Web Playback SDK, which needs one to make AgentOS a
 * playback device. It is handed to the SDK's callback on request and never
 * kept in React state or storage.
 *
 * Playback control and in-app playback need Spotify Premium; that is
 * Spotify's rule, said plainly when it bites.
 */

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  // The Web Playback SDK needs these three to play inside AgentOS.
  "streaming",
  "user-read-email",
  "user-read-private",
];

export type SpotifyErrorCode = "not-configured" | "not-connected" | "off" | "premium-required" | "no-device" | "failed" | "offline";

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly code: SpotifyErrorCode,
    readonly status = code === "not-connected" || code === "not-configured" || code === "off" ? 409 : code === "premium-required" ? 403 : code === "no-device" ? 404 : 502,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

interface StoredSpotifyAuth {
  refreshToken: string;
  obtainedAt: string;
  scope?: string;
  account?: string;
  product?: string;
}

function authFile(): string {
  return path.join(uiStateDir(), "spotify-auth.json");
}

export function isSpotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim());
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new SpotifyError("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set. Add them in Connectors → Spotify.", "not-configured");
  }
  return { clientId, clientSecret };
}

/** Spotify allows loopback IPs (not `localhost`) as redirect URIs. Register exactly this address. */
export function spotifyRedirectUri(): string {
  const port = Number(process.env.AGENTOS_PORT ?? 8787);
  return `http://127.0.0.1:${port}/api/spotify/oauth/callback`;
}

async function readAuth(): Promise<StoredSpotifyAuth | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(authFile(), "utf8")) as StoredSpotifyAuth;
    return typeof parsed.refreshToken === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeAuth(auth: StoredSpotifyAuth): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const target = authFile();
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

export async function isSpotifyConnected(): Promise<boolean> {
  return (await readAuth()) !== undefined;
}

export async function disconnectSpotify(): Promise<void> {
  cachedToken = undefined;
  await fs.rm(authFile(), { force: true });
}

// ------------------------------------------------------------------- consent

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function loopbackOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Consent requests in flight: a random `state` each, so a callback can only
 * complete a connection this server started (no login CSRF), and the
 * loopback origin to send the browser back to.
 */
const pending = new Map<string, { origin?: string; expiresAt: number }>();

export function buildSpotifyConsentUrl(returnTo?: string): string {
  const { clientId } = credentials();
  const now = Date.now();
  for (const [key, entry] of pending) if (entry.expiresAt < now) pending.delete(key);

  const state = randomBytes(16).toString("hex");
  pending.set(state, { origin: loopbackOrigin(returnTo), expiresAt: now + 10 * 60_000 });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: spotifyRedirectUri(),
    scope: SPOTIFY_SCOPES.join(" "),
    state,
    show_dialog: "true",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Validates `state` and consumes it. Returns where to send the browser, or throws. */
export function consumeConsentState(state: string | undefined): { origin?: string } {
  const entry = state ? pending.get(state) : undefined;
  if (!state || !entry || entry.expiresAt < Date.now()) {
    throw new SpotifyError("That Spotify sign-in was not started here, or it expired. Start it again from Connectors.", "failed", 400);
  }
  pending.delete(state);
  return { origin: entry.origin };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { clientId, clientSecret } = credentials();
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SpotifyError("Couldn't reach Spotify.", "offline");
  }
  if (!response.ok) {
    if (body.get("grant_type") === "refresh_token") {
      // Revoked or expired: read as disconnected, not as a crash.
      await disconnectSpotify();
      throw new SpotifyError("Spotify's access has expired or been revoked. Connect Spotify again.", "not-connected");
    }
    throw new SpotifyError("Spotify rejected that sign-in.", "failed", 400);
  }
  return (await response.json()) as TokenResponse;
}

let cachedToken: { token: string; expiresAt: number } | undefined;

export async function completeSpotifyConnection(code: string): Promise<void> {
  const payload = await tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: spotifyRedirectUri() }),
  );
  if (!payload.refresh_token) throw new SpotifyError("Spotify did not return a refresh token. Try connecting again.", "failed");

  cachedToken = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  let account: string | undefined;
  let product: string | undefined;
  try {
    const me = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${payload.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const body = (await me.json()) as { display_name?: unknown; id?: unknown; product?: unknown };
    account = typeof body.display_name === "string" ? body.display_name : typeof body.id === "string" ? body.id : undefined;
    product = typeof body.product === "string" ? body.product : undefined;
  } catch {
    // The account name is a nicety; the connection stands without it.
  }

  await writeAuth({ refreshToken: payload.refresh_token, obtainedAt: new Date().toISOString(), scope: payload.scope, account, product });
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const stored = await readAuth();
  if (!stored) throw new SpotifyError("Spotify is not connected.", "not-connected");

  const payload = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken }));
  cachedToken = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  if (payload.refresh_token && payload.refresh_token !== stored.refreshToken) {
    await writeAuth({ ...stored, refreshToken: payload.refresh_token });
  }
  return cachedToken.token;
}

/** Test-only. */
export function resetSpotifyTokenCache(): void {
  cachedToken = undefined;
}

// ------------------------------------------------------------------- the API

export type SpotifyCapability = "spotify.read_playback" | "spotify.read_library" | "spotify.control_playback";

async function api<T>(capability: SpotifyCapability, pathAndQuery: string, init: RequestInit = {}, detail?: string): Promise<T | undefined> {
  const decision = authorize(capability, { initiator: "person", detail });
  if (!decision.allowed) throw new SpotifyError(decision.reason, "off");

  const send = async (token: string) =>
    fetch(`${API}${pathAndQuery}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

  let response: Response;
  try {
    response = await send(await accessToken());
    if (response.status === 401) {
      cachedToken = undefined;
      response = await send(await accessToken());
    }
  } catch (error) {
    if (error instanceof SpotifyError) throw error;
    throw new SpotifyError("Couldn't reach Spotify.", "offline");
  }

  if (response.status === 204 || response.status === 202) return undefined;
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const reason = (body as { error?: { reason?: string; message?: string } } | undefined)?.error;
    if (response.status === 403 && (reason?.reason === "PREMIUM_REQUIRED" || /premium/i.test(reason?.message ?? ""))) {
      throw new SpotifyError("Spotify only allows playback control with a Premium account.", "premium-required");
    }
    if (response.status === 404 && (reason?.reason === "NO_ACTIVE_DEVICE" || /device/i.test(reason?.message ?? ""))) {
      throw new SpotifyError("No Spotify device is active. Start playing on a device, or choose Play in AgentOS.", "no-device");
    }
    throw new SpotifyError(`Spotify said: ${reason?.message ?? `error ${response.status}`}.`, "failed");
  }
  return body as T;
}

// ----------------------------------------------------------- shapes (pure)

interface RawImage {
  url?: string;
  width?: number | null;
}
interface RawItem {
  uri?: string;
  name?: string;
  type?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: RawImage[] };
  show?: { name?: string; publisher?: string; images?: RawImage[] };
  images?: RawImage[];
}

function pickImage(images: RawImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  // Smallest image at least 64px wide: enough for a mini-player, cheap to load.
  const sorted = [...images].filter((image) => image.url).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((image) => (image.width ?? 0) >= 64) ?? sorted.at(-1))?.url;
}

export function toTrack(item: RawItem | null | undefined): SpotifyTrack | undefined {
  if (!item?.uri || !item.name) return undefined;
  const episode = item.type === "episode";
  return {
    uri: item.uri,
    name: item.name,
    artists: episode ? [item.show?.publisher ?? item.show?.name ?? ""].filter(Boolean) : (item.artists ?? []).flatMap((artist) => (artist.name ? [artist.name] : [])),
    album: episode ? item.show?.name : item.album?.name,
    imageUrl: pickImage(episode ? (item.images ?? item.show?.images) : item.album?.images),
    durationMs: item.duration_ms ?? 0,
    type: item.type ?? "track",
  };
}

interface RawDevice {
  id?: string | null;
  name?: string;
  type?: string;
  is_active?: boolean;
  volume_percent?: number | null;
}

export function toDevice(device: RawDevice | null | undefined): SpotifyDevice | undefined {
  if (!device?.id) return undefined;
  return {
    id: device.id,
    name: device.name ?? "Device",
    type: device.type ?? "Unknown",
    active: Boolean(device.is_active),
    volumePercent: typeof device.volume_percent === "number" ? device.volume_percent : undefined,
  };
}

export function toPlayback(raw: { is_playing?: boolean; progress_ms?: number | null; item?: RawItem | null; device?: RawDevice; context?: { uri?: string } | null } | undefined, now = new Date()): SpotifyPlayback | undefined {
  if (!raw) return undefined;
  return {
    isPlaying: Boolean(raw.is_playing),
    progressMs: raw.progress_ms ?? 0,
    track: toTrack(raw.item),
    device: toDevice(raw.device),
    contextUri: raw.context?.uri ?? undefined,
    readAt: now.toISOString(),
  };
}

// ------------------------------------------------------------------ actions

export async function spotifyStatus(): Promise<SpotifyStatus> {
  const configured = isSpotifyConfigured();
  const stored = await readAuth();
  const enabled = isConnectorEnabled("spotify");
  return {
    configured,
    connected: Boolean(stored),
    enabled,
    account: stored?.account,
    premium: stored?.product ? stored.product === "premium" : undefined,
    detail: !configured
      ? "Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Connectors → Spotify."
      : !stored
        ? "Not signed in to Spotify."
        : !enabled
          ? "Spotify is switched off in Connectors."
          : undefined,
  };
}

export async function getPlayback(): Promise<SpotifyPlayback | undefined> {
  const raw = await api<Parameters<typeof toPlayback>[0]>("spotify.read_playback", "/me/player?additional_types=episode");
  return toPlayback(raw);
}

export async function getDevices(): Promise<SpotifyDevice[]> {
  const raw = await api<{ devices?: RawDevice[] }>("spotify.read_playback", "/me/player/devices");
  return (raw?.devices ?? []).flatMap((device) => toDevice(device) ?? []);
}

export async function getPlaylists(): Promise<SpotifyPlaylist[]> {
  const raw = await api<{ items?: Array<{ id?: string; uri?: string; name?: string; images?: RawImage[] | null; tracks?: { total?: number }; owner?: { display_name?: string } }> }>(
    "spotify.read_library",
    "/me/playlists?limit=50",
  );
  return (raw?.items ?? []).flatMap((item) =>
    item?.id && item.uri && item.name
      ? [{ id: item.id, uri: item.uri, name: item.name, imageUrl: pickImage(item.images ?? undefined), trackCount: item.tracks?.total, owner: item.owner?.display_name }]
      : [],
  );
}

export async function getLibrary(): Promise<SpotifyLibrary> {
  const [saved, recent] = await Promise.all([
    api<{ items?: Array<{ track?: RawItem }> }>("spotify.read_library", "/me/tracks?limit=20"),
    api<{ items?: Array<{ track?: RawItem; played_at?: string }> }>("spotify.read_library", "/me/player/recently-played?limit=20"),
  ]);
  return {
    saved: (saved?.items ?? []).flatMap((item) => toTrack(item.track) ?? []),
    recent: (recent?.items ?? []).flatMap((item) => {
      const track = toTrack(item.track);
      return track && item.played_at ? [{ ...track, playedAt: item.played_at }] : [];
    }),
  };
}

function deviceQuery(deviceId: string | undefined): string {
  return deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
}

export async function play(request: SpotifyPlayRequest): Promise<void> {
  const body: Record<string, unknown> = {};
  if (request.contextUri) body.context_uri = request.contextUri;
  if (request.uris?.length) body.uris = request.uris;
  if (request.positionMs !== undefined) body.position_ms = request.positionMs;
  await api("spotify.control_playback", `/me/player/play${deviceQuery(request.deviceId)}`, {
    method: "PUT",
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  }, "play");
}

export async function pause(): Promise<void> {
  await api("spotify.control_playback", "/me/player/pause", { method: "PUT" }, "pause");
}

export async function skip(direction: "next" | "previous"): Promise<void> {
  await api("spotify.control_playback", `/me/player/${direction}`, { method: "POST" }, direction);
}

export async function seek(positionMs: number): Promise<void> {
  await api("spotify.control_playback", `/me/player/seek?position_ms=${Math.max(0, Math.floor(positionMs))}`, { method: "PUT" }, "seek");
}

export async function setVolume(percent: number): Promise<void> {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  await api("spotify.control_playback", `/me/player/volume?volume_percent=${value}`, { method: "PUT" }, "volume");
}

export async function transfer(deviceId: string, playNow: boolean): Promise<void> {
  await api("spotify.control_playback", "/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: playNow }) }, "transfer");
}

/**
 * A short-lived access token for the Web Playback SDK only. Requires the
 * control capability: a token is as good as the controls.
 */
export async function sdkToken(): Promise<{ accessToken: string; expiresAt: string }> {
  const decision = authorize("spotify.control_playback", { initiator: "person", detail: "in-app player" });
  if (!decision.allowed) throw new SpotifyError(decision.reason, "off");
  const token = await accessToken();
  return { accessToken: token, expiresAt: new Date(cachedToken?.expiresAt ?? Date.now()).toISOString() };
}

/** The connection test: one read-only request. */
export async function testSpotify(): Promise<{ ok: boolean; detail: string; account?: string }> {
  const stored = await readAuth();
  if (!stored) return { ok: false, detail: "Not signed in." };
  try {
    await accessToken();
    return { ok: true, detail: stored.product === "premium" ? "Token refreshed. Premium: playback control available." : "Token refreshed. Playback control needs Premium.", account: stored.account };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "The test failed." };
  }
}
