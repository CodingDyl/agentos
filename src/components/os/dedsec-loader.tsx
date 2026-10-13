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
  const size = variant === "page" ? "h-auto w-[min(20rem,72vw)]" : "h-auto w-36";
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
        "flex w-full items-center justify-center",
        // Keep the status in the tree during the delay, but do not paint a
        // tall black stage — that flash is worse than flashing the animation.
        visible && "bg-black",
        visible && (variant === "page" ? "min-h-[min(32rem,70vh)]" : "min-h-40 py-6"),
        className,
      )}
      {...props}
    >
      <span className="sr-only">Loading…</span>
      {visible ? (
        still ? (
          <img src={reduced ? DEDSEC_STILL : DEDSEC_GIF} alt="" className={size} />
        ) : (
          <video
            className={size}
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
