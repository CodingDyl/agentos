import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TypeSpecimenProps {
  label: string;
  detail: string;
  className?: string;
  children: ReactNode;
}

export function TypeSpecimen({
  label,
  detail,
  className,
  children,
}: TypeSpecimenProps) {
  return (
    <div className="grid gap-3 border-b border-os-border py-5 first:pt-0 last:border-0 last:pb-0 md:grid-cols-[120px_minmax(0,1fr)_120px] md:items-baseline">
      <span className="os-meta text-os-subtle">{label}</span>
      <div className={cn("min-w-0", className)}>{children}</div>
      <span className="font-mono text-[10px] text-os-subtle md:text-right">
        {detail}
      </span>
    </div>
  );
}
