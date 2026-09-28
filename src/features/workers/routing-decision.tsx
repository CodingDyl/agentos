import type {
  WorkerPerformance,
  WorkerRoutingDecision,
} from "@shared/worker-routing-types";
import type { WorkerId, WorkerSummary } from "@shared/worker-types";
import { HairlineCard, SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";

/**
 * What Hermes decided, before anything runs on it.
 *
 * The panel exists to be disagreed with. A recommendation the operator cannot
 * interrogate is just a machine choosing quietly, so everything the decision
 * rested on is on screen: who was picked, how sure the router was, why, what
 * else was considered, and who was never in the running.
 *
 * The one thing it must never do is look equally authoritative in both of its
 * modes. A decision Hermes reasoned about and a ranking AgentOS computed when
 * Hermes was unreachable are different kinds of claim, and the panel says
 * which one it is showing rather than leaving them to look alike.
 */

/** How many bars are lit. Three reads as a signal strength, which is the idea. */
const CONFIDENCE_BARS: Record<WorkerRoutingDecision["confidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function Confidence({
  confidence,
}: {
  confidence: WorkerRoutingDecision["confidence"];
}) {
  const lit = CONFIDENCE_BARS[confidence];

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-end gap-[3px]"
        role="img"
        aria-label={`${confidence} confidence`}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn(
              "w-[3px] rounded-[1px]",
              // Rising bars: the shape carries the meaning even before the
              // colour does, which is what makes it readable at a glance.
              index === 0 ? "h-[6px]" : index === 1 ? "h-[9px]" : "h-3",
              index < lit
                ? confidence === "low"
                  ? "bg-os-subtle-foreground"
                  : "bg-os-amber"
                : "bg-os-border",
            )}
          />
        ))}
      </div>
      <span className="os-meta text-os-subtle">{confidence} confidence</span>
    </div>
  );
}

export interface RoutingDecisionProps {
  decision: WorkerRoutingDecision;
  /** The workers themselves, so a decision can be shown by name. */
  workers: WorkerSummary[];
  candidates?: WorkerPerformance[];
  /** Set when the operator has chosen someone other than the recommendation. */
  overriddenTo?: WorkerId;
  className?: string;
}

export function RoutingDecision({
  decision,
  workers,
  candidates,
  overriddenTo,
  className,
}: RoutingDecisionProps) {
  const name = (id: WorkerId) =>
    workers.find((worker) => worker.id === id)?.name ?? id;

  const recordFor = (id: WorkerId) =>
    candidates?.find((entry) => entry.worker === id);

  const selected = recordFor(decision.selectedWorker);

  return (
    <HairlineCard className={className}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Routing decision</SectionLabel>
            <p className="mt-2 text-[17px] leading-6 text-foreground">
              {name(decision.selectedWorker)}
            </p>
          </div>
          <Confidence confidence={decision.confidence} />
        </div>

        {/* Said plainly rather than inferred from a missing byline: a ranking
            of past jobs is not the same claim as a considered recommendation. */}
        {decision.decidedBy === "agentos" ? (
          <p className="mt-3 text-[13px] leading-5 text-os-subtle">
            Chosen from the job history; Hermes did not answer.
          </p>
        ) : null}

        {overriddenTo && overriddenTo !== decision.selectedWorker ? (
          <p className="mt-3 text-[13px] leading-5 text-os-amber">
            You have chosen {name(overriddenTo)} instead. Both will be recorded.
          </p>
        ) : null}

        {decision.taskType ? (
          <p className="os-meta mt-3 text-os-subtle">
            Read as {decision.taskType.replace(/-/g, " ")}
            {decision.complexity ? ` · ${decision.complexity} complexity` : ""}
          </p>
        ) : null}

        {decision.reasons.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {decision.reasons.map((reason) => (
              <li
                key={reason}
                className="max-w-[62ch] text-[13px] leading-5 text-os-muted before:mr-2 before:text-os-subtle before:content-['·']"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : null}

        {selected && selected.jobs > 0 ? (
          <p className="os-meta mt-4 text-os-subtle">
            {selected.jobs} finished {selected.jobs === 1 ? "job" : "jobs"}
            {selected.reviewPassRate !== undefined
              ? ` · ${Math.round(selected.reviewPassRate * 100)}% review pass`
              : ""}
            {selected.avgCostUsd !== undefined
              ? ` · $${selected.avgCostUsd.toFixed(2)} average`
              : ""}
          </p>
        ) : (
          <p className="os-meta mt-4 text-os-subtle">
            No finished jobs on record for this worker yet
          </p>
        )}

        {decision.alternatives?.length ? (
          <div className="mt-5 border-t border-os-border pt-4">
            <SectionLabel>Also considered</SectionLabel>
            <ul className="mt-2.5 space-y-1.5">
              {decision.alternatives.map((alternative) => (
                <li
                  key={alternative.worker}
                  className="max-w-[62ch] text-[13px] leading-5 text-os-muted"
                >
                  <span className="text-foreground">
                    {name(alternative.worker)}
                  </span>{" "}
                  · {alternative.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Kept visible rather than filtered away silently. A screen that
            showed two candidates where there were three would be hiding the
            most useful thing it knows about why the choice was narrow. */}
        {decision.excluded?.length ? (
          <div className="mt-5 border-t border-os-border pt-4">
            <SectionLabel>Not in the running</SectionLabel>
            <ul className="mt-2.5 space-y-1.5">
              {decision.excluded.map((entry) => (
                <li
                  key={entry.worker}
                  className="max-w-[62ch] text-[13px] leading-5 text-os-subtle"
                >
                  <span className="text-os-muted">{name(entry.worker)}</span> ·{" "}
                  {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </HairlineCard>
  );
}
