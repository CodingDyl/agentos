import { Link } from "react-router-dom";
import type {
  MissionAutomation,
  MissionWorker,
  SystemComponent,
} from "@shared/mission-control-types";
import { EmptyState, Section, StatusPill } from "@/components/os";
import { formatRunTime } from "@/features/automations";
import { cn } from "@/lib/utils";
import { isLoud, statusLabel, statusPill } from "./mission-control-model";

/**
 * The compact strips: workers, automations, and the system itself.
 *
 * All three answer the same shape of question — is this thing alright? — so
 * they read the same way, and none of them tries to be the screen that owns its
 * subject. Mission Control is not a second Workers page or a second Automations
 * page; each row is a link to the real one.
 *
 * The rule they share: **only something wrong is allowed to be loud.** A
 * healthy row is a name and a quiet word. Explanation appears when there is a
 * problem, which is what makes the explanation worth reading.
 */

export interface WorkerStripProps {
  workers: MissionWorker[];
  className?: string;
}

export function WorkerStrip({ workers, className }: WorkerStripProps) {
  return (
    <Section
      label="Workers"
      className={className}
      action={<StripLink to="/workers">All workers</StripLink>}
    >
      {workers.length === 0 ? (
        <EmptyState variant="inline" description="No workers are declared." />
      ) : (
        <ul className="space-y-3">
          {workers.map((worker) => (
            <li key={worker.id}>
              <Link
                to={worker.href}
                className="os-focus-ring group flex min-w-0 items-center gap-3 rounded-md py-0.5"
              >
                <StatusPill
                  status={statusPill(worker.status)}
                  label={statusLabel(worker.status)}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-os-muted transition-colors duration-150 group-hover:text-foreground">
                  {worker.name}
                </span>
                {worker.detail ? (
                  <span
                    className={cn(
                      "os-meta shrink-0 truncate",
                      isLoud(worker.status) ? "text-os-warning" : "text-os-subtle",
                    )}
                  >
                    {worker.detail}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export interface AutomationStripProps {
  automations: MissionAutomation[];
  degraded: boolean;
  className?: string;
}

export function AutomationStrip({
  automations,
  degraded,
  className,
}: AutomationStripProps) {
  return (
    <Section
      label="Automations"
      className={className}
      action={<StripLink to="/automations">All automations</StripLink>}
    >
      {automations.length === 0 ? (
        <EmptyState
          variant="inline"
          description={
            // An empty list because nothing could be read is not the same
            // claim as an empty list because nothing is scheduled.
            degraded
              ? "Hermes' schedule could not be read."
              : "Nothing is scheduled."
          }
        />
      ) : (
        <ul className="space-y-3">
          {automations.map((automation) => (
            <li key={automation.id}>
              <Link
                to={automation.href}
                className="os-focus-ring group flex min-w-0 items-center gap-3 rounded-md py-0.5"
              >
                <StatusPill
                  status={statusPill(automation.status)}
                  label={statusLabel(automation.status)}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-os-muted transition-colors duration-150 group-hover:text-foreground">
                  {automation.name}
                </span>
                {/* A failure outranks a schedule: an automation that did not
                    run has nothing useful to say about when it next will. */}
                {automation.detail ? (
                  <span className="os-meta shrink-0 text-os-warning">
                    {automation.detail}
                  </span>
                ) : automation.nextRun ? (
                  <span className="os-meta hidden shrink-0 text-os-subtle sm:block">
                    {formatRunTime(automation.nextRun)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export interface SystemPanelProps {
  components: SystemComponent[];
  className?: string;
}

/**
 * The floor everything else stands on.
 *
 * Last on the page, and silent when it is fine. A row only says anything when
 * something is wrong with it — a panel that always has detail to show is a
 * panel people stop reading, and this one has to be readable on the morning it
 * finally matters.
 */
export function SystemPanel({ components, className }: SystemPanelProps) {
  const unhealthy = components.filter((component) => isLoud(component.status));

  return (
    <Section label="System" className={className}>
      {unhealthy.length === 0 ? (
        <p className="mb-6 text-[15px] leading-6 text-os-muted">
          All systems operational.
        </p>
      ) : null}

      <dl className="grid gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {components.map((component) => (
          <div
            key={component.id}
            className="flex min-w-0 items-baseline justify-between gap-4 border-b border-os-border/60 pb-3"
          >
            <dt className="min-w-0 truncate text-[14px] leading-5 text-os-muted">
              {component.label}
            </dt>
            <dd className="shrink-0">
              <span
                className={cn(
                  "os-meta",
                  isLoud(component.status)
                    ? "text-os-danger"
                    : component.status === "unknown"
                      ? "text-os-subtle"
                      : "text-os-muted",
                )}
              >
                {statusLabel(component.status)}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {unhealthy.length > 0 ? (
        <ul className="mt-6 space-y-2">
          {unhealthy.map((component) => (
            <li
              key={component.id}
              className="max-w-[80ch] text-[13px] leading-5 text-os-danger"
            >
              {component.label} — {component.detail ?? statusLabel(component.status)}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function StripLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
    >
      {children}
    </Link>
  );
}
