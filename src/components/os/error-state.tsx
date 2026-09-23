import { RefreshCw } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CommandButton } from "./command-button";
import { HairlineCard } from "./hairline-card";
import { SectionLabel } from "./section-label";

export interface ErrorStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  label: string;
  title: ReactNode;
  /** The underlying failure, shown verbatim so the cause is not hidden. */
  detail?: string;
  /** What the operator can do about it. */
  hint?: ReactNode;
  onRetry?: () => void;
  isRetrying?: boolean;
}

/**
 * A read that failed. Never replaced with placeholder content — a screen that
 * invents state is worse than one that says it could not read.
 */
export function ErrorState({
  label,
  title,
  detail,
  hint,
  onRetry,
  isRetrying = false,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <HairlineCard
      className={cn("max-w-[62ch] p-5 md:p-6", className)}
      role="alert"
      {...props}
    >
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-5 text-[clamp(1.25rem,2vw,1.5rem)] leading-[1.2] font-normal tracking-[-0.02em]">
        {title}
      </p>
      {detail ? <p className="os-meta mt-4 text-os-subtle">{detail}</p> : null}
      {hint ? (
        <p className="mt-5 text-[13px] leading-5 text-os-muted">{hint}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-6">
          <CommandButton
            variant="secondary"
            icon={RefreshCw}
            iconPosition="start"
            loading={isRetrying}
            loadingLabel="Retrying"
            onClick={onRetry}
          >
            Retry
          </CommandButton>
        </div>
      ) : null}
    </HairlineCard>
  );
}
