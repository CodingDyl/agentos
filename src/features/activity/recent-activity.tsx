import { Link } from "react-router-dom";
import { EmptyState, HairlineCard, Section } from "@/components/os";
import { useActivity } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { formatTime, sourceLabel, toneFor, type ActivityTone } from "./activity-model";

const TONE_DOT: Record<ActivityTone, string> = {
  quiet: "bg-os-subtle",
  active: "bg-os-amber motion-safe:animate-pulse",
  success: "bg-os-success",
  warning: "bg-os-warning",
  danger: "bg-os-danger",
};

/** Home carries a glance, not a log. */
const HOME_LIMIT = 5;

export interface RecentActivityProps {
  className?: string;
}

/**
 * The last few things that happened, on Home.
 *
 * Read on its own, so a source the adapter cannot reach costs Home nothing but
 * this section. It states what happened and links to the full timeline — Home
 * is not where you audit, only where you notice.
 */
export function RecentActivity({ className }: RecentActivityProps) {
  const { data, isError } = useActivity({ limit: HOME_LIMIT });

  const events = data?.events ?? [];

  return (
    <Section
      label="Recent activity"
      className={className}
      action={
        events.length > 0 ? (
          <Link
            to="/activity"
            className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            All activity
          </Link>
        ) : null
      }
    >
      <HairlineCard className="p-5 md:p-6">
        {events.length === 0 ? (
          <EmptyState
            variant="inline"
            description={
              isError
                ? "The activity timeline could not be read."
                : "Nothing has happened yet today."
            }
          />
        ) : (
          <ul className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="flex min-w-0 items-baseline gap-4">
                <span className="os-meta w-11 shrink-0 text-os-subtle tabular-nums">
                  {formatTime(event.timestamp)}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 translate-y-[-0.15em] rounded-full",
                      TONE_DOT[toneFor(event)],
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate text-[15px] leading-6 text-os-muted">
                    {event.title}
                  </span>
                </span>
                <span className="os-meta hidden shrink-0 text-os-subtle sm:block">
                  {sourceLabel(event.source)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HairlineCard>
    </Section>
  );
}
