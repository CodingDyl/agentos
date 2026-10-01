import { isMemoryType, noteRevision, readProvenance, type MemoryDuplicateMatch } from "../../shared/memory-types";
import { readDecisions } from "../agentos/mutations/decisions";
import { isArchived } from "./index";
import { queryTerms } from "./search";
import type { MemoryService } from "./service";

/**
 * Whether a proposed memory is already remembered.
 *
 * Words, not meaning — the same deterministic vocabulary search uses. A title
 * overlap counts most, because two notes about one thing are usually named
 * alike; the body counts for the rest, so a renamed repeat is still caught.
 * It only ever *surfaces* a possible match. Nothing is merged: a person
 * chooses to update the existing note or create a new one.
 */

/** Scores at or above this are shown as a possible match. */
export const DUPLICATE_THRESHOLD = 0.4;
const MAX_MATCHES = 3;

/** The project's own files are not memory items; decisions are matched by section. */
const PROJECT_FILES = new Set(["PROJECT.md", "STATUS.md", "TASKS.md", "DECISIONS.md"]);

export interface DuplicateCandidate {
  title: string;
  body: string;
}

export interface DuplicatePoolEntry {
  id: string;
  title: string;
  body: string;
  kind: MemoryDuplicateMatch["kind"];
  revision: string;
  type?: MemoryDuplicateMatch["type"];
  createdAt?: string;
  archived: boolean;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Words that name the kind of note rather than its subject. */
const GENERIC = new Set(["pattern", "lesson", "decision", "constraint", "rule", "business", "fact", "note", "notes", "handling"]);

function terms(text: string): Set<string> {
  return new Set(queryTerms(text).filter((term) => !GENERIC.has(term)));
}

/** 0–1. Exported for tests. */
export function similarity(candidate: DuplicateCandidate, existing: { title: string; body: string }): number {
  const title = jaccard(terms(candidate.title), terms(existing.title));
  const body = jaccard(terms(`${candidate.title} ${candidate.body}`), terms(`${existing.title} ${existing.body.slice(0, 4000)}`));
  return Math.min(1, Math.max(title * 0.85, title * 0.55 + body * 0.45, body * 0.9));
}

function excerpt(body: string): string {
  const text = body
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#\s+.*$/m, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

/** The likely duplicates of `candidate` in `pool`, best first, deterministic. */
export function rankDuplicates(candidate: DuplicateCandidate, pool: readonly DuplicatePoolEntry[]): MemoryDuplicateMatch[] {
  return pool
    .map((entry) => ({ entry, score: similarity(candidate, entry) }))
    .filter(({ score }) => score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, MAX_MATCHES)
    .map(({ entry, score }) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      createdAt: entry.createdAt,
      archived: entry.archived,
      score: Math.round(score * 100) / 100,
      revision: entry.revision,
      excerpt: excerpt(entry.body),
      kind: entry.kind,
    }));
}

/** Everything a proposal for `project` is compared with: its notes and its decisions. */
export async function duplicatePool(service: MemoryService, project: string): Promise<DuplicatePoolEntry[]> {
  const prefix = `projects/${project}/`;
  const pool: DuplicatePoolEntry[] = [];

  for (const note of service.index.notes.values()) {
    if (!note.id.startsWith(prefix)) continue;
    if (PROJECT_FILES.has(note.id.slice(prefix.length))) continue;
    const frontmatter = note.parsed.frontmatter;
    pool.push({
      id: note.id,
      title: note.parsed.title,
      body: note.parsed.body,
      kind: "note",
      revision: noteRevision(note.hash),
      type: isMemoryType(frontmatter.type) ? frontmatter.type : undefined,
      createdAt: readProvenance(frontmatter).createdAt,
      archived: isArchived(note),
    });
  }

  try {
    const { revision, decisions } = await readDecisions(project);
    for (const decision of decisions) {
      pool.push({
        id: decision.title,
        title: decision.title,
        body: decision.body,
        kind: "decision",
        revision,
        type: "decision",
        createdAt: decision.decidedOn,
        archived: false,
      });
    }
  } catch {
    // No DECISIONS.md, or an unreadable one: notes are still compared.
  }

  return pool;
}

export async function findDuplicates(
  service: MemoryService,
  project: string,
  candidate: DuplicateCandidate,
): Promise<MemoryDuplicateMatch[]> {
  return rankDuplicates(candidate, await duplicatePool(service, project));
}
