import type { DesignAsset } from "@shared/agentos-types";
import { isTauri } from "@/lib/tauri-utils";
import { downloadFilename, type DownloadFilenameInput } from "./download-filename";
import { buildZip, uniqueZipName } from "./download-zip";

/**
 * Fetch a Creative file and save it.
 *
 * Local AgentOS URLs are same-origin (Vite proxies `/api` on localhost:1420),
 * so they come back as a blob. Remote URLs try the same, then fall back to a
 * new tab if CORS blocks the read. Data URLs are decoded in place. In Tauri
 * the save dialog chooses the path and the filesystem plugin writes the bytes.
 */

export interface DownloadSource extends DownloadFilenameInput {
  url: string;
}

export class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelledError";
  }
}

export class OpenedInTabError extends Error {
  constructor() {
    super("Opened in a new tab because the file could not be fetched.");
    this.name = "OpenedInTabError";
  }
}

export interface ByteProgress {
  received: number;
  total?: number;
}

export function sourceFromAsset(asset: Pick<DesignAsset, "url" | "filename" | "prompt" | "createdAt">): DownloadSource {
  return {
    url: asset.url,
    title: asset.filename,
    prompt: asset.prompt,
    date: asset.createdAt,
    filename: asset.filename,
  };
}

export function originalMediaUrl(url: string): string {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;

  try {
    const parsed = new URL(url, "http://agentos.local");
    if (parsed.searchParams.get("size") === "thumbnail") parsed.searchParams.delete("size");
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    if (url.startsWith("/") || parsed.hostname === "agentos.local") return pathAndQuery;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function isRemoteHttpUrl(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) return false;

  try {
    const parsed = new URL(url);
    if (typeof window !== "undefined" && parsed.origin === window.location.origin) return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function decodeDataUrl(url: string): { data: Uint8Array; mimeType: string } {
  const match = url.match(/^data:([^;,]+)?((?:;[^,]*)*),([\s\S]*)$/);
  if (!match) throw new Error("That data URL could not be read.");

  const mimeType = match[1] || "application/octet-stream";
  const payload = match[3] ?? "";

  if ((match[2] ?? "").includes(";base64")) {
    const binary = atob(payload);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
    return { data, mimeType };
  }

  return { data: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
}

async function readBody(
  response: Response,
  onProgress?: (progress: ByteProgress) => void,
): Promise<Uint8Array> {
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : undefined;
  const length = total !== undefined && Number.isFinite(total) ? total : undefined;

  if (!response.body || !onProgress) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress({ received, total: length });
  }

  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function fetchBytes(
  url: string,
  onProgress?: (progress: ByteProgress) => void,
): Promise<{ data: Uint8Array; mimeType?: string }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("That file could not be downloaded.");
  }

  return {
    data: await readBody(response, onProgress),
    mimeType: response.headers.get("content-type")?.split(";")[0].trim() || undefined,
  };
}

export async function loadDownloadBytes(
  source: DownloadSource,
  onProgress?: (progress: ByteProgress) => void,
): Promise<{ data: Uint8Array; mimeType?: string; filename: string }> {
  const url = originalMediaUrl(source.url);

  if (url.startsWith("data:")) {
    const decoded = decodeDataUrl(url);
    const filename = downloadFilename({ ...source, mimeType: decoded.mimeType });
    return { ...decoded, filename };
  }

  try {
    const fetched = await fetchBytes(url, onProgress);
    const filename = downloadFilename({ ...source, mimeType: source.mimeType ?? fetched.mimeType });
    return { ...fetched, filename };
  } catch (error) {
    if (isRemoteHttpUrl(url) && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener");
      throw new OpenedInTabError();
    }
    throw error instanceof Error ? error : new Error("That file could not be downloaded.");
  }
}

async function saveBytes(data: Uint8Array, filename: string, mimeType: string): Promise<void> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const ext = filename.split(".").pop() ?? "png";
    const chosen = await save({
      defaultPath: filename,
      title: "Save",
      filters: [{ name: "Media", extensions: [ext] }],
    });
    if (!chosen) throw new DownloadCancelledError();
    await writeFile(chosen, data);
    return;
  }

  const bytes = new Uint8Array(data);
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
}

export async function downloadMedia(
  source: DownloadSource,
  onProgress?: (progress: ByteProgress) => void,
): Promise<string> {
  const loaded = await loadDownloadBytes(source, onProgress);
  await saveBytes(loaded.data, loaded.filename, loaded.mimeType ?? "application/octet-stream");
  return loaded.filename;
}

export async function downloadMediaZip(
  sources: readonly DownloadSource[],
  onProgress?: (current: number, total: number, filename: string) => void,
): Promise<string> {
  if (sources.length === 0) throw new Error("Nothing selected to download.");

  const used = new Set<string>();
  const entries: { name: string; data: Uint8Array }[] = [];

  for (const [index, source] of sources.entries()) {
    const loaded = await loadDownloadBytes(source);
    const name = uniqueZipName(loaded.filename, used);
    onProgress?.(index + 1, sources.length, name);
    entries.push({ name, data: loaded.data });
  }

  const archiveName = `creative-selected-${new Date().toISOString().slice(0, 10)}.zip`;
  await saveBytes(buildZip(entries), archiveName, "application/zip");
  return archiveName;
}
