import type { TokenizerAndRendererExtension, Tokens } from "marked";

/**
 * Obsidian's link syntax, taught to `marked`.
 *
 * Shared by the indexer and the preview so the two cannot disagree about what
 * is a link: a `[[Note]]` inside a code block is code to both of them, because
 * both see the same lexer's code tokens rather than running a regex over text.
 */

export interface WikiTarget {
  /** The note part: `folder/Note`, or empty for a same-note anchor. */
  target: string;
  heading?: string;
  blockId?: string;
  label?: string;
}

/** `folder/Note#Heading|Label` → its parts. `#^id` is a block reference. */
export function parseWikiTarget(inner: string): WikiTarget {
  const pipe = inner.indexOf("|");
  const destination = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const label = pipe >= 0 ? inner.slice(pipe + 1).trim() || undefined : undefined;

  const hash = destination.indexOf("#");
  const target = (hash >= 0 ? destination.slice(0, hash) : destination).trim();
  const anchor = hash >= 0 ? destination.slice(hash + 1).trim() : "";

  if (anchor.startsWith("^")) {
    return { target, blockId: anchor.slice(1) || undefined, label };
  }

  return { target, heading: anchor || undefined, label };
}

export interface WikiLinkToken extends Tokens.Generic {
  type: "wikilink";
  raw: string;
  embed: boolean;
  inner: string;
  parts: WikiTarget;
}

export interface ObsidianCommentToken extends Tokens.Generic {
  type: "obsidianComment";
  raw: string;
}

const WIKILINK = /^(!?)\[\[([^[\]\n]+?)\]\]/;
const COMMENT = /^%%[\s\S]*?%%/;

function firstIndex(source: string, needles: string[]): number | undefined {
  const found = needles
    .map((needle) => source.indexOf(needle))
    .filter((index) => index >= 0);

  return found.length > 0 ? Math.min(...found) : undefined;
}

export const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start: (source) => firstIndex(source, ["![[", "[["]),
  tokenizer(source): WikiLinkToken | undefined {
    const match = WIKILINK.exec(source);
    if (!match) return undefined;

    return {
      type: "wikilink",
      raw: match[0],
      embed: match[1] === "!",
      inner: match[2],
      parts: parseWikiTarget(match[2]),
    };
  },
  renderer: (token) => (token as WikiLinkToken).parts.label ?? (token as WikiLinkToken).inner,
};

/** `%%hidden%%` — Obsidian comments are neither shown nor linked. */
export const obsidianCommentExtension: TokenizerAndRendererExtension = {
  name: "obsidianComment",
  level: "inline",
  start: (source) => firstIndex(source, ["%%"]),
  tokenizer(source): ObsidianCommentToken | undefined {
    const match = COMMENT.exec(source);
    return match ? { type: "obsidianComment", raw: match[0] } : undefined;
  },
  renderer: () => "",
};

export const memoryMarkdownExtensions = [wikiLinkExtension, obsidianCommentExtension];

/** Heading text as an anchor: case-folded, punctuation collapsed. */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** Whether a Markdown href leaves the vault: a scheme, or protocol-relative. */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}
