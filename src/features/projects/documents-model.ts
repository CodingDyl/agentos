import type { ArtifactSource, ArtifactType, ProjectArtifact } from "@shared/agentos-types";

/**
 * Vocabulary for documents: how a type and a source read, and how a list is
 * filtered. Shared by the Documents tab, the task panel, the job page and
 * Mission Control so a document is described the same way everywhere.
 */

export const TYPE_LABELS: Record<ArtifactType, string> = {
  plan: "Plan",
  research: "Research",
  spec: "Spec",
  design: "Design",
  review: "Review",
  report: "Report",
  notes: "Notes",
  other: "Document",
};

export const SOURCE_LABELS: Record<ArtifactSource, string> = {
  hermes: "Hermes",
  grok: "Grok",
  claude: "Claude",
  human: "You",
};

export type DocumentFilter = "all" | ArtifactType;

export const FILTERS: readonly { value: DocumentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "spec", label: "Specs" },
  { value: "research", label: "Research" },
  { value: "plan", label: "Plans" },
  { value: "review", label: "Reviews" },
  { value: "report", label: "Reports" },
  { value: "notes", label: "Notes" },
];

/** Case-insensitive match on title, type, task, filename and source. */
export function filterDocuments(
  documents: readonly ProjectArtifact[],
  query: string,
  filter: DocumentFilter,
): ProjectArtifact[] {
  const needle = query.trim().toLowerCase();

  return documents.filter((document) => {
    if (filter !== "all" && document.type !== filter) return false;
    if (!needle) return true;

    return [document.title, document.type, document.taskId, document.filename, document.source, document.relativePath]
      .filter((value): value is string => !!value)
      .some((value) => value.toLowerCase().includes(needle));
  });
}

/** `~3.8k`, `~420`. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return `~${tokens}`;
}

/** Filters that have at least one document, so the bar never offers an empty view. */
export function availableFilters(documents: readonly ProjectArtifact[]): typeof FILTERS {
  const present = new Set(documents.map((document) => document.type));
  return FILTERS.filter((entry) => entry.value === "all" || present.has(entry.value));
}

/** Where a document opens: the project's Documents tab, on that document. */
export function documentHref(document: ProjectArtifact): string {
  const params = new URLSearchParams({ tab: "documents", doc: document.relativePath });
  if (document.origin === "repo") params.set("origin", "repo");
  return `/workspaces/${document.project}?${params.toString()}`;
}
