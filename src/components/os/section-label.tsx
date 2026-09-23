import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  action?: ReactNode;
  /**
   * Renders the label as an `h2` carrying this id, so a region can name itself
   * via `aria-labelledby` and the document keeps a real heading outline.
   */
  headingId?: string;
}

export function SectionLabel({
  action,
  headingId,
  children,
  className,
  ...props
}: SectionLabelProps) {
  return (
    <div
      className={cn(
        "os-meta flex min-h-5 items-center justify-between gap-4 text-os-subtle",
        className,
      )}
      {...props}
    >
      {headingId ? (
        <h2 id={headingId}>{children}</h2>
      ) : (
        <span>{children}</span>
      )}
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
