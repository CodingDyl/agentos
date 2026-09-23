import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-label";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  label: string;
  action?: ReactNode;
}

/**
 * A labelled region of a screen. Pairs the mono section label with its content
 * and exposes that label as both the region's accessible name and a heading.
 */
export function Section({
  label,
  action,
  children,
  className,
  ...props
}: SectionProps) {
  const labelId = useId();

  return (
    <section
      aria-labelledby={labelId}
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    >
      <SectionLabel headingId={labelId} action={action}>
        {label}
      </SectionLabel>
      <div className="mt-4 min-w-0 flex-1">{children}</div>
    </section>
  );
}
