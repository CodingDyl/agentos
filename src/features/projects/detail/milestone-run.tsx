import { AlertTriangle, CheckCircle2, Rocket, Square, SquareCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RoadmapMilestone } from "@shared/agentos-types";
import type { MilestoneTaskApproval } from "@shared/delegation-types";
import type { WorkerId } from "@shared/worker-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { usePrepareMilestoneDelegation, useStartMilestoneDelegation, useWorkers } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";


/**
 * Running a whole milestone at once.
 *
 * Same one-way rule as delegating a single task — a plan is read before it is
 * started — just batched: every eligible task is scoped together, shown
 * together, and only the ones a person leaves checked are actually started.
 * One task's plan failing to prepare, or failing to start, never stops the
 * rest — the summary at the end says which is which.
 */
export function MilestoneRun({
  slug,
  milestone,
  onClose,
  onReload,
}: {
  slug: string;
  milestone: RoadmapMilestone;
  onClose: () => void;
  onReload: () => void;
}) {
  const [requestedWorker, setRequestedWorker] = useState<WorkerId | "auto">("auto");
  const { data: workersData } = useWorkers();
  // Only workers that could take the job right now — switched on in AI Stack
  // and healthy. The simulated worker never does real work, so it is left out.
  const workerOptions: { value: WorkerId | "auto"; label: string }[] = [
    { value: "auto", label: "Auto" },
    ...(workersData?.workers ?? [])
      .filter((entry) => entry.available && entry.id !== "mock")
      .map((entry) => ({ value: entry.id, label: entry.name })),
  ];
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const prepare = usePrepareMilestoneDelegation(slug);
  const start = useStartMilestoneDelegation(slug);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const preview = prepare.data;
  const result = start.data;

  const runnable = useMemo(() => preview?.ready.filter((entry) => entry.preview) ?? [], [preview]);

  const toggle = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const approvals: MilestoneTaskApproval[] = runnable
    .filter((entry) => selected.has(entry.taskId))
    .map((entry) => ({
      taskId: entry.taskId,
      plan: entry.preview!.plan,
      worker: requestedWorker,
      routing: entry.preview!.routing,
    }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh] pb-8">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-os-background/85" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Run milestone"
        className="relative flex max-h-full w-[min(92vw,40rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-os-border px-5 py-4">
          <div>
            <SectionLabel>Run milestone</SectionLabel>
            <h2 className="mt-2 text-[20px] leading-7 text-foreground">{milestone.title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="os-focus-ring -mr-2 cursor-pointer rounded-md p-2 text-os-subtle hover:text-foreground">
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          {result ? (
            <div className="space-y-4">
              {result.started.length > 0 ? (
                <div className="flex items-start gap-3 rounded-md border border-os-border bg-os-surface-raised p-4">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-os-success" strokeWidth={1.5} aria-hidden="true" />
                  <p className="text-[14px] leading-6 text-foreground">
                    {result.started.length} {result.started.length === 1 ? "task" : "tasks"} started: {result.started.map((entry) => entry.taskId).join(", ")}.
                  </p>
                </div>
              ) : null}

              {result.failed.length > 0 ? (
                <div className="space-y-2">
                  {result.failed.map((entry) => (
                    <div key={entry.taskId} className="flex items-start gap-3 rounded-md border border-os-border bg-os-surface-raised p-4">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-os-danger" strokeWidth={1.5} aria-hidden="true" />
                      <p className="text-[14px] leading-6 text-foreground">
                        <span className="font-medium">{entry.taskId}</span> could not start: {entry.error}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : preview ? (
            <div className="space-y-6">
              {preview.skipped.length > 0 ? (
                <div>
                  <SectionLabel>Skipped</SectionLabel>
                  <ul className="mt-3 space-y-2">
                    {preview.skipped.map((entry) => (
                      <li key={entry.taskId} className="text-[13px] leading-5 text-os-subtle">
                        <span className="font-mono">{entry.taskId}</span> · {entry.taskTitle}: {entry.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <SectionLabel action={<span className="os-meta text-os-subtle tabular-nums">{selected.size} / {runnable.length}</span>}>
                  Ready to run
                </SectionLabel>

                {preview.ready.length === 0 ? (
                  <p className="mt-3 text-[14px] leading-5 text-os-subtle">Nothing in this milestone is eligible to run right now.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {preview.ready.map((entry) => (
                      <li key={entry.taskId}>
                        {entry.preview ? (
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={selected.has(entry.taskId)}
                            onClick={() => toggle(entry.taskId)}
                            className="os-focus-ring flex w-full cursor-pointer items-start gap-3 rounded-md border border-os-border p-3 text-left transition-colors duration-150 hover:bg-os-surface-raised"
                          >
                            {selected.has(entry.taskId) ? (
                              <SquareCheck className="mt-0.5 size-4 shrink-0 text-os-success" strokeWidth={1.5} aria-hidden="true" />
                            ) : (
                              <Square className="mt-0.5 size-4 shrink-0 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
                            )}
                            <span className="min-w-0">
                              <span className="block text-[14.5px] leading-6 text-foreground">
                                <span className="font-mono text-os-subtle">{entry.taskId}</span> {entry.taskTitle}
                              </span>
                              <span className="mt-0.5 block truncate text-[13px] leading-5 text-os-subtle">
                                {entry.preview.plan.objective}
                              </span>
                            </span>
                          </button>
                        ) : (
                          <div className="flex items-start gap-3 rounded-md border border-os-border bg-os-surface-raised p-3">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-os-warning" strokeWidth={1.5} aria-hidden="true" />
                            <span className="min-w-0 text-[14px] leading-6 text-foreground">
                              <span className="font-mono text-os-subtle">{entry.taskId}</span> {entry.taskTitle}: {entry.error}
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div>
              <SectionLabel>Worker</SectionLabel>
              <div role="radiogroup" aria-label="Worker" className="mt-3 inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-os-border">
                {workerOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={requestedWorker === option.value}
                    onClick={() => setRequestedWorker(option.value)}
                    className={cn(
                      "os-focus-ring os-meta min-h-9 cursor-pointer border-l border-os-border px-3 transition-colors duration-150 first:border-l-0",
                      requestedWorker === option.value ? "bg-os-surface-raised text-foreground" : "text-os-muted hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 max-w-[48ch] text-[13px] leading-5 text-os-subtle">
                Every open, unblocked task in this milestone gets scoped by Hermes before anything runs. Nothing starts until you approve the plans.
              </p>
            </div>
          )}

          {prepare.error ? <p className="mt-4 text-[13px] leading-5 text-os-danger">{prepare.error.message}</p> : null}
          {start.error ? <p className="mt-4 text-[13px] leading-5 text-os-danger">{start.error.message}</p> : null}

          <div className="mt-7 flex flex-wrap items-center gap-2">
            {result ? (
              <CommandButton variant="primary" onClick={onClose}>Done</CommandButton>
            ) : preview ? (
              <>
                <CommandButton
                  variant="primary"
                  icon={Rocket}
                  iconPosition="start"
                  disabled={approvals.length === 0}
                  loading={start.isPending}
                  loadingLabel="Starting"
                  onClick={() =>
                    start.mutate(
                      { milestoneId: milestone.id, tasks: approvals },
                      { onSuccess: onReload },
                    )
                  }
                >
                  Start {approvals.length} {approvals.length === 1 ? "job" : "jobs"}
                </CommandButton>
                <CommandButton variant="quiet" onClick={onClose}>Cancel</CommandButton>
              </>
            ) : (
              <>
                <CommandButton
                  variant="primary"
                  icon={Rocket}
                  iconPosition="start"
                  loading={prepare.isPending}
                  loadingLabel="Scoping"
                  onClick={() =>
                    prepare.mutate(
                      { milestoneId: milestone.id, requestedWorker },
                      {
                        onSuccess: (data) => {
                          setSelected(new Set(data.ready.filter((entry) => entry.preview).map((entry) => entry.taskId)));
                        },
                      },
                    )
                  }
                >
                  Prepare tasks
                </CommandButton>
                <CommandButton variant="quiet" onClick={onClose}>Cancel</CommandButton>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
