import type { MemoryGraphNode } from "@shared/memory-types";

/**
 * The graph's visual rules, kept out of the canvas code so they can be read
 * and tested on their own.
 */

export type ColorBy = "folder" | "tag";

/**
 * Group colours, drawn on the Hermes Blue field. Paper and yellow first — the
 * two the brand actually uses — then tints that stay light enough to read on
 * blue (every one ≥ 4.5:1 against #0000f2). Groups past the palette share the
 * last, quietest colour and the legend says "other".
 */
export const GROUP_COLORS = ["#f2f2f2", "#f2f200", "#7fe6ff", "#ffa8dc", "#ffc27a", "#9dffb8", "#d6ccff"] as const;
export const OTHER_COLOR = "#a9a9f2";
export const FIELD = "#0000f2";
export const INK = "#000091";

/** The top-level folder, or the first tag; `""` when there is none. */
export function groupOf(node: Pick<MemoryGraphNode, "folder" | "tags" | "unresolved">, by: ColorBy): string {
  if (node.unresolved) return "";
  if (by === "tag") return node.tags[0] ?? "";
  return node.folder.split("/")[0] ?? "";
}

export interface Legend {
  colors: Map<string, string>;
  entries: Array<{ group: string; color: string; count: number }>;
  other: number;
}

/** Largest groups get the named colours, so the legend explains most of the graph. */
export function buildLegend(nodes: readonly MemoryGraphNode[], by: ColorBy): Legend {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.unresolved) continue;
    const group = groupOf(node, by);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const colors = new Map<string, string>();
  const entries: Legend["entries"] = [];
  let other = 0;

  ranked.forEach(([group, count], index) => {
    const color = index < GROUP_COLORS.length ? GROUP_COLORS[index] : OTHER_COLOR;
    colors.set(group, color);
    if (index < GROUP_COLORS.length) entries.push({ group, color, count });
    else other += count;
  });

  return { colors, entries, other };
}

/**
 * Node radius from degree, square-rooted and capped, so a hub note that links
 * everywhere is visibly bigger without swallowing its neighbours.
 */
export function nodeRadius(degree: number): number {
  return 3 + Math.min(7, Math.sqrt(degree) * 1.6);
}

export function groupLabel(group: string, by: ColorBy): string {
  if (group) return by === "tag" ? `#${group}` : `${group}/`;
  return by === "tag" ? "No tag" : "Vault root";
}
