import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DedsecLoader } from "@/components/os";
import { cn } from "@/lib/utils";
import { PAPER_FOCUS, PaperButton } from "./paper";

/**
 * Page furniture for screens on the paper world: the header every moved screen
 * opens with, and the three states a read can be in.
 *
 * List filters live on the shared `FilterToolbar` in `components/os`. Loading
 * uses the shared DedSec loop; an error still shows the underlying failure
 * rather than placeholder content.
 */

export function PaperPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance text-paper-moss sm:text-[34px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-[72ch] text-[13.5px] leading-5 text-paper-sage" aria-live="polite">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A quiet way back to the parent screen, above a page's header. */
export function PaperBackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "-mx-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-none px-2 text-[13.5px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
        PAPER_FOCUS,
      )}
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {children}
    </Link>
  );
}

/** A screen waiting on data. The DedSec loop is the wait. */
export function PaperLoading({ className }: { title: string; message: string; className?: string }) {
  return <DedsecLoader variant="page" className={className} />;
}

/** A framed, quiet "nothing here". Says why, and optionally what to do. */
export function PaperEmpty({
  title,
  description,
  action,
  className,
}: {
  title?: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-none border border-dashed border-paper-mist bg-paper-cream px-5 py-6", className)}>
      {title ? <p className="font-paper-display text-[16px] font-bold tracking-[-0.01em] text-paper-moss">{title}</p> : null}
      <p className={cn("max-w-[64ch] text-[14px] leading-6 text-paper-char", title && "mt-1")}>{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A read that failed. The cause is shown verbatim so it is never hidden. */
export function PaperError({
  title,
  detail,
  hint,
  onRetry,
  isRetrying = false,
  headingLevel = "h1",
  className,
}: {
  title: ReactNode;
  detail?: string;
  hint?: ReactNode;
  onRetry?: () => void;
  isRetrying?: boolean;
  /** `h2` when the error sits inside a page that already has its own title. */
  headingLevel?: "h1" | "h2";
  className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div role="alert" className={cn("max-w-[72ch] rounded-none border border-paper-flame-deep px-5 py-4", className)}>
      <Heading data-heading="compact" className="font-paper-display text-[21px] font-bold tracking-[-0.015em] text-paper-moss">{title}</Heading>
      {detail ? <p className="mt-2 font-mono text-[12.5px] leading-5 break-words text-paper-flame-deep">{detail}</p> : null}
      {hint ? <p className="mt-2 text-[13.5px] leading-6 text-paper-char">{hint}</p> : null}
      {onRetry ? (
        <PaperButton variant="amber" className="mt-4" disabled={isRetrying} onClick={onRetry}>
          {isRetrying ? "Trying again…" : "Try again"}
        </PaperButton>
      ) : null}
    </div>
  );
}

export type IndicatorTone = "green" | "amber" | "marigold" | "flame" | "muted";

const INDICATOR_DOT: Record<IndicatorTone, string> = {
  green: "bg-paper-green",
  amber: "bg-paper-amber motion-safe:animate-pulse",
  marigold: "bg-paper-marigold outline outline-1 outline-paper-moss",
  flame: "bg-paper-flame-deep",
  muted: "bg-paper-ash",
};

/**
 * A state as a dot and a word. The dot carries colour; the word carries the
 * meaning, so state is never colour alone.
 */
export function PaperIndicator({
  tone,
  label,
  detail,
  className,
}: {
  tone: IndicatorTone;
  label: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={detail ? `${label}: ${detail}` : label} className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", INDICATOR_DOT[tone])} aria-hidden="true" />
      <span className="text-[13px] font-medium text-paper-char">{label}</span>
      {detail ? <span className="text-[13px] text-paper-sage">{detail}</span> : null}
    </div>
  );
}

/** A quiet in-page note: a partial read, a caveat. Not an error. */
export function PaperNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("rounded-none border border-paper-mist bg-paper-cream px-4 py-3 text-[13.5px] leading-6 text-paper-char", className)}>
      {children}
    </div>
  );
}
