import { EmptyState, HairlineCard, Section } from "@/components/os";

export interface RecentProgressProps {
  progress?: string;
  className?: string;
}

/** One line on what moved. Not an activity feed. */
export function RecentProgress({ progress, className }: RecentProgressProps) {
  return (
    <Section label="Recent progress" className={className}>
      <HairlineCard className="p-5 md:p-6">
        {progress ? (
          <p className="max-w-[68ch] text-[15px] leading-6 text-os-muted">
            {progress}
          </p>
        ) : (
          <EmptyState
            variant="inline"
            description="No progress recorded since the last session."
          />
        )}
      </HairlineCard>
    </Section>
  );
}
