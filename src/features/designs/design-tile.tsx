import { Heart, Layers, Maximize2 } from "lucide-react";
import type { DesignAsset } from "@shared/agentos-types";
import { cn } from "@/lib/utils";
import { aspectRatio } from "./designs-model";

export interface DesignTileProps {
  asset: DesignAsset;
  onOpen: (asset: DesignAsset) => void;
  onToggleFavorite: (asset: DesignAsset) => void;
  onAddToBoard: (asset: DesignAsset) => void;
  /** Shown instead of the board action when the tile sits inside a board. */
  onRemoveFromBoard?: (asset: DesignAsset) => void;
  /**
   * Present only while the library is selecting references for a review.
   *
   * When it is, the picture stops being a way in and becomes a checkbox: a
   * tile that opened the lightbox on click would make choosing six images a
   * fight against the interface.
   */
  onToggleSelect?: (asset: DesignAsset) => void;
  selected?: boolean;
}

/**
 * One image in the library.
 *
 * The tile carries almost no chrome: the picture is the interface, and
 * everything else waits for a hover. The frame reserves the image's real aspect
 * ratio before it loads, so the grid never reflows as pictures arrive.
 */
export function DesignTile({
  asset,
  onOpen,
  onToggleFavorite,
  onAddToBoard,
  onRemoveFromBoard,
  onToggleSelect,
  selected = false,
}: DesignTileProps) {
  const selecting = Boolean(onToggleSelect);

  return (
    <figure className="group relative">
      <button
        type="button"
        onClick={() => (selecting ? onToggleSelect?.(asset) : onOpen(asset))}
        aria-label={
          selecting
            ? `${selected ? "Deselect" : "Select"} ${asset.filename}`
            : `Open ${asset.filename}`
        }
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          "os-focus-ring block w-full cursor-pointer overflow-hidden rounded-md bg-os-surface",
          "ring-1 transition-[box-shadow] duration-150",
          // Selection is carried by the ring rather than an overlay, so the
          // image — the only thing worth looking at here — stays unobscured.
          selected
            ? "ring-2 ring-os-amber"
            : "ring-os-border hover:ring-os-border-strong",
        )}
        style={{ aspectRatio: aspectRatio(asset) }}
      >
        <img
          src={asset.thumbnailUrl}
          alt={asset.filename}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      </button>

      {selecting ? (
        <span
          className={cn(
            "pointer-events-none absolute top-2.5 left-2.5 grid size-5 place-items-center rounded-full border text-[11px] font-mono",
            selected
              ? "border-os-amber bg-os-amber text-os-background"
              : "border-os-border-strong bg-os-background/70 text-transparent",
          )}
          aria-hidden="true"
        >
          ✓
        </span>
      ) : null}

      {/* A favourited asset says so without a hover; nothing else does. */}
      {asset.favorite ? (
        <span
          className="pointer-events-none absolute top-2.5 right-2.5 rounded-full bg-os-background/70 p-1.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0"
          aria-hidden="true"
        >
          <Heart className="size-3.5 fill-os-amber text-os-amber" strokeWidth={1.5} />
        </span>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 rounded-b-md p-2.5",
          "bg-gradient-to-t from-os-background/90 to-transparent",
          "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <TileAction
          label={asset.favorite ? "Remove favourite" : "Favourite"}
          onClick={() => onToggleFavorite(asset)}
          active={asset.favorite}
        >
          <Heart
            className={cn("size-3.5", asset.favorite && "fill-current")}
            strokeWidth={1.5}
          />
        </TileAction>

        {onRemoveFromBoard ? (
          <TileAction
            label="Remove from board"
            onClick={() => onRemoveFromBoard(asset)}
          >
            <Layers className="size-3.5" strokeWidth={1.5} />
          </TileAction>
        ) : (
          <TileAction label="Add to board" onClick={() => onAddToBoard(asset)}>
            <Layers className="size-3.5" strokeWidth={1.5} />
          </TileAction>
        )}

        <TileAction label="Open" onClick={() => onOpen(asset)} className="ml-auto">
          <Maximize2 className="size-3.5" strokeWidth={1.5} />
        </TileAction>
      </div>

      <figcaption className="mt-2 min-w-0 px-0.5">
        {asset.project ? (
          <span className="os-meta block truncate text-os-subtle">
            {asset.project}
          </span>
        ) : null}
        <span className="mt-1 block truncate text-[13px] leading-5 text-os-muted">
          {asset.filename}
        </span>
      </figcaption>
    </figure>
  );
}

interface TileActionProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}

function TileAction({
  label,
  onClick,
  active = false,
  className,
  children,
}: TileActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "os-focus-ring pointer-events-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-md",
        "bg-os-background/60 transition-colors duration-150 hover:bg-os-surface-raised",
        active ? "text-os-amber" : "text-os-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
