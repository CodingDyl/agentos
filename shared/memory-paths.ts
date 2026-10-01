/**
 * How a new note's title and folder become a path in the vault.
 *
 * Shared by the dialog, which shows the path as it is typed, and the server,
 * which writes it — so what the operator is shown is exactly what is created.
 * The rules are Obsidian's: a note's file name is its title, minus the few
 * characters Obsidian and the file system cannot carry.
 */

/** Characters Obsidian refuses in file names, plus path separators and control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;

export const MAX_TITLE = 120;
export const MAX_SEGMENT = 80;
export const MAX_DEPTH = 8;

/** A title as a file name: forbidden characters dropped, spaces tidied. Empty if nothing is left. */
export function noteFileName(title: string): string {
  const cleaned = title.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, MAX_TITLE).trim();
  return cleaned ? `${cleaned}.md` : "";
}

export type FolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/**
 * A vault-relative folder, checked: no traversal, no hidden or system
 * folders, no characters a file system would choke on. `""` is the vault root.
 */
export function checkFolder(input: string): FolderCheck {
  const trimmed = input.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { ok: true, folder: "" };

  const segments = trimmed.split("/").map((segment) => segment.trim());
  if (segments.length > MAX_DEPTH) return { ok: false, reason: `Folders can be at most ${MAX_DEPTH} levels deep.` };

  for (const segment of segments) {
    if (!segment) return { ok: false, reason: "A folder name cannot be empty." };
    if (segment === "." || segment === "..") return { ok: false, reason: "A folder cannot be “.” or “..”." };
    if (segment.startsWith(".")) return { ok: false, reason: "Folders starting with “.” are hidden and are not part of memory." };
    if (segment.startsWith("._")) return { ok: false, reason: "That name is reserved by macOS." };
    if (segment.length > MAX_SEGMENT) return { ok: false, reason: `Folder names can be at most ${MAX_SEGMENT} characters.` };
    if (new RegExp(FORBIDDEN.source).test(segment)) {
      return { ok: false, reason: "Folder names cannot contain \\ / : * ? \" < > | # ^ [ ]." };
    }
    if (segment.toLowerCase() === "node_modules") return { ok: false, reason: "That folder is never indexed." };
  }

  return { ok: true, folder: segments.join("/") };
}

/** A tag as the index stores it, or `undefined` if it cannot be one. */
export function normaliseTag(tag: string): string | undefined {
  const clean = tag.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-");
  if (!clean || !/^[\p{L}\p{N}_\-/]+$/u.test(clean) || /^[\d/_-]+$/.test(clean)) return undefined;
  return clean;
}

export interface CreateMemoryNoteRequest {
  /** Vault-relative folder; created if it does not exist. `""` is the root. */
  folder: string;
  title: string;
  body?: string;
  tags?: string[];
  /** Note ids to link to from a "Related" section. */
  links?: string[];
  /** One of the memory types; written as `type:` front matter. */
  type?: string;
}

export interface CreateMemoryNoteResponse {
  id: string;
  /** Folders that did not exist and were made for this note. */
  createdFolders: string[];
}

function basename(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

/** `[[Name]]` when the name is unique in the vault, the full path otherwise. */
function linkText(id: string, ids: readonly string[]): string {
  const base = basename(id).replace(/\.md$/i, "");
  const same = ids.filter((other) => basename(other).replace(/\.md$/i, "").toLowerCase() === base.toLowerCase());
  return same.length === 1 ? `[[${base}]]` : `[[${id.replace(/\.md$/i, "")}]]`;
}

/** The note as it will be written. Pure, so the review step can match it exactly. */
export function composeNote(input: { title: string; body?: string; tags: string[]; links: string[]; allIds: readonly string[] }): string {
  const parts: string[] = [];
  if (input.tags.length > 0) parts.push(`---\ntags: [${input.tags.join(", ")}]\n---\n`);
  parts.push(`# ${input.title.trim()}\n`);
  const body = input.body?.replace(/\r\n/g, "\n").trim();
  if (body) parts.push(`\n${body}\n`);
  if (input.links.length > 0) {
    parts.push(`\n## Related\n\n${input.links.map((id) => `- ${linkText(id, input.allIds)}`).join("\n")}\n`);
  }
  return parts.join("");
}
