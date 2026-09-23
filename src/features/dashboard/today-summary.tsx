import { EmptyState, HairlineCard, Section, TimelineRow } from "@/components/os";
import type { CalendarItem } from "./dashboard-model";

export interface TodaySummaryProps {
  items: CalendarItem[];
  /** Marks the section as illustrative until a calendar adapter exists. */
  isPlaceholder?: boolean;
  className?: string;
}

/** Today's time constraints. Nothing scheduled is information, not an absence. */
export function TodaySummary({
  items,
  isPlaceholder = false,
  className,
}: TodaySummaryProps) {
  const hasItems = items.length > 0;

  return (
    <Section
      label="Today"
      className={className}
      action={
        isPlaceholder
          ? "Placeholder"
          : hasItems
            ? `${items.length} ${items.length === 1 ? "event" : "events"}`
            : undefined
      }
    >
      <HairlineCard className="px-5 py-3 md:px-6">
        {hasItems ? (
          <ul className="divide-y divide-os-border">
            {items.map((item) => (
              <TimelineRow
                key={item.id}
                time={item.time}
                title={item.title}
                detail={item.detail}
                state={item.state}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            variant="inline"
            className="py-2"
            description="Nothing scheduled. The day is yours to spend."
          />
        )}
      </HairlineCard>
    </Section>
  );
}
