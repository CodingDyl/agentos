import { RefreshCw } from "lucide-react";
import {
  CommandButton,
  HairlineCard,
  SectionLabel,
  SystemIndicator,
} from "@/components/os";

/**
 * Read failures are shown, never papered over with placeholder content: a
 * dashboard that invents state is worse than one that says it cannot read.
 */

export function DashboardLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-5 py-8 sm:px-8 lg:px-12 lg:py-12"
      role="status"
      aria-live="polite"
    >
      <SectionLabel>AgentOS</SectionLabel>
      <p className="text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.1] font-normal tracking-[-0.02em] text-os-muted">
        Reading system state…
      </p>
      <SystemIndicator state="syncing" label="Vault / reading" />
    </div>
  );
}

export interface DashboardErrorProps {
  error: Error | null;
  onRetry: () => void;
  isRetrying?: boolean;
}

export function DashboardError({
  error,
  onRetry,
  isRetrying = false,
}: DashboardErrorProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <HairlineCard className="max-w-[62ch] p-5 md:p-6">
        <SectionLabel>AgentOS data unavailable</SectionLabel>
        <p className="mt-5 text-[clamp(1.25rem,2vw,1.5rem)] leading-[1.2] font-normal tracking-[-0.02em]">
          Could not read <span className="font-mono">~/AgentOS</span>.
        </p>
        {error ? (
          <p className="os-meta mt-4 text-os-subtle">{error.message}</p>
        ) : null}
        <p className="mt-5 text-[13px] leading-5 text-os-muted">
          The data adapter reads the vault directly. Check that it is running —{" "}
          <span className="font-mono text-os-subtle">npm run dev</span> starts it
          alongside the app.
        </p>
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
      </HairlineCard>
    </div>
  );
}
