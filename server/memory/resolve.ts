import path from "node:path";
import type { MemoryLink } from "../../shared/memory-types";
import type { ParsedLink } from "./parser";

/**
 * Link resolution, with Obsidian's semantics and none of its guesses.
 *
 * - `[[Name]]` matches a note by file name (then by alias). A match in the
 *   linking note's own folder wins, as it does in Obsidian; otherwise more
 *   than one match is reported as ambiguous rather than picked.
 * - `[[folder/Name]]` is a vault path, then a path relative to the linking
 *   note, then a unique path suffix.
 * - `[label](../x.md)` is a relative path and nothing else — Markdown links
 *   are paths, not names.
 * - Anything with a non-Markdown extension is an attachment, never a note.
 */

export interface VaultLookup {
  /** lower-case note id → id */
  notes: Map<string, string>;
  /** lower-case basename without `.md` → ids */
  byName: Map<string, string[]>;
  /** lower-case alias → ids */
  byAlias: Map<string, string[]>;
  /** lower-case attachment path → path */
  attachments: Map<string, string>;
  /** lower-case attachment file name → paths */
  attachmentsByName: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function buildLookup(
  notes: Iterable<{ id: string; aliases: string[] }>,
  attachments: Iterable<string>,
): VaultLookup {
  const lookup: VaultLookup = {
    notes: new Map(),
    byName: new Map(),
    byAlias: new Map(),
    attachments: new Map(),
    attachmentsByName: new Map(),
  };

  for (const note of notes) {
    lookup.notes.set(note.id.toLowerCase(), note.id);
    push(lookup.byName, path.posix.basename(note.id).replace(/\.md$/i, "").toLowerCase(), note.id);
    for (const alias of note.aliases) push(lookup.byAlias, alias.toLowerCase(), note.id);
  }

  for (const file of attachments) {
    lookup.attachments.set(file.toLowerCase(), file);
    push(lookup.attachmentsByName, path.posix.basename(file).toLowerCase(), file);
  }

  return lookup;
}

/** Joins inside the vault; `undefined` if the result would climb out of it. */
function within(dir: string, relative: string): string | undefined {
  const joined = path.posix.normalize(path.posix.join(dir, relative));
  if (joined === ".." || joined.startsWith("../") || path.posix.isAbsolute(joined)) return undefined;
  return joined.replace(/^\.\//, "");
}

const MARKDOWN_EXT = /\.md$/i;
const OTHER_EXT = /\.([a-z0-9]{1,8})$/i;

function isAttachmentName(target: string): boolean {
  return OTHER_EXT.test(target) && !MARKDOWN_EXT.test(target);
}

type Outcome = Pick<MemoryLink, "resolution" | "targetId" | "attachment" | "candidates">;

function pick(candidates: string[] | undefined, sourceDir: string): Outcome | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return { resolution: "resolved", targetId: candidates[0] };

  const sameFolder = candidates.filter((id) => path.posix.dirname(id) === sourceDir);
  if (sameFolder.length === 1) return { resolution: "resolved", targetId: sameFolder[0] };

  return { resolution: "ambiguous", candidates: [...candidates].sort() };
}

function resolveAttachment(target: string, sourceDir: string, lookup: VaultLookup, byName: boolean): Outcome {
  const clean = target.replace(/^\/+/, "");
  const direct = [clean, within(sourceDir, target)].filter((entry): entry is string => Boolean(entry));

  for (const candidate of direct) {
    const found = lookup.attachments.get(candidate.toLowerCase());
    if (found) return { resolution: "attachment", attachment: found };
  }

  if (byName) {
    const named = lookup.attachmentsByName.get(path.posix.basename(clean).toLowerCase());
    if (named?.length === 1) return { resolution: "attachment", attachment: named[0] };
  }

  // A missing image is still an attachment link, never a ghost note.
  return { resolution: "attachment", attachment: undefined };
}

function resolveWiki(link: ParsedLink, sourceId: string, lookup: VaultLookup): Outcome {
  const sourceDir = path.posix.dirname(sourceId);
  const target = link.target.trim().replace(/\\/g, "/");

  if (!target) return { resolution: "self", targetId: sourceId };
  if (isAttachmentName(target)) return resolveAttachment(target, sourceDir, lookup, true);

  const base = target.replace(MARKDOWN_EXT, "").replace(/^\/+/, "");
  const lower = base.toLowerCase();

  if (base.includes("/")) {
    const exact = lookup.notes.get(`${lower}.md`);
    if (exact) return { resolution: "resolved", targetId: exact };

    const relative = within(sourceDir, base);
    const near = relative ? lookup.notes.get(`${relative.toLowerCase()}.md`) : undefined;
    if (near) return { resolution: "resolved", targetId: near };

    const suffix = [...lookup.notes.entries()]
      .filter(([key]) => key.endsWith(`/${lower}.md`))
      .map(([, id]) => id);
    const outcome = pick(suffix, sourceDir);
    if (outcome) return outcome;
  } else {
    const byName = pick(lookup.byName.get(lower), sourceDir);
    if (byName) return byName;

    const byAlias = pick(lookup.byAlias.get(lower), sourceDir);
    if (byAlias) return byAlias;
  }

  return { resolution: "unresolved" };
}

function resolveMarkdown(link: ParsedLink, sourceId: string, lookup: VaultLookup): Outcome {
  const sourceDir = path.posix.dirname(sourceId);
  const target = link.target.trim();

  if (!target) return { resolution: "self", targetId: sourceId };

  const relative = target.startsWith("/") ? within(".", target.slice(1)) : within(sourceDir, target);
  if (!relative) return { resolution: "unresolved" };

  if (isAttachmentName(relative)) return resolveAttachment(relative, ".", lookup, false);

  const candidates = MARKDOWN_EXT.test(relative) ? [relative] : [relative, `${relative}.md`];
  for (const candidate of candidates) {
    const found = lookup.notes.get(candidate.toLowerCase());
    if (found) return { resolution: "resolved", targetId: found };
  }

  return { resolution: "unresolved" };
}

export function resolveLink(link: ParsedLink, sourceId: string, lookup: VaultLookup): MemoryLink {
  const outcome =
    link.syntax === "markdown" || (link.syntax === "embed" && !link.raw.startsWith("![["))
      ? resolveMarkdown(link, sourceId, lookup)
      : resolveWiki(link, sourceId, lookup);

  return { ...link, ...outcome };
}
