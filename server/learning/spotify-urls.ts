/**
 * Spotify addresses, read without signing in.
 *
 * `open.spotify.com/track/<id>` and `spotify:track:<id>` both become the URI
 * the Web API and the player use. Titles come from Spotify's public oEmbed
 * endpoint, so saving a track to the library works before Spotify is
 * connected.
 */

const SPOTIFY_TYPES = new Set(["track", "episode", "album", "playlist", "show", "artist"]);

export interface ParsedSpotifyUrl {
  type: string;
  id: string;
  uri: string;
}

export function parseSpotifyUrl(input: string): ParsedSpotifyUrl | undefined {
  const text = input.trim();
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]{10,40})$/.exec(text);
  if (uri && SPOTIFY_TYPES.has(uri[1])) return { type: uri[1], id: uri[2], uri: text };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== "open.spotify.com") return undefined;

  // `/intl-de/track/<id>` carries a locale segment first.
  const segments = url.pathname.split("/").filter((segment) => segment && !segment.startsWith("intl-"));
  const [type, id] = segments;
  if (!type || !id || !SPOTIFY_TYPES.has(type) || !/^[A-Za-z0-9]{10,40}$/.test(id)) return undefined;
  return { type, id, uri: `spotify:${type}:${id}` };
}

export function spotifyOpenUrl(parsed: { type: string; id: string }): string {
  return `https://open.spotify.com/${parsed.type}/${parsed.id}`;
}

export async function fetchSpotifyMetadata(
  parsed: ParsedSpotifyUrl,
  fetcher: typeof fetch = fetch,
): Promise<{ title: string; author?: string; thumbnailUrl?: string }> {
  const fallback = { title: `Spotify ${parsed.type}` };
  try {
    const response = await fetcher(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyOpenUrl(parsed))}`, {
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return fallback;
    const text = await response.text();
    if (text.length > 50_000) return fallback;
    const body = JSON.parse(text) as { title?: unknown; thumbnail_url?: unknown };
    const thumbnail = typeof body.thumbnail_url === "string" && /^https:\/\/[a-z0-9.-]*(scdn\.co|spotifycdn\.com)\//i.test(body.thumbnail_url) ? body.thumbnail_url : undefined;
    return {
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 300) : fallback.title,
      thumbnailUrl: thumbnail,
    };
  } catch {
    return fallback;
  }
}
