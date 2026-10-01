/**
 * YouTube, by reference only.
 *
 * A pasted address becomes a video id; the id becomes an embed and a link
 * back. Title, channel and thumbnail come from YouTube's public oEmbed
 * endpoint — no API key, no scraping — and the video itself is only ever
 * played through YouTube's own embedded player. Nothing is downloaded.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

export interface ParsedYouTubeUrl {
  videoId: string;
  /** A `t=` / `start=` in the address, in seconds. */
  startSeconds?: number;
}

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds. */
export function parseTimeParam(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || match[0] === "") return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** A YouTube address (or a bare id) as a video id, or `undefined` if it isn't one. */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | undefined {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return { videoId: text };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

  const host = url.hostname.toLowerCase();
  const startSeconds = parseTimeParam(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | undefined;

  if (host === "youtu.be") videoId = segments[0];
  else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") videoId = url.searchParams.get("v") ?? undefined;
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) videoId = segments[1];
  }

  return videoId && VIDEO_ID.test(videoId) ? { videoId, startSeconds } : undefined;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export interface YouTubeMetadata {
  title: string;
  author?: string;
  thumbnailUrl?: string;
}

/**
 * Title and channel from oEmbed. A fixed host, a short timeout, a capped
 * response; on any failure the video is still saved, named by its id.
 */
export async function fetchYouTubeMetadata(videoId: string, fetcher: typeof fetch = fetch): Promise<YouTubeMetadata> {
  const fallback: YouTubeMetadata = { title: `YouTube video ${videoId}`, thumbnailUrl: thumbnailUrl(videoId) };
  try {
    const response = await fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`, {
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return fallback;
    const text = await response.text();
    if (text.length > 50_000) return fallback;
    const body = JSON.parse(text) as { title?: unknown; author_name?: unknown };
    return {
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 300) : fallback.title,
      author: typeof body.author_name === "string" ? body.author_name.slice(0, 200) : undefined,
      // Always the canonical thumbnail host, whatever oEmbed says.
      thumbnailUrl: thumbnailUrl(videoId),
    };
  } catch {
    return fallback;
  }
}
