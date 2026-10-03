import type { RoutingMode } from "@shared/route-policy-types";
import type { WorkerSummary } from "@shared/worker-types";
import { FilterBar, SectionLabel } from "@/components/os";
import { useExecutionOptions } from "@/lib/agentos/queries";
import { optionLabel } from "./route-policy-model";

/**
 * How a task is routed: Auto, Local only, or Manual.
 *
 * One control for every place work is delegated (the Delegate form, a project
 * task, a milestone batch), so the three modes mean the same thing everywhere.
 *
 * - **Auto**: small bounded text tasks go to an enabled local model; anything
 *   needing tools, a repository or the web goes to a capable worker.
 * - **Local only**: nothing leaves this machine. If no local model can take
 *   the task, it is blocked, never sent to the cloud.
 * - **Manual**: you name the worker (and, for Ollama, the exact model). The
 *   choice is checked and an unusable one explains what is missing.
 */

export interface RoutingControlsProps {
  mode: RoutingMode;
  onModeChange: (mode: RoutingMode) => void;
  /** Offering Manual needs somewhere to send the pick. Omit it for a batch. */
  manualId?: string;
  onManualChange?: (id: string) => void;
  /** Names for workers, and the ones the policy cannot route (e.g. the rehearsal worker). */
  workers: WorkerSummary[];
  legacyWorkers?: WorkerSummary[];
  /** Said before the picker when it cannot be checked yet. */
  manualHint?: string;
  className?: string;
}

const HINTS: Record<RoutingMode, string> = {
  auto: "Small bounded text tasks go to an enabled local model; the rest go to a capable worker. You see the reason before anything runs",
  local_only:
    "Nothing leaves this machine: no cloud provider, including on failure. If no local model can take it, it is blocked",
  manual: "You choose the worker (and model). The choice is checked and recorded as an override",
};

export function RoutingControls({
  mode,
  onModeChange,
  manualId,
  onManualChange,
  workers,
  legacyWorkers = [],
  manualHint,
  className,
}: RoutingControlsProps) {
  const executionOptions = useExecutionOptions();
  const name = (id: string) => workers.find((worker) => worker.id === id)?.name ?? id;
  const manualAllowed = onManualChange !== undefined;

  return (
    <div className={className}>
      <SectionLabel>Routing</SectionLabel>
      <FilterBar<RoutingMode>
        label="Choose how this task is routed"
        className="mt-3"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "auto", label: "Auto" },
          { value: "local_only", label: "Local only" },
          ...(manualAllowed ? [{ value: "manual" as const, label: "Manual" }] : []),
        ]}
      />
      <span className="os-meta mt-2 block text-os-subtle">{HINTS[mode]}</span>

      {mode === "manual" && manualAllowed ? (
        <div className="mt-4">
          <SectionLabel>Run it with</SectionLabel>
          <FilterBar<string>
            label="Choose a worker or model"
            className="mt-3"
            value={manualId ?? ""}
            onChange={onManualChange}
            options={[
              ...(executionOptions.data?.options ?? []).filter((option) => option.enabled && option.available).map((option) => ({
                value: option.id,
                label: optionLabel(option, name),
              })),
              ...legacyWorkers.map((worker) => ({ value: worker.id, label: worker.name })),
            ]}
          />
          {manualHint ? <span className="os-meta mt-2 block text-os-subtle">{manualHint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
