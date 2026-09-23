import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, HairlineCard, Section } from "@/components/os";
import type { AutomationAlert } from "@/features/automations";

export interface WatchItemProps {
  watch?: string;
  /**
   * Automations that did not do what they were scheduled to do. Empty on an
   * ordinary day — this is a risk list, not a status list.
   */
  alerts?: AutomationAlert[];
  className?: string;
}

/** The risks worth carrying into the day. Usually one, often none. */
export function WatchItem({ watch, alerts = [], className }: WatchItemProps) {
  const hasContent = Boolean(watch) || alerts.length > 0;

  return (
    <Section label="Watch" className={className}>
      <HairlineCard className="p-5 md:p-6">
        {hasContent ? (
          <div className="space-y-5">
            {watch ? (
              <div className="flex gap-3">
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0 text-os-warning"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <p className="max-w-[62ch] text-[15px] leading-6 text-os-muted">
                  {watch}
                </p>
              </div>
            ) : null}

            {alerts.map((alert) => (
              // The automation itself is one click away: a failure is only
              // useful next to what failed.
              <Link
                key={alert.id}
                to={alert.href}
                className="os-focus-ring -mx-2 flex gap-3 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-os-surface-raised"
              >
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0 text-os-danger"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block max-w-[62ch] text-[15px] leading-6 text-foreground">
                    {alert.name}
                  </span>
                  <span className="os-meta mt-1.5 block text-os-subtle">
                    {alert.summary}
                  </span>
                  {alert.detail ? (
                    <span className="mt-2 block max-w-[62ch] truncate font-mono text-[12px] leading-5 text-os-danger">
                      {alert.detail}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            variant="inline"
            description="Nothing flagged. No risks in view."
          />
        )}
      </HairlineCard>
    </Section>
  );
}
