import { AlertTriangle, PenLine, Plus, X } from "lucide-react";
import { useState } from "react";
import type { MilestonePlan, ProjectTaskSection, RoadmapMilestone } from "@shared/agentos-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { useWorkspaceFeedback } from "@/features/workspace";
import { useApplyMilestonePlan, usePlanMilestone } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * Hermes' proposal for a milestone, laid out to be edited before it is applied.
 *
 * Every proposed criterion and task has a checkbox; the uncovered outcomes —
 * the planning check — each carry a `Create task` that adds the suggestion to
 * the task list. Nothing is written until `Apply plan`, which goes through the
 * ordinary create-task and set-criteria mutations.
 */
export function MilestonePlanPanel({
  slug,
  milestone,
  revision,
  tasksRevision,
  onClose,
  onReload,
  className,
}: {
  slug: string;
  milestone: RoadmapMilestone;
  revision: string;
  tasksRevision: string;
  onClose: () => void;
  onReload: () => void;
  className?: string;
}) {
  const plan = usePlanMilestone(slug);
  const apply = useApplyMilestonePlan(slug);
  const feedback = useWorkspaceFeedback();

  const [criteria, setCriteria] = useState<{ text: string; include: boolean }[]>();
  const [tasks, setTasks] = useState<{ title: string; section: ProjectTaskSection; include: boolean }[]>();
  const [proposal, setProposal] = useState<MilestonePlan>();

  const request = () =>
    plan.mutate(milestone.id, {
      onSuccess: (result) => {
        setProposal(result);
        setCriteria(result.criteria.map((text) => ({ text, include: true })));
        setTasks(result.tasks.map((task) => ({ title: task.title, section: task.section, include: true })));
      },
    });

  const chosenCriteria = (criteria ?? []).filter((entry) => entry.include && entry.text.trim()).map((entry) => entry.text.trim());
  const chosenTasks = (tasks ?? []).filter((entry) => entry.include && entry.title.trim()).map((entry) => ({ title: entry.title.trim(), section: entry.section }));

  return (
    <div className={cn("rounded-lg border border-os-border-strong bg-os-surface-raised p-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel>Plan with Hermes</SectionLabel>
          <p className="mt-2 max-w-[60ch] text-[13px] leading-5 text-os-muted">
            Hermes reads the goal, status, decisions, this milestone's outcome and its tasks, and proposes
            criteria, missing work and risks. A proposal: nothing is written until you apply it.
          </p>
        </div>
        <button type="button" aria-label="Close planning" onClick={onClose} className="os-focus-ring -mr-1 cursor-pointer rounded-md p-1.5 text-os-subtle hover:text-foreground">
          <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {!proposal ? (
        <div className="mt-5">
          {plan.error ? <p className="mb-3 text-[13px] leading-5 text-os-warning">{plan.error.message}</p> : null}
          <CommandButton variant="primary" icon={PenLine} iconPosition="start" loading={plan.isPending} loadingLabel="Planning" onClick={request}>
            Ask Hermes to plan {milestone.title}
          </CommandButton>
        </div>
      ) : (
        <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <div className="space-y-8">
            <div>
              <SectionLabel>Proposed criteria</SectionLabel>
              {criteria && criteria.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {criteria.map((entry, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={entry.include}
                        onChange={(event) => setCriteria((current) => current?.map((item, at) => (at === index ? { ...item, include: event.target.checked } : item)))}
                        className="mt-1.5 size-4 shrink-0 accent-os-amber"
                        aria-label={`Include criterion ${index + 1}`}
                      />
                      <input
                        value={entry.text}
                        onChange={(event) => setCriteria((current) => current?.map((item, at) => (at === index ? { ...item, text: event.target.value } : item)))}
                        className="os-focus-ring min-w-0 flex-1 rounded-md border border-os-border bg-transparent px-2.5 py-1.5 text-[14px] leading-5 text-foreground"
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[14px] text-os-subtle">Hermes proposed no new criteria.</p>
              )}
            </div>

            <div>
              <SectionLabel>Proposed tasks</SectionLabel>
              {tasks && tasks.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {tasks.map((entry, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={entry.include}
                        onChange={(event) => setTasks((current) => current?.map((item, at) => (at === index ? { ...item, include: event.target.checked } : item)))}
                        className="mt-1.5 size-4 shrink-0 accent-os-amber"
                        aria-label={`Include task ${index + 1}`}
                      />
                      <input
                        value={entry.title}
                        onChange={(event) => setTasks((current) => current?.map((item, at) => (at === index ? { ...item, title: event.target.value } : item)))}
                        className="os-focus-ring min-w-0 flex-1 rounded-md border border-os-border bg-transparent px-2.5 py-1.5 text-[14px] leading-5 text-foreground"
                      />
                      <select
                        value={entry.section}
                        onChange={(event) => setTasks((current) => current?.map((item, at) => (at === index ? { ...item, section: event.target.value as ProjectTaskSection } : item)))}
                        className="os-focus-ring rounded-md border border-os-border bg-os-surface px-2 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-os-muted"
                      >
                        <option value="now">now</option>
                        <option value="next">next</option>
                        <option value="later">later</option>
                      </select>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[14px] text-os-subtle">Hermes proposed no new tasks.</p>
              )}
            </div>
          </div>

          <div className="space-y-8">
            {proposal.uncovered.length > 0 ? (
              <div>
                <SectionLabel>Planning check</SectionLabel>
                <ul className="mt-3 space-y-3">
                  {proposal.uncovered.map((entry, index) => (
                    <li key={index} className="rounded-lg border border-os-warning/40 bg-os-warning/5 px-4 py-3">
                      <p className="flex items-start gap-2 text-[13px] leading-5 text-os-warning">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                        Outcome not covered
                      </p>
                      <p className="mt-1.5 text-[14px] leading-5 text-foreground">“{entry.outcome}”</p>
                      <p className="mt-1 text-[13px] leading-5 text-os-muted">No task currently addresses this.</p>
                      <button
                        type="button"
                        onClick={() =>
                          setTasks((current) => [...(current ?? []), { title: entry.suggestedTask, section: "next", include: true }])
                        }
                        className="os-focus-ring os-meta mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md text-os-muted hover:text-foreground"
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                        Create task: {entry.suggestedTask}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {proposal.risks.length > 0 ? (
              <List label="Risks" items={proposal.risks} />
            ) : null}
            {proposal.dependencies.length > 0 ? (
              <List label="Dependencies" items={proposal.dependencies} />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            <CommandButton
              variant="primary"
              disabled={chosenCriteria.length === 0 && chosenTasks.length === 0}
              loading={apply.isPending}
              loadingLabel="Applying"
              onClick={() =>
                apply.mutate(
                  { id: milestone.id, criteria: chosenCriteria, tasks: chosenTasks, expectedRevision: revision, tasksRevision },
                  {
                    onSuccess: (result) => {
                      feedback.recordEdit(
                        `${milestone.title}: ${result.createdTaskIds.length} tasks and ${chosenCriteria.length} criteria added.`,
                        result.undoId,
                      );
                      onClose();
                    },
                    onError: (error) => feedback.reportFailure(error, onReload),
                  },
                )
              }
            >
              Apply plan
            </CommandButton>
            <CommandButton variant="quiet" onClick={request} loading={plan.isPending} loadingLabel="Planning">
              Ask again
            </CommandButton>
            <span className="os-meta ml-auto text-os-subtle">
              {chosenTasks.length} tasks · {chosenCriteria.length} criteria selected
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-[14px] leading-5 text-os-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
