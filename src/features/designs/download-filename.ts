/**
 * The name a Creative download is saved under.
 *
 * `<title-or-prompt-slug>-<date>.<ext>`: a folder of these is readable without
 * opening each file. The stem is the title when there is one, otherwise the
 * prompt; the date is the day the asset was made; the extension is the real
 * file's, never the thumbnail's.
 */

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const KNOWN_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "mp4", "mov", "webm"]);

const MAX_SLUG = 60;

export function slugifyFilenamePart(text: string, fallback = "download"): string {
  const withoutExt = text.replace(/\.[a-z0-9]{2,5}$/i, "");
  const cleaned = withoutExt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");

  return cleaned || fallback;
}

function extensionFromName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const match = name.toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|\?)/);
  const ext = match?.[1];
  if (!ext || !KNOWN_EXT.has(ext)) return undefined;
  return ext === "jpeg" ? "jpg" : ext;
}

function extensionFromMime(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  return MIME_TO_EXT[mimeType.split(";")[0].trim().toLowerCase()];
}

function extensionFromDataUrl(url: string | undefined): string | undefined {
  const match = url?.match(/^data:([^;,]+)/i);
  return match ? extensionFromMime(match[1]) : undefined;
}

export function extensionFromSource(input: {
  url?: string;
  mimeType?: string;
  filename?: string;
}): string {
  return (
    extensionFromName(input.filename) ??
    extensionFromName(input.url?.split("?")[0]) ??
    extensionFromDataUrl(input.url) ??
    extensionFromMime(input.mimeType) ??
    "png"
  );
}

function dayStamp(date: string | Date | undefined, now: Date): string {
  const parsed = date === undefined ? now : date instanceof Date ? date : new Date(date);
  const valid = Number.isNaN(parsed.getTime()) ? now : parsed;
  return valid.toISOString().slice(0, 10);
}

export interface DownloadFilenameInput {
  title?: string;
  prompt?: string;
  date?: string | Date;
  url?: string;
  mimeType?: string;
  filename?: string;
  /** Injected in tests so "today" is deterministic. */
  now?: Date;
}

export function downloadFilename(input: DownloadFilenameInput): string {
  const stem = slugifyFilenamePart(input.title || input.prompt || input.filename || "", "download");
  const date = dayStamp(input.date, input.now ?? new Date());
  const ext = extensionFromSource(input);
  return `${stem}-${date}.${ext}`;
}
