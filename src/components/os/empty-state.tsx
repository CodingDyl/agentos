import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-label";

export type EmptyStateVariant = "framed" | "inline";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional when `variant` is `inline` and the surrounding section is already labelled. */
  label?: string;
  description: string;
  action?: ReactNode;
  variant?: EmptyStateVariant;
}

const variantClasses: Record<EmptyStateVariant, string> = {
  framed:
    "min-h-48 justify-end rounded-lg border border-dashed border-os-border p-5 md:p-6",
  inline: "justify-start",
};

export function EmptyState({
  label,
  description,
  action,
  variant = "framed",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {label ? <SectionLabel className="mb-3">{label}</SectionLabel> : null}
      <p className="text-[15px] leading-6 text-os-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
