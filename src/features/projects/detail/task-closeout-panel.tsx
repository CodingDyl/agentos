import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import { MEMORY_TYPE_LABELS, type MemoryDuplicateMatch } from "@shared/memory-types";
import { PROPOSABLE_MEMORY_TYPES, type ProposableMemoryType, type TaskCloseoutDraft, type TaskCloseoutRecord } from "@shared/task-closeout-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { useCompleteTaskWithCloseout, useTaskCloseout } from "@/lib/agentos/closeout";
import { MemoryRequestError } from "@/lib/agentos/memory";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  applyConflict,
  buildCompleteRequest,
  humanProposal,
  incomplete,
  initialChoices,
  unresolved,
  validationLabel,
  type ProposalChoice,
  type StatusChoice,
} from "./closeout-model";

/**
 * Closing a task out, before it is ticked off.
 *
 * What changed, how it was validated, what it produced — recorded
 * automatically — and, separately, what is worth remembering and whether the
 * project's status should move. Those last two are proposals: each can be
 * edited, unticked or dismissed, and a proposal that looks like existing
 * memory asks whether to update that note or create a new one before the task
 * can complete. Nothing is merged on its own.
 */

const INPUT =
  "os-focus-ring w-full rounded-md border border-os-border bg-transparent px-3 py-2 text-[13.5px] leading-5 text-foreground placeholder:text-os-subtle";

export function TaskCloseoutPanel({
  project,
  taskId,
  enabled,
  line,
}: {
  project: string;
  taskId: string;
  enabled: boolean;
  /** The TASKS.md line as it is, and as completing will write it. */
  line?: { before: string; after: string };
}) {
  const draft = useTaskCloseout(project, taskId, enabled);

  if (!enabled) return null;
  if (draft.isPending) return <p className="os-meta mt-3 text-os-subtle">Preparing the closeout…</p>;
  if (draft.error || !draft.data) {
    return <p className="mt-3 text-[13px] text-os-danger">{draft.error?.message ?? "The closeout could not be prepared."}</p>;
  }
  if (draft.data.record) return <CloseoutRecord record={draft.data.record} />;
  if (!draft.data.ready) return <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">{draft.data.blockedReason}</p>;

  // Keyed so a fresh draft (after a refetch) starts the form again.
  return <CloseoutForm key={`${draft.dataUpdatedAt}`} project={project} taskId={taskId} draft={draft.data} line={line} />;
}

function CloseoutForm({
  project,
  taskId,
  draft,
  line,
}: {
  project: string;
  taskId: string;
  draft: TaskCloseoutDraft;
  line?: { before: string; after: string };
}) {
  const complete = useCompleteTaskWithCloseout(project, taskId);
  const { closeout } = draft;

  const [summary, setSummary] = useState(closeout.summary);
  const [choices, setChoices] = useState<ProposalChoice[]>(() => initialChoices(draft.proposals));
  const [status, setStatus] = useState<StatusChoice>({
    apply: Boolean(closeout.suggestedStatusUpdate),
    body: closeout.suggestedStatusUpdate ?? "",
    expectedRevision: draft.currentStatus?.revision,
  });

  const update = (index: number, change: Partial<ProposalChoice>) =>
    setChoices((current) => current.map((choice, at) => (at === index ? { ...choice, ...change } : choice)));
  const edit = (index: number, change: Partial<ProposalChoice["proposal"]>) =>
    setChoices((current) => current.map((choice, at) => (at === index ? { ...choice, proposal: { ...choice.proposal, ...change } } : choice)));

  const waiting = unresolved(choices);
  const missing = incomplete(choices);
  const blocked = waiting.length > 0 || missing.length > 0;

  const submit = () => {
    if (blocked || complete.isPending) return;
    complete.mutate(buildCompleteRequest({ summary, originalSummary: closeout.summary, choices, status }), {
      onError: (error) => {
        // Duplicates the server found that the screen had not (an edited title):
        // shown in place, with the same choice.
        if (error instanceof MemoryRequestError && error.payload?.code === "possible_duplicates") {
          const conflicts = error.payload.proposals as Array<{ proposalId: string; duplicates: MemoryDuplicateMatch[] }>;
          setChoices((current) => applyConflict(current, conflicts));
        }
      },
    });
  };

  return (
    <div className="mt-3 space-y-5">
      <p className="font-mono text-[13px] tracking-wide text-os-amber">{taskId} COMPLETE</p>

      <label className="block">
        <SectionLabel>Summary</SectionLabel>
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className={cn(INPUT, "mt-2 resize-y")} />
      </label>

      {closeout.validation && closeout.validation.length > 0 ? (
        <div>
          <SectionLabel>Validation</SectionLabel>
          <ul className="mt-2 space-y-1 text-[13px]">
            {closeout.validation.map((entry) => (
              <li key={entry.command} className="flex items-center gap-2" title={entry.command}>
                {entry.success ? (
                  <Check className="size-3.5 text-os-success" strokeWidth={2} aria-label="Passed" />
                ) : (
                  <X className="size-3.5 text-os-danger" strokeWidth={2} aria-label="Failed" />
                )}
                <span className="text-foreground">{validationLabel(entry.command)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="os-meta text-os-subtle">No validation ran for this job.</p>
      )}

      {closeout.artifacts && closeout.artifacts.length > 0 ? (
        <div>
          <SectionLabel>Artifacts</SectionLabel>
          <ul className="mt-2 space-y-1 text-[13px] text-foreground">
            {closeout.artifacts.map((artifact) => (
              <li key={artifact} className="truncate" title={artifact}>
                {artifact.split("/").pop()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {closeout.changedFiles && closeout.changedFiles.length > 0 ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-os-muted">
            {closeout.changedFiles.length} changed file{closeout.changedFiles.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-0.5 font-mono text-[12px] text-os-subtle">
            {closeout.changedFiles.map((file) => (
              <li key={file} className="truncate">
                {file}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div>
        <SectionLabel>Remember</SectionLabel>
        {choices.length === 0 ? (
          <p className="os-meta mt-2 text-os-subtle">Nothing was proposed. Most tasks leave nothing durable behind, and that is fine.</p>
        ) : null}
        <ul className="mt-2 space-y-3">
          {choices.map((choice, index) => (
            <ProposalRow
              key={choice.proposal.id}
              choice={choice}
              onToggle={(selected) => update(index, { selected })}
              onEdit={(change) => edit(index, change)}
              onResolve={(resolution) => update(index, { resolution })}
              onRemove={choice.proposal.proposedBy === "human" ? () => setChoices((current) => current.filter((_, at) => at !== index)) : undefined}
            />
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setChoices((current) => [...current, humanProposal(project, taskId)])}
          className="os-focus-ring mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-os-muted hover:text-foreground"
        >
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" /> Add something to remember
        </button>
      </div>

      <div>
        <SectionLabel>Project update</SectionLabel>
        <label className="mt-2 flex items-center gap-2 text-[13.5px] text-foreground">
          <input type="checkbox" checked={status.apply} onChange={(event) => setStatus({ ...status, apply: event.target.checked })} />
          Apply STATUS.md update
        </label>
        {status.apply ? (
          <div className="mt-2 space-y-2">
            {draft.currentStatus?.body ? (
              <p className="max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                <span className="os-meta">Current · </span>
                {draft.currentStatus.body}
              </p>
            ) : null}
            <textarea
              value={status.body}
              onChange={(event) => setStatus({ ...status, body: event.target.value })}
              rows={3}
              placeholder="Where the project stands now, and what is next."
              aria-label="Proposed status"
              className={cn(INPUT, "resize-y")}
            />
            <p className="os-meta text-os-subtle">Written to STATUS.md under “{draft.currentStatus?.heading ?? "Current Stage"}”. PROJECT.md is not changed.</p>
          </div>
        ) : null}
      </div>

      {complete.error ? (
        <p role="alert" className="max-w-[62ch] text-[13px] leading-5 text-os-danger">
          {complete.error.message}
        </p>
      ) : null}
      {blocked ? (
        <p className="os-meta text-os-subtle">
          {waiting.length > 0
            ? `Choose what to do with ${waiting.length === 1 ? "the possible duplicate" : `${waiting.length} possible duplicates`} first.`
            : "Give each ticked memory a title and some text, or untick it."}
        </p>
      ) : null}

      {line ? (
        <div>
          <SectionLabel>TASKS.md</SectionLabel>
          <div className="mt-2 space-y-1 font-mono text-[12px] leading-5">
            <p className="text-os-subtle line-through">{line.before}</p>
            <p className="text-os-success">{line.after}</p>
          </div>
        </div>
      ) : null}

      <CommandButton variant="primary" onClick={submit} disabled={blocked} loading={complete.isPending} loadingLabel="Completing">
        Complete task
      </CommandButton>
    </div>
  );
}

function ProposalRow({
  choice,
  onToggle,
  onEdit,
  onResolve,
  onRemove,
}: {
  choice: ProposalChoice;
  onToggle: (selected: boolean) => void;
  onEdit: (change: Partial<ProposalChoice["proposal"]>) => void;
  onResolve: (resolution: ProposalChoice["resolution"]) => void;
  onRemove?: () => void;
}) {
  const { proposal } = choice;
  const [expanded, setExpanded] = useState(proposal.proposedBy === "human");

  return (
    <li className={cn("rounded-md border border-os-border p-3", !choice.selected && "opacity-60")}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={choice.selected}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`Remember ${proposal.title || "this"}`}
          className="mt-1.5"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={proposal.type}
              onChange={(event) => onEdit({ type: event.target.value as ProposableMemoryType })}
              aria-label="Memory type"
              className="os-focus-ring rounded-md border border-os-border bg-transparent px-2 py-1 text-[12.5px] text-foreground"
            >
              {PROPOSABLE_MEMORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MEMORY_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            {expanded ? (
              <input
                value={proposal.title}
                onChange={(event) => onEdit({ title: event.target.value })}
                placeholder="Title"
                aria-label="Title"
                className={cn(INPUT, "min-w-[12rem] flex-1 py-1")}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{proposal.title}</span>
            )}
            <button type="button" onClick={() => setExpanded((value) => !value)} className="os-focus-ring os-meta cursor-pointer text-os-muted hover:text-foreground">
              {expanded ? "Done" : "Edit"}
            </button>
            {onRemove ? (
              <button type="button" onClick={onRemove} aria-label="Remove" className="os-focus-ring cursor-pointer text-os-subtle hover:text-foreground">
                <X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {expanded ? (
            <textarea
              value={proposal.body}
              onChange={(event) => onEdit({ body: event.target.value })}
              rows={3}
              placeholder="What to remember, in a sentence or two."
              aria-label="What to remember"
              className={cn(INPUT, "resize-y")}
            />
          ) : (
            <p className="text-[13px] leading-5 text-os-muted">{proposal.body}</p>
          )}

          <p className="os-meta text-os-subtle">
            Source {proposal.sourceTask} · proposed by {proposal.proposedBy === "human" ? "you" : proposal.proposedBy.replace(/^agent:/, "")}
          </p>

          {choice.selected && choice.duplicates.length > 0 ? (
            <DuplicateChoice duplicates={choice.duplicates} resolution={choice.resolution} onResolve={onResolve} onCancel={() => onToggle(false)} />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function DuplicateChoice({
  duplicates,
  resolution,
  onResolve,
  onCancel,
}: {
  duplicates: MemoryDuplicateMatch[];
  resolution: ProposalChoice["resolution"];
  onResolve: (resolution: ProposalChoice["resolution"]) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-os-warning/60 p-3">
      <SectionLabel>Possible existing memory</SectionLabel>
      <ul className="mt-2 space-y-2">
        {duplicates.map((match) => {
          const chosen = resolution?.kind === "update" && resolution.targetId === match.id;
          return (
            <li key={`${match.kind}:${match.id}`} className="text-[13px]">
              <p className="text-foreground">
                {match.title}
                {match.archived ? <span className="os-meta text-os-subtle"> · archived</span> : null}
              </p>
              <p className="os-meta text-os-subtle">
                {match.kind === "decision" ? "Decision in DECISIONS.md" : match.id}
                {match.createdAt ? ` · added ${formatAdded(match.createdAt)}` : ""} · {Math.round(match.score * 100)}% overlap
              </p>
              {match.excerpt ? <p className="mt-1 text-[12.5px] leading-5 text-os-muted">{match.excerpt}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <CommandButton
                  variant={chosen ? "primary" : "secondary"}
                  onClick={() => onResolve({ kind: "update", targetId: match.id, targetRevision: match.revision })}
                >
                  {chosen ? "Will update existing" : "Update existing"}
                </CommandButton>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-os-border pt-3">
        <CommandButton variant={resolution?.kind === "create-new" ? "primary" : "secondary"} onClick={() => onResolve({ kind: "create-new" })}>
          {resolution?.kind === "create-new" ? "Will create new" : "Create new"}
        </CommandButton>
        <CommandButton variant="quiet" onClick={onCancel}>
          Cancel
        </CommandButton>
      </div>
    </div>
  );
}

function formatAdded(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function CloseoutRecord({ record }: { record: TaskCloseoutRecord }) {
  const kept = record.memoryOutcomes.filter((outcome) => outcome.outcome === "created" || outcome.outcome === "updated");
  const failed = record.memoryOutcomes.filter((outcome) => outcome.outcome === "failed");

  return (
    <div className="mt-3 space-y-3 text-[13px] leading-5">
      <p className="text-os-muted">
        Closed {formatRelativeTime(record.completedAt)}
        {record.worker ? ` · ${record.worker}` : ""}
        {record.validation?.length ? ` · validation ${record.validation.every((entry) => entry.success) ? "passed" : "had failures"}` : ""}
      </p>
      <p className="max-w-[62ch] text-foreground">{record.summary}</p>
      {kept.length > 0 ? (
        <div>
          <SectionLabel>Remembered</SectionLabel>
          <ul className="mt-1.5 space-y-0.5">
            {kept.map((outcome) => (
              <li key={outcome.proposalId} className="text-os-muted">
                {outcome.title} <span className="os-meta text-os-subtle">→ {outcome.target}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failed.map((outcome) => (
        <p key={outcome.proposalId} className="text-os-danger">
          {outcome.title}: {outcome.error}
        </p>
      ))}
      {record.statusApplied ? <p className="os-meta text-os-subtle">STATUS.md updated.</p> : null}
      {record.statusError ? <p className="text-os-danger">STATUS.md was not updated: {record.statusError}</p> : null}
    </div>
  );
}
