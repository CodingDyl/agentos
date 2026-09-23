import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-label";
import { SystemIndicator } from "./system-indicator";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  /** What the system is doing, in the product's own voice. */
  message: string;
  detail?: string;
}

/**
 * A screen waiting on data. States what is being read rather than spinning —
 * see DESIGN.md §12.8: prefer a meaningful status over a spinner.
 */
export function LoadingState({
  label,
  message,
  detail,
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      className={cn("flex flex-col gap-5", className)}
      role="status"
      aria-live="polite"
      {...props}
    >
      <SectionLabel>{label}</SectionLabel>
      <p className="text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.1] font-normal tracking-[-0.02em] text-os-muted">
        {message}
      </p>
      {detail ? <SystemIndicator state="syncing" label={detail} /> : null}
    </div>
  );
}
