import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/os/section-label";

export interface SpecimenSectionProps extends HTMLAttributes<HTMLElement> {
  label: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function SpecimenSection({
  label,
  title,
  description,
  children,
  className,
  ...props
}: SpecimenSectionProps) {
  return (
    <section
      className={cn(
        "grid gap-6 border-t border-os-border pt-8 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-10",
        className,
      )}
      {...props}
    >
      <SectionLabel className="self-start lg:pt-1">{label}</SectionLabel>
      <div className="min-w-0">
        <div className="max-w-2xl">
          <h2 className="text-[22px] leading-[1.15] font-normal tracking-[-0.02em]">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 text-[13px] leading-5 text-os-muted">
              {description}
            </p>
          ) : null}
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
