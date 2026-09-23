import { useEffect, useMemo, useState } from "react";
import type { DesignAsset } from "@shared/agentos-types";
import { cn } from "@/lib/utils";
import { DesignTile } from "./design-tile";
import { distributeIntoColumns } from "./designs-model";

/**
 * How many columns the grid uses at each width.
 *
 * Read with `matchMedia` rather than CSS, because the columns are filled in
 * JavaScript — the layout needs the number, not just the styling.
 */
const BREAKPOINTS: readonly { query: string; columns: number }[] = [
  { query: "(min-width: 1536px)", columns: 5 },
  { query: "(min-width: 1024px)", columns: 4 },
  { query: "(min-width: 640px)", columns: 3 },
];

const NARROW_COLUMNS = 2;

function readColumnCount(): number {
  if (typeof window === "undefined") return NARROW_COLUMNS;

  return (
    BREAKPOINTS.find((breakpoint) => window.matchMedia(breakpoint.query).matches)
      ?.columns ?? NARROW_COLUMNS
  );
}

function useColumnCount(): number {
  const [columns, setColumns] = useState(readColumnCount);

  useEffect(() => {
    const lists = BREAKPOINTS.map((breakpoint) =>
      window.matchMedia(breakpoint.query),
    );

    const update = () => setColumns(readColumnCount());

    for (const list of lists) list.addEventListener("change", update);
    return () => {
      for (const list of lists) list.removeEventListener("change", update);
    };
  }, []);

  return columns;
}

export interface DesignGridProps {
  assets: DesignAsset[];
  onOpen: (asset: DesignAsset) => void;
  onToggleFavorite: (asset: DesignAsset) => void;
  onAddToBoard: (asset: DesignAsset) => void;
  onRemoveFromBoard?: (asset: DesignAsset) => void;
  /** Present only while references are being selected for a review. */
  onToggleSelect?: (asset: DesignAsset) => void;
  selectedIds?: readonly string[];
  className?: string;
}

/**
 * The masonry grid.
 *
 * Tiles keep their own proportions rather than being cropped into a uniform
 * card, which is what makes a library of references read as a moodboard instead
 * of a table of thumbnails.
 */
export function DesignGrid({
  assets,
  onOpen,
  onToggleFavorite,
  onAddToBoard,
  onRemoveFromBoard,
  onToggleSelect,
  selectedIds,
  className,
}: DesignGridProps) {
  const columnCount = useColumnCount();

  const columns = useMemo(
    () => distributeIntoColumns(assets, columnCount),
    [assets, columnCount],
  );

  return (
    <div className={cn("flex gap-4", className)}>
      {columns.map((column, index) => (
        <div
          // Columns are positional: there is nothing else to key them by, and
          // their contents carry their own keys.
          key={index}
          className="flex min-w-0 flex-1 flex-col gap-4"
        >
          {column.map((asset) => (
            <DesignTile
              key={asset.id}
              asset={asset}
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
              onAddToBoard={onAddToBoard}
              onRemoveFromBoard={onRemoveFromBoard}
              onToggleSelect={onToggleSelect}
              selected={selectedIds?.includes(asset.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
