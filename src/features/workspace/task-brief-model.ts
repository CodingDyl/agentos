export interface TaskBriefDraft {
  desiredOutcome: string;
  scope: string;
  acceptance: string;
  constraints: string;
  links: string;
  files: File[];
}

export function emptyTaskBriefDraft(): TaskBriefDraft {
  return {
    desiredOutcome: "",
    scope: "",
    acceptance: "",
    constraints: "",
    links: "",
    files: [],
  };
}

export function taskBriefHasContent(draft: TaskBriefDraft): boolean {
  return Boolean(
    draft.desiredOutcome.trim() ||
      draft.scope.trim() ||
      draft.acceptance.trim() ||
      draft.constraints.trim() ||
      draft.links.trim() ||
      draft.files.length,
  );
}

export function lines(value: string): string[] | undefined {
  const items = value.split("\n").map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}
