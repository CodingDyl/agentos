import { ArrowRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ActionLinkSize = "md" | "lg";
export type ActionLinkTone = "quiet" | "strong";
/** `inline` sits in running text; `block` claims a region and reads as a control. */
export type ActionLinkVariant = "inline" | "block";

const sizeClasses: Record<ActionLinkSize, string> = {
  md: "text-[15px] leading-6",
  lg: "text-[clamp(1.125rem,1.6vw,1.375rem)] leading-[1.35]",
};

const toneClasses: Record<ActionLinkTone, string> = {
  quiet: "text-os-muted hover:text-foreground disabled:hover:text-os-muted",
  strong: "text-foreground",
};

const variantClasses: Record<ActionLinkVariant, string> = {
  inline:
    "-mx-2 -my-1 rounded-md px-2 py-1 decoration-1 underline-offset-[0.35em] hover:underline hover:decoration-os-border-strong disabled:hover:no-underline",
  block:
    "-m-3 rounded-lg border border-transparent p-3 hover:border-os-border-strong hover:bg-os-surface-raised disabled:hover:border-transparent disabled:hover:bg-transparent",
};

export interface ActionLinkProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ActionLinkSize;
  tone?: ActionLinkTone;
  variant?: ActionLinkVariant;
  /** Secondary line naming what the action will actually do. */
  hint?: ReactNode;
}

/**
 * A sentence that is also the control. Used where an action deserves editorial
 * weight rather than button chrome — the dashboard's single next action.
 */
export function ActionLink({
  children,
  className,
  hint,
  size = "md",
  tone = "quiet",
  type = "button",
  variant = "inline",
  ...props
}: ActionLinkProps) {
  return (
    <button
      type={type}
      className={cn(
        "os-focus-ring group block max-w-full cursor-pointer text-left font-normal text-balance transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45",
        sizeClasses[size],
        toneClasses[tone],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      <span className="block">
        {children}
        <ArrowRight
          className="ml-[0.4em] inline-block size-[0.8em] translate-y-[0.06em] text-os-subtle transition-[transform,color] duration-150 group-hover:translate-x-1 group-hover:text-os-amber motion-reduce:group-hover:translate-x-0"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </span>
      {hint ? (
        <span className="os-meta mt-3 block text-os-subtle transition-colors duration-150 group-hover:text-os-muted">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
