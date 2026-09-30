import { Heart, Layers, Maximize2, Play } from "lucide-react";
import { useState } from "react";
import type { DesignAsset } from "@shared/agentos-types";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";
import { aspectRatio, formatDuration, hasPoster } from "./designs-model";

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
  const video = asset.mediaType === "video";
  // A video previews itself, muted, only while the pointer is on it: a grid of
  // autoplaying films would be a wall of motion nobody asked for.
  const [previewing, setPreviewing] = useState(false);

  return (
    <figure
      className="group"
      onPointerEnter={video ? () => setPreviewing(true) : undefined}
      onPointerLeave={video ? () => setPreviewing(false) : undefined}
    >
      <div className="relative">
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
            "block w-full cursor-pointer overflow-hidden rounded-none bg-paper-linen",
            "ring-1 transition-[box-shadow] duration-150",
            PAPER_FOCUS,
            // Selection is carried by the ring rather than an overlay, so the
            // image — the only thing worth looking at here — stays unobscured.
            selected
              ? "ring-2 ring-paper-blue"
              : "ring-paper-mist hover:ring-paper-sage",
          )}
          style={{ aspectRatio: aspectRatio(asset) }}
        >
          {video && !hasPoster(asset) ? (
            <video src={asset.url} preload="metadata" muted playsInline className="size-full object-cover" aria-label={asset.filename} />
          ) : (
            <img
              src={asset.thumbnailUrl}
              alt={asset.filename}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          )}
          {video && previewing ? (
            <video
              src={asset.url}
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
              className="absolute inset-0 size-full object-cover motion-reduce:hidden"
            />
          ) : null}
        </button>

        {video ? (
          <span
            className="pointer-events-none absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-none bg-paper-moss/85 px-1.5 py-0.5 font-paper-utility text-[11.5px] font-medium tracking-[0.06em] text-paper-white tabular-nums transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
          >
            <Play className="size-3 fill-current" strokeWidth={0} aria-hidden="true" />
            {formatDuration(asset.durationSec) || "Video"}
          </span>
        ) : null}

        {selecting ? (
          <span
            className={cn(
              "pointer-events-none absolute top-2.5 left-2.5 grid size-5 place-items-center rounded-full border text-[11px] font-mono",
              selected
                ? "border-paper-blue bg-paper-blue text-paper-white"
                : "border-paper-sage bg-paper-white/85 text-transparent",
            )}
            aria-hidden="true"
          >
            ✓
          </span>
        ) : null}

        {/* A favourited asset says so without a hover; nothing else does. */}
        {asset.favorite ? (
          <span
            className="pointer-events-none absolute top-2.5 right-2.5 rounded-full bg-paper-white/90 p-1.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0"
            aria-hidden="true"
          >
            <Heart className="size-3.5 fill-paper-amber text-paper-amber-deep" strokeWidth={1.5} />
          </span>
        ) : null}

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 p-2",
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

      </div>

      <figcaption className="mt-2 min-w-0 px-0.5">
        {asset.project ? (
          <span className="block truncate text-[12px] font-medium text-paper-sage">
            {asset.project}
          </span>
        ) : null}
        <span className="mt-0.5 block truncate text-[13px] leading-5 text-paper-char">
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
        "pointer-events-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-none border border-paper-mist",
        "bg-paper-white/90 transition-colors duration-150 hover:bg-paper-white",
        PAPER_FOCUS,
        active ? "text-paper-amber-deep" : "text-paper-char hover:text-paper-moss",
        className,
      )}
    >
      {children}
    </button>
  );
}
