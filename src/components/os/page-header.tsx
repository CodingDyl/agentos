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
        "flex flex-col gap-4 md:flex-row md:items-start md:justify-between",
        className,
      )}
      {...props}
    >
      <div className="max-w-2xl">
        <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.02em] text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-[68ch] text-[14px] leading-[22px] text-os-muted">
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
