import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  LIBRARY_KINDS,
  type LibraryEntry,
  type LibraryKind,
  type Verdict,
} from "../../shared/reengineer-types";
import { agentOSRoot } from "../agentos/filesystem";

/**
 * The component and pattern library, kept as markdown in the vault.
 *
 * One note per entry in `knowledge/library/`, with its facts in front matter,
 * so the Memory and Knowledge pages index it like any other note and Obsidian
 * can open it. The note body is the entry's reasoning, written for a person.
 */

export const LIBRARY_DIR = "knowledge/library";
export const TEARDOWN_DIR = "knowledge/teardowns";

export const libraryRoot = () => path.join(agentOSRoot(), LIBRARY_DIR);
export const teardownRoot = () => path.join(agentOSRoot(), TEARDOWN_DIR);

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const isLibraryId = (id: string) => ID.test(id);

export function slugify(text: string, fallback = "entry"): string {
  const cleaned = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return cleaned || fallback;
}

/** Front matter edited by hand can hold a bare timestamp, which YAML reads as a Date. */
const when = (value: unknown): string | undefined => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : str(value));

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function normaliseKind(value: unknown): LibraryKind {
  const text = String(value ?? "").toLowerCase();
  return (LIBRARY_KINDS as readonly string[]).includes(text) ? (text as LibraryKind) : "pattern";
}

export interface NewEntry {
  title: string;
  kind: LibraryKind;
  summary: string;
  whyItWorks: string;
  tags: string[];
  source: { target: string; runId?: string };
  screenshot?: string;
}

function noteOf(entry: LibraryEntry): string {
  const data = {
    type: "library-entry",
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    status: entry.status,
    tags: entry.tags,
    source: entry.source,
    ...(entry.screenshot ? { screenshot: entry.screenshot } : {}),
    ...(entry.rebuild ? { rebuild: entry.rebuild } : {}),
    verdicts: entry.verdicts,
    uses: entry.uses,
    created: entry.createdAt,
  };
  const body = [
    `# ${entry.title}`,
    "",
    entry.summary,
    "",
    "## Why it works",
    "",
    entry.whyItWorks || "Not recorded.",
    "",
    `Learned from ${entry.source.target}${entry.source.runId ? ` (teardown ${entry.source.runId})` : ""}.`,
    "",
  ].join("\n");
  // YAML can't hold `undefined`; a round trip through JSON drops those fields.
  return matter.stringify(body, JSON.parse(JSON.stringify(data)));
}

function toEntry(file: string, text: string): LibraryEntry | undefined {
  const { data, content } = matter(text);
  if (data.type !== "library-entry" || !str(data.id) || !str(data.title)) return undefined;
  const body = content.split(/^## Why it works\s*$/m);
  const summary = (body[0] ?? "").replace(/^# .*$/m, "").trim();
  const why = (body[1] ?? "").split(/\n\nLearned from /)[0].trim();
  const verdicts = Array.isArray(data.verdicts)
    ? data.verdicts.flatMap((v: Record<string, unknown>) =>
        v && typeof v === "object" && when(v.at) && str(v.verdict)
          ? [{ at: when(v.at)!, verdict: str(v.verdict) as Verdict, note: str(v.note), workspace: str(v.workspace) }]
          : [],
      )
    : [];
  const status = data.status === "proven" || data.status === "rejected" ? data.status : "candidate";
  const screenshot = str(data.screenshot);
  return {
    id: String(data.id),
    title: String(data.title),
    kind: normaliseKind(data.kind),
    summary,
    whyItWorks: why === "Not recorded." ? "" : why,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    status,
    source: { target: str(data.source?.target) ?? "unknown", runId: str(data.source?.runId) },
    screenshot,
    screenshotUrl: screenshot ? `/api/reengineer/media?path=${encodeURIComponent(screenshot)}` : undefined,
    rebuild: str(data.rebuild),
    verdicts,
    uses: Number(data.uses ?? 0) || 0,
    createdAt: when(data.created) ?? new Date(0).toISOString(),
    path: path.posix.join(LIBRARY_DIR, path.basename(file)),
  };
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  let names: string[];
  try {
    names = (await fs.readdir(libraryRoot())).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        return toEntry(name, await fs.readFile(path.join(libraryRoot(), name), "utf8"));
      } catch {
        return undefined;
      }
    }),
  );
  return entries.filter((entry): entry is LibraryEntry => Boolean(entry)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function write(entry: LibraryEntry): Promise<void> {
  await fs.mkdir(libraryRoot(), { recursive: true });
  const file = path.join(libraryRoot(), `${entry.id}.md`);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, noteOf(entry), "utf8");
  await fs.rename(temporary, file);
}

/** Files a new entry as a candidate. A second entry with the same title gets a numbered id. */
export async function addEntry(input: NewEntry): Promise<LibraryEntry> {
  const existing = new Set((await listLibrary()).map((entry) => entry.id));
  const base = slugify(input.title);
  let id = base;
  for (let n = 2; existing.has(id); n += 1) id = `${base}-${n}`;
  const entry: LibraryEntry = {
    id,
    title: input.title.slice(0, 120),
    kind: input.kind,
    summary: input.summary,
    whyItWorks: input.whyItWorks,
    tags: [...new Set(input.tags.map((tag) => slugify(tag, "tag")))].slice(0, 12),
    status: "candidate",
    source: input.source,
    screenshot: input.screenshot,
    verdicts: [],
    uses: 0,
    createdAt: new Date().toISOString(),
    path: path.posix.join(LIBRARY_DIR, `${id}.md`),
  };
  await write(entry);
  return entry;
}

/**
 * Records a person's verdict. `proven` and `rejected` set the entry's standing;
 * `used` only counts, because using a pattern is not the same as it working.
 */
export async function recordVerdict(id: string, verdict: Verdict, note?: string, workspace?: string): Promise<LibraryEntry | undefined> {
  if (!isLibraryId(id)) return undefined;
  const entry = (await listLibrary()).find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  const next: LibraryEntry = {
    ...entry,
    status: verdict === "proven" ? "proven" : verdict === "rejected" ? "rejected" : verdict === "candidate" ? "candidate" : entry.status,
    uses: verdict === "used" ? entry.uses + 1 : entry.uses,
    verdicts: [...entry.verdicts, { at: new Date().toISOString(), verdict, note: note || undefined, workspace: workspace || undefined }].slice(-40),
  };
  await write(next);
  return next;
}

/**
 * What a worker reads before it builds: the proven entries, then candidates,
 * for the kinds or tags asked about. Rejected entries are named only so they
 * are not reached for again.
 */
export function libraryBrief(entries: LibraryEntry[], query: { kind?: string; tag?: string } = {}): string {
  const matches = entries.filter(
    (entry) => (!query.kind || entry.kind === query.kind) && (!query.tag || entry.tags.includes(slugify(query.tag, "tag"))),
  );
  const line = (entry: LibraryEntry) => `- **${entry.title}** (${entry.kind}${entry.tags.length ? `, ${entry.tags.join(", ")}` : ""}): ${entry.summary} Why it works: ${entry.whyItWorks || "not recorded"}.${entry.rebuild ? ` Our rebuild: ${entry.rebuild}.` : ""}`;
  const proven = matches.filter((entry) => entry.status === "proven");
  const candidates = matches.filter((entry) => entry.status === "candidate");
  const rejected = matches.filter((entry) => entry.status === "rejected");
  return [
    "# Library: patterns learned from other products",
    "These are descriptions of what worked, not source to copy. Rebuild in our own code and our own assets.",
    proven.length ? `\n## Proven\n${proven.map(line).join("\n")}` : "",
    candidates.length ? `\n## Worth trying\n${candidates.slice(0, 12).map(line).join("\n")}` : "",
    rejected.length ? `\n## Tried and rejected: do not reach for these\n${rejected.map((entry) => `- ${entry.title}${entry.verdicts.at(-1)?.note ? `: ${entry.verdicts.at(-1)!.note}` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const PROMPT_LIMIT = 3200;

/**
 * The library as it should reach a prompt: only the kinds that bear on the
 * work, proven first, candidates marked as untested, and rejected ones named
 * so they are not reached for. Empty when nothing applies, so a library with
 * nothing relevant adds nothing to a prompt. Bounded, because a prompt that
 * grows with the library would crowd out the brief it is attached to.
 */
export function libraryPromptContext(entries: LibraryEntry[], kinds: readonly LibraryKind[]): string {
  const relevant = entries.filter((entry) => kinds.includes(entry.kind));
  const proven = relevant.filter((entry) => entry.status === "proven").slice(0, 8);
  const candidates = relevant.filter((entry) => entry.status === "candidate").slice(0, 4);
  const rejected = relevant.filter((entry) => entry.status === "rejected").slice(0, 8);
  if (proven.length + candidates.length + rejected.length === 0) return "";

  const line = (entry: LibraryEntry) =>
    `- ${entry.title} (${entry.kind}): ${entry.summary.replace(/\s+/g, " ")}${entry.whyItWorks ? ` Why it works: ${entry.whyItWorks.replace(/\s+/g, " ")}` : ""}${entry.rebuild ? ` Our rebuild: ${entry.rebuild}.` : ""}`;
  const text = [
    "## Patterns from the library",
    "Learned from other products and judged by the operator. They are descriptions of what worked, never source or assets to copy: build your own. Use a proven pattern where it fits the brief; do not force one in.",
    proven.length ? `\nProven:\n${proven.map(line).join("\n")}` : "",
    candidates.length ? `\nNot yet tried here (a suggestion, not a requirement):\n${candidates.map(line).join("\n")}` : "",
    rejected.length ? `\nTried and rejected, so avoid:\n${rejected.map((entry) => `- ${entry.title}${entry.verdicts.at(-1)?.note ? `: ${entry.verdicts.at(-1)!.note}` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return text.length > PROMPT_LIMIT ? `${text.slice(0, PROMPT_LIMIT - 1)}…` : text;
}

/** The library's prompt context for one kind of work, read fresh. Never throws: a prompt must not fail on an unreadable library. */
export async function libraryContextFor(kinds: readonly LibraryKind[]): Promise<string> {
  try {
    return libraryPromptContext(await listLibrary(), kinds);
  } catch {
    return "";
  }
}

/** Appends the library's context to a brief, with a blank line between, or returns the brief unchanged. */
export async function withLibrary(brief: string, kinds: readonly LibraryKind[]): Promise<string> {
  const context = await libraryContextFor(kinds);
  return context ? `${brief}\n\n${context}` : brief;
}

/** Reads a library or teardown image by vault-relative path, refusing anything else. */
export function mediaPath(relative: string): string | undefined {
  const safe = relative.replace(/\\/g, "/");
  if (safe.includes("..") || safe.startsWith("/")) return undefined;
  if (!safe.startsWith(`${TEARDOWN_DIR}/`) && !safe.startsWith(`${LIBRARY_DIR}/`)) return undefined;
  if (!/\.(png|jpe?g|webp|gif)$/i.test(safe)) return undefined;
  return path.join(agentOSRoot(), safe);
}

export { normaliseKind };
