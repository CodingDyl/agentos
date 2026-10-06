import type { DesignAsset, DesignAssetType } from "@shared/agentos-types";
import type { MotionPromptSource } from "@shared/motion-types";

/**
 * The design library's view model.
 *
 * This page is a media browser rather than a document screen, so most of the
 * work here is about layout and finding: how tiles fill columns without leaving
 * one long and one short, and what counts as a match when you type.
 */

export type LibraryFilter = "all" | DesignAssetType | "favorites" | "approved" | "videos";

export const LIBRARY_FILTERS: readonly {
  value: LibraryFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "uploaded", label: "Inspiration" },
  { value: "generated", label: "Generated" },
  { value: "videos", label: "Videos" },
  { value: "reference", label: "References" },
  { value: "approved", label: "Approved" },
  { value: "favorites", label: "Favourites" },
];

/**
 * The project filter's value for work that belongs to no project.
 *
 * A real value rather than an absence, because "show me the loose experiments"
 * is a question the feed has to be able to answer — otherwise anything made
 * without a project is only findable by scrolling past everything else.
 */
export const UNASSIGNED = "__unassigned__";

const TYPE_LABELS: Record<DesignAssetType, string> = {
  uploaded: "Uploaded",
  generated: "Generated",
  reference: "Reference",
  screenshot: "Screenshot",
};

export function typeLabel(type: DesignAssetType): string {
  return TYPE_LABELS[type];
}

/**
 * Whether an asset answers what was typed.
 *
 * Searches the things a person would actually remember about an image — what it
 * was called, what it was tagged, which project it belongs to, and the note
 * left on it. Every term must match something, so typing more narrows.
 */
export function matchesSearch(asset: DesignAsset, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [
    asset.filename,
    asset.project ?? "",
    asset.product ?? "",
    asset.model ?? "",
    asset.notes ?? "",
    asset.prompt ?? "",
    ...asset.tags,
  ]
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

export interface LibraryQuery {
  search: string;
  filter: LibraryFilter;
  project: string | "all";
  /** A product within the project, e.g. `chef`. */
  product?: string | "all";
  /** Where it came from: `higgsfield`, `upload`, … */
  source?: string | "all";
}

export function filterAssets(
  assets: DesignAsset[],
  query: LibraryQuery,
): DesignAsset[] {
  return assets.filter((asset) => {
    // References are what a generation was given, not work: kept for
    // provenance and under their own filter, but out of the main feed.
    if (query.filter === "all" && asset.type === "reference") return false;
    if (query.filter === "favorites" && !asset.favorite) return false;
    if (query.filter === "approved" && !asset.approved) return false;
    if (query.filter === "videos" && asset.mediaType !== "video") return false;
    if (
      query.filter !== "all" &&
      query.filter !== "favorites" &&
      query.filter !== "approved" &&
      query.filter !== "videos" &&
      asset.type !== query.filter
    ) {
      return false;
    }

    if (query.project === UNASSIGNED) {
      if (asset.project) return false;
    } else if (query.project !== "all" && asset.project !== query.project) {
      return false;
    }

    if (query.product && query.product !== "all" && asset.product !== query.product) {
      return false;
    }

    if (query.source && query.source !== "all" && asset.source !== query.source) {
      return false;
    }

    return matchesSearch(asset, query.search);
  });
}

/** Products present in a set of assets, for the filter bar. */
export function collectProducts(assets: DesignAsset[]): string[] {
  return [
    ...new Set(
      assets.map((asset) => asset.product).filter((entry): entry is string => !!entry),
    ),
  ].sort();
}

/** Sources present, so the bar never offers a filter that would empty the feed. */
export function collectSources(assets: DesignAsset[]): string[] {
  return [...new Set(assets.map((asset) => asset.source))].sort();
}

/** Every tag in the library, most used first. Used to suggest, not to filter. */
export function collectTags(assets: DesignAsset[]): string[] {
  const counts = new Map<string, number>();

  for (const asset of assets) {
    for (const tag of asset.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** The shape a tile will take, before its image has loaded. */
/** `75` → `1:15`. */
export function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Whether a video asset has a poster frame to show in place of the video. */
export function hasPoster(asset: DesignAsset): boolean {
  return asset.thumbnailUrl.includes("size=thumbnail");
}

export function aspectRatio(asset: DesignAsset): number {
  if (!asset.width || !asset.height) return 1;
  return asset.width / asset.height;
}

/**
 * Fills columns for a masonry grid.
 *
 * CSS columns would fill the first column completely before starting the
 * second, which puts every recent asset in one column — wrong for a library
 * ordered newest first. This walks the assets in order and drops each one into
 * whichever column is currently shortest, so reading order runs across the grid
 * and the columns still end up level.
 *
 * Height is measured in aspect ratio: at equal column width, a tile's relative
 * height is `1 / (width / height)`.
 */
export function distributeIntoColumns(
  assets: DesignAsset[],
  columnCount: number,
): DesignAsset[][] {
  const count = Math.max(1, Math.trunc(columnCount));
  const columns: DesignAsset[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);

  for (const asset of assets) {
    let shortest = 0;
    for (let index = 1; index < count; index += 1) {
      if (heights[index] < heights[shortest]) shortest = index;
    }

    columns[shortest].push(asset);
    heights[shortest] += 1 / aspectRatio(asset);
  }

  return columns;
}

/** `2026-09-07T…` → `7 Sep`. Enough to place an asset without crowding it. */
export function formatAdded(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(date);
}

/** Boards an asset is on, resolved to their names. */
export function boardsFor(
  asset: DesignAsset,
  boards: { id: string; name: string }[],
): { id: string; name: string }[] {
  return boards.filter((board) => asset.boardIds.includes(board.id));
}

/** Where a motion prompt came from, as a label: the vault note's name, or "Built-in". */
export function sourceLabel(source: MotionPromptSource): string {
  return source.source === "vault" && source.path ? `Vault · ${source.path.split("/").pop()?.replace(/\.md$/, "")}` : "Built-in";
}
