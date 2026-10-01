import type { MemoryDuplicateMatch } from "@shared/memory-types";
import type { CompleteTaskRequest, MemoryProposal, MemoryProposalReview } from "@shared/task-closeout-types";

/**
 * The closeout screen's state, and the request it becomes.
 *
 * Kept apart from the component so the rules — an unticked proposal is a
 * dismissal, a ticked one with a possible duplicate needs a choice before the
 * task can complete — are tested without a DOM.
 */

export type DuplicateResolution = { kind: "update"; targetId: string; targetRevision: string } | { kind: "create-new" };

export interface ProposalChoice {
  proposal: MemoryProposal;
  selected: boolean;
  duplicates: MemoryDuplicateMatch[];
  resolution?: DuplicateResolution;
}

export interface StatusChoice {
  apply: boolean;
  body: string;
  expectedRevision?: string;
}

export function initialChoices(proposals: readonly MemoryProposalReview[]): ProposalChoice[] {
  return proposals.map(({ duplicates, ...proposal }) => ({ proposal, selected: proposal.selected, duplicates }));
}

/** Ticked proposals that look like existing memory and have no answer yet. */
export function unresolved(choices: readonly ProposalChoice[]): ProposalChoice[] {
  return choices.filter((choice) => choice.selected && choice.duplicates.length > 0 && !choice.resolution);
}

/** Ticked proposals whose title or text is empty — they cannot be saved. */
export function incomplete(choices: readonly ProposalChoice[]): ProposalChoice[] {
  return choices.filter((choice) => choice.selected && (choice.proposal.title.trim().length < 3 || !choice.proposal.body.trim()));
}

export function buildCompleteRequest(input: { summary: string; originalSummary: string; choices: readonly ProposalChoice[]; status: StatusChoice }): CompleteTaskRequest {
  const memory: NonNullable<CompleteTaskRequest["memory"]> = input.choices.map((choice) => {
    const proposal = { ...choice.proposal, title: choice.proposal.title.trim(), body: choice.proposal.body.trim(), selected: choice.selected };
    if (!choice.selected) return { proposal, action: "dismiss" as const };
    if (choice.resolution?.kind === "update") {
      return { proposal, action: "update" as const, targetId: choice.resolution.targetId, targetRevision: choice.resolution.targetRevision };
    }
    return { proposal, action: "create" as const, acknowledgedDuplicates: choice.resolution?.kind === "create-new" ? true : undefined };
  });

  const summary = input.summary.trim();
  return {
    summary: summary && summary !== input.originalSummary.trim() ? summary : undefined,
    memory: memory.length > 0 ? memory : undefined,
    statusUpdate:
      input.status.apply && input.status.body.trim() && input.status.expectedRevision
        ? { body: input.status.body.trim(), expectedRevision: input.status.expectedRevision }
        : undefined,
  };
}

/** Folds a 409's duplicate list back into the choices, clearing any stale answer. */
export function applyConflict(
  choices: readonly ProposalChoice[],
  conflicts: ReadonlyArray<{ proposalId: string; duplicates: MemoryDuplicateMatch[] }>,
): ProposalChoice[] {
  const byId = new Map(conflicts.map((conflict) => [conflict.proposalId, conflict.duplicates]));
  return choices.map((choice) => {
    const duplicates = byId.get(choice.proposal.id);
    return duplicates ? { ...choice, duplicates, resolution: undefined } : choice;
  });
}

let added = 0;

/** Something the person wants remembered that no agent proposed. */
export function humanProposal(project: string, taskId: string): ProposalChoice {
  added += 1;
  return {
    proposal: {
      id: `mp-human-${Date.now().toString(36)}-${added}`,
      type: "lesson",
      title: "",
      body: "",
      project,
      sourceTask: taskId,
      proposedBy: "human",
      selected: true,
    },
    selected: true,
    duplicates: [],
  };
}

/** A validation command as a short label: `npm run build` → `Build`. */
export function validationLabel(command: string): string {
  const known: Array<[RegExp, string]> = [
    [/\bbuild\b/, "Build"],
    [/\blint\b|eslint/, "Lint"],
    [/\btypecheck\b|\btsc\b/, "Typecheck"],
    [/\btest\b|vitest|jest|pytest/, "Tests"],
  ];
  return known.find(([pattern]) => pattern.test(command))?.[1] ?? command;
}
