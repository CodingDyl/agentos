import type { MemorySearchHit } from "../../shared/memory-types";
import type { MemoryIndex, NoteRecord } from "./index";

/**
 * Deterministic search over the index.
 *
 * Words, not meaning: a title hit outranks an alias, which outranks a heading
 * or tag, then the path, then plain occurrences in the text. The same query
 * over the same vault always ranks the same way, which is what lets a job's
 * context be explained afterwards. Semantic search can come later.
 */

const STOPWORDS = new Set(
  "a an and are as at be but by do for from has have how i if in into is it its of on or our so that the their then there this to was we what when where which who why will with you your".split(" "),
);

export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2 && !STOPWORDS.has(term)),
    ),
  ];
}

export interface Section {
  heading?: string;
  level: number;
  text: string;
}

/** A note cut at its headings (levels 1–3), each piece keeping its heading. */
export function sections(body: string): Section[] {
  const result: Section[] = [];
  let current: Section = { level: 0, text: "" };
  let fenced = false;

  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced ? /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line) : null;

    if (heading) {
      if (current.text.trim() || current.heading) result.push(current);
      current = { heading: heading[2], level: heading[1].length, text: `${line}\n` };
    } else {
      current.text += `${line}\n`;
    }
  }

  if (current.text.trim() || current.heading) result.push(current);
  return result;
}

function occurrences(haystack: string, term: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at < 0 || count >= 5) return count;
    count += 1;
    from = at + term.length;
  }
}

/** How well a piece of text matches the terms. */
export function textScore(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((sum, term) => sum + occurrences(lower, term), 0);
}

export function scoreNote(
  note: NoteRecord,
  terms: string[],
  phrase: string,
): { score: number; matchedIn: string[]; heading?: string } {
  if (terms.length === 0) return { score: 0, matchedIn: [] };

  const matchedIn = new Set<string>();
  const title = note.parsed.title.toLowerCase();
  const path = note.id.toLowerCase();
  let score = 0;
  let matchedTerms = 0;
  let bestHeading: { text: string; hits: number } | undefined;

  if (phrase.length >= 3 && title.includes(phrase)) {
    score += 20;
    matchedIn.add("title");
  }

  for (const term of terms) {
    let hit = false;

    if (title.includes(term)) {
      score += 8;
      matchedIn.add("title");
      hit = true;
    }
    if (note.parsed.aliases.some((alias) => alias.toLowerCase().includes(term))) {
      score += 6;
      matchedIn.add("alias");
      hit = true;
    }
    if (note.parsed.tags.some((tag) => tag.includes(term))) {
      score += 6;
      matchedIn.add("tag");
      hit = true;
    }
    for (const heading of note.parsed.headings) {
      if (heading.text.toLowerCase().includes(term)) {
        score += 4;
        matchedIn.add("heading");
        hit = true;
        const hits = (bestHeading?.text === heading.text ? bestHeading.hits : 0) + 1;
        if (!bestHeading || hits > bestHeading.hits) bestHeading = { text: heading.text, hits };
      }
    }
    if (path.includes(term)) {
      score += 3;
      matchedIn.add("path");
      hit = true;
    }
    const inText = occurrences(note.parsed.body.toLowerCase(), term);
    if (inText > 0) {
      score += inText;
      matchedIn.add("content");
      hit = true;
    }
    if (hit) matchedTerms += 1;
  }

  // Notes that answer every word of the query beat notes that repeat one.
  if (matchedTerms === terms.length && terms.length > 1) score += 5;

  return { score, matchedIn: [...matchedIn], heading: bestHeading?.text };
}

function snippet(body: string, terms: string[]): string | undefined {
  for (const line of body.split("\n")) {
    const lower = line.toLowerCase();
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const at = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (at === undefined) continue;
    const start = Math.max(0, at - 60);
    const text = line.slice(start, start + 180).trim();
    return `${start > 0 ? "…" : ""}${text}${start + 180 < line.length ? "…" : ""}`;
  }
  return undefined;
}

export function searchIndex(index: MemoryIndex, query: string, limit = 25): MemorySearchHit[] {
  const terms = queryTerms(query);
  const phrase = query.trim().toLowerCase();
  if (terms.length === 0) return [];

  const hits: MemorySearchHit[] = [];
  for (const note of index.notes.values()) {
    const scored = scoreNote(note, terms, phrase);
    if (scored.score <= 0) continue;
    hits.push({
      id: note.id,
      title: note.parsed.title,
      score: scored.score,
      matchedIn: scored.matchedIn,
      heading: scored.heading,
      snippet: snippet(note.parsed.body, terms),
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.min(200, limit));
}
