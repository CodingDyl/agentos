import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findOnPath } from "../ai-stack/detect";
import { watchUrl } from "../learning/youtube";

/**
 * A video's transcript, from its captions.
 *
 * `yt-dlp` fetches the caption file only (`--skip-download`): the video itself
 * is never downloaded. Auto-generated captions repeat each line as it scrolls,
 * so they are folded back into one line per thing said.
 */

export interface TranscriptLine {
  seconds: number;
  text: string;
}

/** YouTube said "Too Many Requests": the captions exist, just not right now. */
export class CaptionsRateLimited extends Error {
  constructor() {
    super("YouTube is limiting caption downloads right now.");
  }
}

export type RunYtDlp = (args: string[], cwd: string) => Promise<void>;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function clean(line: string): string {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function cueSeconds(stamp: string): number {
  const parts = stamp.split(":").map(Number);
  return Math.floor(parts.reduce((total, part) => total * 60 + part, 0));
}

export function parseVtt(vtt: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const recent: string[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n{2,}/)) {
    const rows = block.split("\n");
    const timing = rows.findIndex((row) => row.includes("-->"));
    if (timing < 0) continue;
    const seconds = cueSeconds(rows[timing].split("-->")[0].trim());
    for (const row of rows.slice(timing + 1)) {
      const text = clean(row);
      if (!text || recent.includes(text)) continue;
      lines.push({ seconds, text });
      recent.push(text);
      if (recent.length > 3) recent.shift();
    }
  }
  return lines;
}

function stamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export function transcriptText(lines: readonly TranscriptLine[]): string {
  return lines.map((line) => `[${stamp(line.seconds)}] ${line.text}`).join("\n");
}

const PASTED_STAMP = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s+(.*)$/;

/** A transcript pasted by hand. Lines without a time carry the last one seen. */
export function linesFromPaste(text: string): TranscriptLine[] {
  let seconds = 0;
  return text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const match = PASTED_STAMP.exec(row);
      if (match) seconds = cueSeconds(match[1]);
      return { seconds, text: match ? match[2].trim() : row };
    })
    .filter((line) => line.text);
}

/** Hand-made English first, then regional English, then auto, then anything. */
function rank(file: string, videoId: string): number {
  const language = file.slice(videoId.length + 1, -".vtt".length);
  if (language === "en") return 0;
  if (/^en-(?!orig)/.test(language)) return 1;
  if (language.startsWith("en")) return 2;
  return 3;
}

export async function ytDlpPath(): Promise<string | undefined> {
  return findOnPath("yt-dlp");
}

const defaultRun: RunYtDlp = async (args, cwd) => {
  const binary = await ytDlpPath();
  if (!binary) throw new Error("yt-dlp is not installed. Install it with: brew install yt-dlp");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (/HTTP Error 429|Too Many Requests/i.test(stderr)) reject(new CaptionsRateLimited());
      else reject(new Error(`yt-dlp could not read the captions: ${stderr.trim().split("\n").pop() ?? `exit ${code}`}`));
    });
  });
};

/** The video's captions as lines, or `undefined` when it has none. */
export async function fetchCaptions(videoId: string, run: RunYtDlp = defaultRun): Promise<TranscriptLine[] | undefined> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-captions-"));
  try {
    await run(
      ["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en,en-orig,en-US,en-GB", "--sub-format", "vtt", "-o", "%(id)s.%(ext)s", watchUrl(videoId)],
      dir,
    );
    const files = (await fs.readdir(dir)).filter((file) => file.startsWith(`${videoId}.`) && file.endsWith(".vtt"));
    if (files.length === 0) return undefined;
    files.sort((a, b) => rank(a, videoId) - rank(b, videoId));
    const lines = parseVtt(await fs.readFile(path.join(dir, files[0]), "utf8"));
    return lines.length > 0 ? lines : undefined;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
