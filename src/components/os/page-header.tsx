import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-6 border-b border-os-border pb-8 md:flex-row md:items-end md:justify-between",
        className,
      )}
      {...props}
    >
      <div className="max-w-2xl">
        <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-normal tracking-[-0.03em] text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-4 max-w-[68ch] text-[15px] leading-6 text-os-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
