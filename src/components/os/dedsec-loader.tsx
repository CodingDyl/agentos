import { useEffect, useState, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const DEDSEC_GIF = new URL("../../assets/loading/dedsec.gif", import.meta.url).href;
const DEDSEC_WEBM = new URL("../../assets/loading/dedsec.webm", import.meta.url).href;
const DEDSEC_STILL = new URL("../../assets/loading/dedsec-still.webp", import.meta.url).href;

/** Hide the animation for this long so a fast read does not flash a loader. */
export const DEDSEC_SHOW_DELAY_MS = 150;

export type DedsecLoaderVariant = "page" | "compact";

export interface DedsecLoaderProps extends HTMLAttributes<HTMLDivElement> {
  /** `page` fills a route or stage; `compact` sits inside a card or panel. */
  variant?: DedsecLoaderVariant;
  /** Override the flash-avoidance delay. `0` shows the animation immediately. */
  delayMs?: number;
}

function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Square media fills the parent width; max-height + contain prevent overflow. */
const MEDIA_CLASS =
  "aspect-square h-auto w-full max-h-full object-contain [image-rendering:pixelated]";

/**
 * Shared Watch Dogs DedSec loading animation.
 *
 * Used for every route and section wait. Button-sized spinners stay as they
 * are — this is for a page or a panel, not a control.
 */
export function DedsecLoader({
  variant = "page",
  delayMs = DEDSEC_SHOW_DELAY_MS,
  className,
  ...props
}: DedsecLoaderProps) {
  const [shown, setShown] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const reduced = prefersReducedMotion();
  const visible = delayMs <= 0 || shown;
  const still = reduced || videoFailed;

  useEffect(() => {
    if (delayMs <= 0) return;
    const id = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);

  return (
    <div
      role="status"
      aria-busy="true"
      data-variant={variant}
      className={cn(
        "flex h-full min-h-0 w-full items-center justify-center overflow-hidden",
        className,
      )}
      {...props}
    >
      <span className="sr-only">Loading…</span>
      {visible ? (
        still ? (
          <img src={reduced ? DEDSEC_STILL : DEDSEC_GIF} alt="" className={MEDIA_CLASS} />
        ) : (
          <video
            className={MEDIA_CLASS}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
            poster={DEDSEC_STILL}
            onError={() => setVideoFailed(true)}
          >
            <source src={DEDSEC_WEBM} type="video/webm" onError={() => setVideoFailed(true)} />
          </video>
        )
      ) : null}
    </div>
  );
}
