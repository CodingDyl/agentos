import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface HairlineCardProps extends HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  interactive?: boolean;
}

export const HairlineCard = forwardRef<HTMLDivElement, HairlineCardProps>(
  function HairlineCard(
    { className, raised = false, interactive = false, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border border-os-border bg-os-surface/75",
          raised && "bg-os-surface-raised",
          interactive &&
            "transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised",
          className,
        )}
        {...props}
      />
    );
  },
);
