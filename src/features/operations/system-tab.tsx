import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SystemStatus } from "@shared/mission-control-types";
import { PAPER_FOCUS, PaperCard, PaperSection, Tag } from "@/components/paper";
import { formatRunTime } from "@/features/automations";
import { useMissionControl } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * System: is the machinery alright?
 *
 * Workers, automations and the components AgentOS stands on — moved here from
 * Today, where they used to take a third of the screen on a good day. Read
 * from the same payload Today reads, so the two can never disagree; anything
 * actually broken still reaches Today through Needs you.
 *
 * Only something wrong is loud. A healthy row is a name and a quiet word.
 */

const LABEL: Record<SystemStatus, string> = {
  ready: "Ready",
  running: "Running",
  waiting: "Waiting",
  attention: "Attention",
  failed: "Failed",
  unknown: "Unknown",
  offline: "Offline",
};

function tone(status: SystemStatus): "flame" | "green" | "marigold" | "muted" | "blue" {
  switch (status) {
    case "ready":
      return "green";
    case "running":
      return "blue";
    case "attention":
    case "waiting":
      return "marigold";
    case "failed":
    case "offline":
      return "flame";
    default:
      return "muted";
  }
}

const loud = (status: SystemStatus) => status === "failed" || status === "offline" || status === "attention";

interface Row {
  id: string;
  name: string;
  status: SystemStatus;
  detail?: string;
  href?: string;
}

export function SystemTab() {
  const { data, isPending, error } = useMissionControl();

  if (isPending) return <p className="text-[14px] text-paper-sage">Reading the system…</p>;
  if (!data) return <p className="text-[14px] text-paper-flame-deep">{error?.message ?? "The system could not be read."}</p>;

  const workers: Row[] = data.workers.map((worker) => ({ ...worker }));
  const automations: Row[] = data.automations.map((automation) => ({
    id: automation.id,
    name: automation.name,
    status: automation.status,
    detail: automation.detail ?? (automation.nextRun ? `Next ${formatRunTime(automation.nextRun)}` : undefined),
    href: automation.href,
  }));
  const components: Row[] = data.system.map((component) => ({ ...component, name: component.label }));

  return (
    <div className="grid gap-x-6 gap-y-10 lg:grid-cols-3">
      <StatusList
        label="Workers"
        rows={workers}
        empty="No workers are declared."
        action={<QuietLink to="/workers">Worker jobs</QuietLink>}
      />
      <StatusList
        label="Automations"
        rows={automations}
        empty={data.sources.automations === "ready" ? "No automations are scheduled." : "Automations could not be read."}
        action={<QuietLink to="/automations">All automations</QuietLink>}
      />
      <StatusList label="Foundation" rows={components} empty="No components reported." action={<QuietLink to="/agent">Hermes console</QuietLink>} />
    </div>
  );
}

function StatusList({ label, rows, empty, action }: { label: string; rows: Row[]; empty: string; action?: ReactNode }) {
  return (
    <PaperSection label={label} count={rows.length} action={action}>
      <PaperCard className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-[14px] text-paper-sage">{empty}</p>
        ) : (
          <ul className="divide-y divide-paper-stone">
            {rows.map((row) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] leading-6 text-paper-moss">{row.name}</span>
                    {row.detail && loud(row.status) ? (
                      <span className="block text-[12.5px] leading-5 text-paper-flame-deep">{row.detail}</span>
                    ) : row.detail ? (
                      <span className="block truncate text-[12.5px] leading-5 text-paper-sage">{row.detail}</span>
                    ) : null}
                  </span>
                  <Tag tone={tone(row.status)}>{LABEL[row.status]}</Tag>
                </>
              );
              return (
                <li key={row.id}>
                  {row.href ? (
                    <Link to={row.href} className={cn("flex items-start gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}>
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PaperCard>
    </PaperSection>
  );
}

export function QuietLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex min-h-8 items-center rounded-[4px] px-2 text-[13px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss",
        PAPER_FOCUS,
      )}
    >
      {children}
    </Link>
  );
}
