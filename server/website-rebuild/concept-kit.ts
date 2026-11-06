import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uiStateDir } from "../agentos/session-store";

/**
 * What a concept is built with, seeded into the client repo before its worker
 * starts: real font files and the motion libraries, kept on disk so the hero
 * makes no outside request.
 *
 * Heroes used to be told to stick to system fonts, then named a typeface they
 * never loaded, so every concept really rendered in Georgia or Arial.
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FONT_API = "https://api.fontsource.org/v1";
const FONT_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
/** Faces under these licences may be embedded in a client's site. */
const OPEN_LICENCE = /OFL|Apache|Ubuntu/i;

export const fontId = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface FontFace {
  /** The relative path under `design/kit/fonts/`. */
  file: string;
  url: string;
  style: "normal" | "italic";
  /** "400" or a variable range, "100 900". */
  weight: string;
}

interface FontRecord {
  license?: string;
  variable?: boolean;
  weights?: number[];
  styles?: string[];
  variants?: Record<string, Record<string, Record<string, { url?: { woff2?: string } }>>>;
}

async function readJson<T>(fetcher: typeof fetch, url: string): Promise<T | undefined> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  return response.ok ? ((await response.json()) as T) : undefined;
}

/** A family's faces: its variable weight axis when it has one, otherwise the weights a design needs. */
export function facesOf(id: string, record: FontRecord, axes?: { wght?: { min: string; max: string } }): FontFace[] {
  const styles = (record.styles ?? ["normal"]).filter((style): style is "normal" | "italic" => style === "normal" || style === "italic");
  if (record.variable && axes?.wght) {
    return styles.map((style) => ({ file: `${id}/${id}-wght-${style}.woff2`, url: `${FONT_CDN}/${id}:vf@latest/latin-wght-${style}.woff2`, style, weight: `${axes.wght?.min} ${axes.wght?.max}` }));
  }
  const available = record.weights ?? [];
  const wanted = available.filter((weight) => [300, 400, 500, 700, 900].includes(weight));
  const faces: FontFace[] = [];
  for (const weight of wanted.length > 0 ? wanted : available.slice(0, 2)) {
    for (const style of styles) {
      // The italic is only worth carrying at the text weight.
      if (style === "italic" && weight !== 400) continue;
      const url = record.variants?.[String(weight)]?.[style]?.latin?.url?.woff2;
      if (url) faces.push({ file: `${id}/${id}-${weight}-${style}.woff2`, url, style, weight: String(weight) });
    }
  }
  return faces;
}

async function cachedDownload(fetcher: typeof fetch, url: string, cacheFile: string): Promise<Buffer> {
  const cached = await fs.readFile(cacheFile).catch(() => undefined);
  if (cached) return cached;
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, data);
  return data;
}

export interface FontKit {
  /** Paths relative to the repo, ready to commit. */
  files: Record<string, Buffer>;
  /** The @font-face rules, with urls relative to `design/<concept>/`. */
  css: string;
  /** Families that could not be fetched, or whose licence does not allow embedding. */
  missing: string[];
}

/** Downloads a font pair from Fontsource, with its licence checked, into the shape the repo needs. */
export async function fontKit(families: readonly string[], fetcher: typeof fetch = fetch, cacheRoot = path.join(uiStateDir(), "font-cache")): Promise<FontKit> {
  const files: FontKit["files"] = {};
  const css: string[] = [];
  const missing: string[] = [];
  for (const family of [...new Set(families)]) {
    const id = fontId(family);
    try {
      const record = await readJson<FontRecord>(fetcher, `${FONT_API}/fonts/${id}`);
      if (!record || !OPEN_LICENCE.test(record.license ?? "")) throw new Error(record ? `licence ${record.license ?? "unknown"}` : "not on Fontsource");
      const axes = record.variable ? await readJson<{ axes?: { wght?: { min: string; max: string } } }>(fetcher, `${FONT_API}/variable/${id}`).catch(() => undefined) : undefined;
      const faces = facesOf(id, record, axes?.axes);
      if (faces.length === 0) throw new Error("no usable files");
      for (const face of faces) {
        files[`design/kit/fonts/${face.file}`] = await cachedDownload(fetcher, face.url, path.join(cacheRoot, face.file));
        css.push(`@font-face { font-family: "${family}"; src: url("../kit/fonts/${face.file}") format("woff2"); font-weight: ${face.weight}; font-style: ${face.style}; font-display: swap; }`);
      }
    } catch {
      missing.push(family);
    }
  }
  return { files, css: `${css.join("\n")}\n`, missing };
}

const MOTION_FILES: Record<string, string> = {
  "gsap.min.js": "gsap/dist/gsap.min.js",
  "ScrollTrigger.min.js": "gsap/dist/ScrollTrigger.min.js",
  "SplitText.min.js": "gsap/dist/SplitText.min.js",
  "lenis.min.js": "lenis/dist/lenis.min.js",
};

/** GSAP and Lenis at the versions AgentOS pins, so a concept can move without asking a CDN. */
export async function motionKit(): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  for (const [name, source] of Object.entries(MOTION_FILES)) files[`design/kit/motion/${name}`] = await fs.readFile(path.join(APP_ROOT, "node_modules", source));
  return files;
}
