import { RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { RetryJobInput, WorkerJob } from "@shared/worker-types";
import { CommandButton, DedsecLoader, SectionLabel } from "@/components/os";
import { useRerunPreview, useRetryWorkerJob, useWorkers } from "@/lib/agentos/queries";

/**
 * Edit the brief, worker, and model, then start a new run that uses current
 * project settings unless something here is overridden.
 */
export function EditRerunPanel({ job, onClose }: { job: WorkerJob; onClose: () => void }) {
  const preview = useRerunPreview(job.id, true);
  const retry = useRetryWorkerJob();
  const navigate = useNavigate();
  const workers = useWorkers();
  const settings = preview.data?.settings ?? [];

  const [objective, setObjective] = useState(job.objective);
  const [desiredOutcome, setDesiredOutcome] = useState(job.desiredOutcome ?? "");
  const [scope, setScope] = useState(job.scope ?? "");
  const [acceptance, setAcceptance] = useState((job.acceptanceCriteria ?? []).join("\n"));
  const [constraints, setConstraints] = useState((job.constraints ?? []).join("\n"));
  const [references, setReferences] = useState((job.referenceLinks ?? []).join("\n"));
  const [worker, setWorker] = useState<string>(job.requestedWorker ?? job.worker);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");

  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const currentModel = settings.find((row) => row.key === "model")?.current ?? "";
  const currentEffort = settings.find((row) => row.key === "effort")?.current ?? "";

  const payload = useMemo((): RetryJobInput => {
    const next: RetryJobInput = {
      objective: objective.trim() || undefined,
      desiredOutcome: desiredOutcome.trim(),
      scope: scope.trim(),
      acceptanceCriteria: lines(acceptance),
      constraints: lines(constraints),
      referenceLinks: lines(references),
      worker: worker as RetryJobInput["worker"],
    };
    if (model.trim() && model.trim() !== currentModel) next.modelOverride = model.trim();
    if (effort.trim() && effort.trim() !== currentEffort) {
      next.effort = effort.trim() as NonNullable<RetryJobInput["effort"]>;
    }
    return next;
  }, [objective, desiredOutcome, scope, acceptance, constraints, references, worker, model, effort, currentModel, currentEffort]);

  const repo = settings.find((row) => row.key === "repoPath");

  return (
    <div className="mt-6 max-w-[72ch] rounded-lg border border-os-border bg-os-surface/40 p-5 md:p-6" role="dialog" aria-label="Edit and rerun">
      <p className="os-meta text-os-subtle">Edit & rerun</p>
      <p className="mt-2 text-[14px] leading-6 text-os-muted">
        The new run uses the project&apos;s current repository, model routing, agent, and AI Stack, unless you override them here.
      </p>

      {preview.isPending ? (
        <div className="mt-4">
          <DedsecLoader variant="compact" />
        </div>
      ) : null}

      {settings.some((row) => row.changed) ? (
        <ul className="mt-4 space-y-1.5">
          {settings
            .filter((row) => row.changed)
            .map((row) => (
              <li key={row.key} className="text-[13px] leading-5 text-os-muted">
                <span className="text-os-amber">{row.label} changed</span>
                {row.original ? ` · was ${row.original}` : ""}
                {row.current ? ` · now ${row.current}` : " · now unset"}
              </li>
            ))}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] leading-5 text-os-subtle">Current settings match this job.</p>
      )}

      {repo ? (
        <p className="mt-3 font-mono text-[12px] leading-5 text-os-subtle">
          Repo: {repo.current ?? "not set"}
          {repo.changed && repo.original ? ` (was ${repo.original})` : ""}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4">
        <Field label="Objective">
          <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} className={fieldClass} />
        </Field>
        <Field label="Outcome">
          <textarea value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} rows={2} className={fieldClass} />
        </Field>
        <Field label="Scope">
          <textarea value={scope} onChange={(event) => setScope(event.target.value)} rows={2} className={fieldClass} />
        </Field>
        <Field label="Acceptance, one per line">
          <textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} rows={3} className={fieldClass} />
        </Field>
        <Field label="Constraints, one per line">
          <textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={2} className={fieldClass} />
        </Field>
        <Field label="References, one URL per line">
          <textarea value={references} onChange={(event) => setReferences(event.target.value)} rows={2} className={fieldClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Worker">
            <select
              value={worker}
              onChange={(event) => setWorker(event.target.value)}
              className={fieldClass}
            >
              <option value="auto">Auto</option>
              {(workers.data?.workers ?? []).map((entry) => (
                <option key={entry.id} value={entry.id} disabled={!entry.available}>
                  {entry.name}
                  {entry.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <input
              value={model}
              placeholder={currentModel || "Current default"}
              onChange={(event) => setModel(event.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field label="Effort">
            <select value={effort} onChange={(event) => setEffort(event.target.value)} className={fieldClass}>
              <option value="">Current default</option>
              {["low", "medium", "high", "xhigh", "max"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <CommandButton
          variant="primary"
          icon={RotateCcw}
          iconPosition="start"
          disabled={!objective.trim() || retry.isPending}
          loading={retry.isPending}
          loadingLabel="Starting"
          onClick={() =>
            retry.mutate(
              { id: job.id, ...payload },
              { onSuccess: ({ job: next }) => void navigate(`/workers/jobs/${next.id}`) },
            )
          }
        >
          Rerun
        </CommandButton>
        <CommandButton variant="quiet" onClick={onClose}>
          Cancel
        </CommandButton>
      </div>
      {preview.error ? (
        <p className="mt-2 text-[13px] text-os-danger">{preview.error.message}</p>
      ) : null}
      {retry.error ? <p className="mt-2 text-[13px] text-os-danger">{retry.error.message}</p> : null}
    </div>
  );
}

const fieldClass =
  "os-focus-ring mt-2 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2 text-[13.5px] leading-6 text-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </label>
  );
}
