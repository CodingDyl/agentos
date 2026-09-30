import matter from "gray-matter";
import { Marked, type Token } from "marked";
import {
  headingSlug,
  isExternalHref,
  memoryMarkdownExtensions,
  type WikiLinkToken,
} from "../../shared/memory-markdown";
import type { MemoryHeading, MemoryLinkSyntax } from "../../shared/memory-types";

/**
 * One note, read.
 *
 * Structure comes from the Markdown lexer, not from regexes over raw text, so
 * a `[[link]]` written as an example inside a code block, inline code, an HTML
 * comment or an Obsidian `%%comment%%` is never mistaken for a real link.
 */

export interface ParsedLink {
  syntax: MemoryLinkSyntax;
  raw: string;
  target: string;
  heading?: string;
  blockId?: string;
  label?: string;
  line: number;
}

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  /** The note without its front matter. */
  body: string;
  headings: MemoryHeading[];
  tags: string[];
  aliases: string[];
  blockIds: string[];
  links: ParsedLink[];
  errors: string[];
}

const lexer = new Marked({ extensions: memoryMarkdownExtensions, gfm: true });

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const INLINE_TAG = /(?:^|[\s(,])#([\p{L}\p{N}_\-/]+)/gu;
const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/gm;

function toStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []));
  }
  return [];
}

function normaliseTag(tag: string): string | undefined {
  const clean = tag.replace(/^#/, "").trim().toLowerCase();
  // Obsidian: a tag needs at least one non-numeric character.
  return clean && !/^[\d/_-]+$/.test(clean) ? clean : undefined;
}

/** Dates and other YAML values made JSON-safe, so the cache round-trips. */
function plain(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function basenameTitle(id: string): string {
  const name = id.split("/").pop() ?? id;
  return name.replace(/\.md$/i, "");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Child token lists, wherever marked keeps them. */
function children(token: Token): Token[][] {
  const lists: Token[][] = [];
  const record = token as unknown as Record<string, unknown>;

  if (Array.isArray(record.tokens)) lists.push(record.tokens as Token[]);
  if (token.type === "list") {
    for (const item of (token as { items: Token[] }).items) lists.push([item]);
  }
  if (token.type === "table") {
    const table = token as unknown as { header: Array<{ tokens: Token[] }>; rows: Array<Array<{ tokens: Token[] }>> };
    for (const cell of table.header) lists.push(cell.tokens);
    for (const row of table.rows) for (const cell of row) lists.push(cell.tokens);
  }

  return lists;
}

/** Tokens whose content is never links or tags. */
const OPAQUE = new Set(["code", "codespan", "html", "obsidianComment", "escape"]);

export function parseNote(id: string, source: string): ParsedNote {
  const errors: string[] = [];
  let frontmatter: Record<string, unknown> = {};
  let body = source;

  const block = FRONTMATTER.exec(source);
  if (block) {
    body = source.slice(block[0].length);
    try {
      frontmatter = plain(matter(block[0]).data as Record<string, unknown>);
    } catch (error) {
      errors.push(`Front matter could not be read: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  const lineOffset = block ? block[0].split("\n").length - 1 : 0;
  const lineAt = (offset: number) => lineOffset + body.slice(0, offset).split("\n").length;

  let tokens: Token[] = [];
  try {
    tokens = lexer.lexer(body);
  } catch (error) {
    errors.push(`The note could not be parsed: ${(error as Error).message}`);
  }

  const headings: MemoryHeading[] = [];
  const links: ParsedLink[] = [];
  const tags = new Set<string>();
  const blockIds = new Set<string>();

  // Top-level token raws concatenate back to the body, which gives each block
  // an offset; links inside a block are located by searching forward from it.
  let blockOffset = 0;
  for (const top of tokens) {
    let cursor = blockOffset;

    const locate = (raw: string): number => {
      const at = body.indexOf(raw, cursor);
      if (at < 0) return lineAt(blockOffset);
      cursor = at + raw.length;
      return lineAt(at);
    };

    const visit = (token: Token) => {
      if (OPAQUE.has(token.type)) return;

      if (token.type === "heading") {
        const heading = token as { depth: number; text: string; raw: string };
        const text = heading.text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").trim();
        headings.push({ level: heading.depth, text, slug: headingSlug(text), line: locate(heading.raw) });
        cursor = blockOffset;
      }

      if (token.type === "wikilink") {
        const wiki = token as WikiLinkToken;
        links.push({
          syntax: wiki.embed ? "embed" : "wikilink",
          raw: wiki.raw,
          target: wiki.parts.target,
          heading: wiki.parts.heading,
          blockId: wiki.parts.blockId,
          label: wiki.parts.label,
          line: locate(wiki.raw),
        });
        return;
      }

      if (token.type === "link" || token.type === "image") {
        const link = token as { href: string; text: string; raw: string };
        if (!isExternalHref(link.href) && link.href.trim()) {
          const decoded = safeDecode(link.href.trim().replace(/^<|>$/g, ""));
          const hash = decoded.indexOf("#");
          const target = hash >= 0 ? decoded.slice(0, hash) : decoded;
          const anchor = hash >= 0 ? decoded.slice(hash + 1) : undefined;
          links.push({
            syntax: token.type === "image" ? "embed" : "markdown",
            raw: link.raw,
            target,
            heading: anchor && !anchor.startsWith("^") ? anchor : undefined,
            blockId: anchor?.startsWith("^") ? anchor.slice(1) : undefined,
            label: link.text || undefined,
            line: locate(link.raw),
          });
        }
        // Link text can itself hold nothing worth indexing as a link.
        return;
      }

      const lists = children(token);
      if (lists.length === 0 && token.type === "text") {
        const text = (token as { text: string }).text;
        for (const match of text.matchAll(INLINE_TAG)) {
          const tag = normaliseTag(match[1]);
          if (tag) tags.add(tag);
        }
        for (const match of text.matchAll(BLOCK_ID)) blockIds.add(match[1]);
      }

      for (const list of lists) for (const child of list) visit(child);
    };

    visit(top);
    blockOffset += top.raw.length;
  }

  for (const tag of toStringList(frontmatter.tags ?? frontmatter.tag)) {
    const normal = normaliseTag(tag);
    if (normal) tags.add(normal);
  }

  const aliases = toStringList(frontmatter.aliases ?? frontmatter.alias);
  const firstH1 = headings.find((heading) => heading.level === 1)?.text;
  const title =
    (typeof frontmatter.title === "string" && frontmatter.title.trim()) ||
    firstH1 ||
    basenameTitle(id);

  return {
    title,
    frontmatter,
    body,
    headings,
    tags: [...tags].sort(),
    aliases,
    blockIds: [...blockIds],
    links,
    errors,
  };
}
