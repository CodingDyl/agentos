import type { DesignAsset } from "@shared/agentos-types";

/** The filter value that means "do not narrow". */
export const ALL = "all";

export type TasteItem = Pick<DesignAsset, "filename" | "notes" | "tags" | "sourceUrl" | "attachedTo">;

export interface TasteFilters {
  search: string;
  tag: string;
  workspace: string;
}

/** Search reads the filename, the why-note, the tags and the source URL. */
export function filterTaste<T extends TasteItem>(items: readonly T[], { search, tag, workspace }: TasteFilters): T[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);

  return items.filter((item) => {
    if (workspace !== ALL && !item.attachedTo.includes(workspace)) return false;
    if (tag !== ALL && !item.tags.includes(tag)) return false;
    if (words.length === 0) return true;
    const haystack = [item.filename, item.notes ?? "", item.sourceUrl ?? "", ...item.tags].join("\n").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Every tag in use, alphabetical. */
export function collectTags(items: readonly TasteItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));
}

/**
 * The whole list to send after one toggle: the server replaces `attachedTo`
 * rather than adding to it.
 */
export function toggleAttachment(attachedTo: readonly string[], slug: string): string[] {
  return attachedTo.includes(slug) ? attachedTo.filter((entry) => entry !== slug) : [...attachedTo, slug];
}

/** "dark, Dark , pricing" → ["dark", "Dark", "pricing"] minus blanks and exact repeats. */
export function parseTags(draft: string): string[] {
  return [...new Set(draft.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

/** A source URL without its scheme or trailing slash, for a caption. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

/** Only web links are rendered as links; anything else is shown as text. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
