import type { KnowledgeItem } from "@shared/agentos-types";
import { TYPE_LABELS } from "@/features/projects/documents-model";

/**
 * Filtering for Knowledge. Pure, so it can be tested without a DOM, and so
 * the page stays a rendering of the result.
 */

export type KnowledgeWhen = "any" | "7d" | "30d";

export interface KnowledgeFilters {
  query: string;
  /** Workspace slug, or `all`. */
  workspace: string;
  /** Document type, `decision`, or `all`. */
  type: string;
  /** Artifact source, or `all`. */
  creator: string;
  when: KnowledgeWhen;
}

const DAY = 86_400_000;

export function KNOWLEDGE_TYPE_LABEL(type: KnowledgeItem["type"]): string {
  return type === "decision" ? "Decision" : type === "learning" ? "Learning" : TYPE_LABELS[type];
}

export function filterKnowledge(items: readonly KnowledgeItem[], filters: KnowledgeFilters, now: Date): KnowledgeItem[] {
  const needle = filters.query.trim().toLowerCase();
  const since = filters.when === "7d" ? now.getTime() - 7 * DAY : filters.when === "30d" ? now.getTime() - 30 * DAY : undefined;

  return items.filter((item) => {
    if (filters.workspace !== "all" && item.project !== filters.workspace) return false;
    if (filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.creator !== "all" && item.source !== filters.creator) return false;
    if (since !== undefined && (!item.updatedAt || new Date(item.updatedAt).getTime() < since)) return false;
    if (!needle) return true;

    return [item.title, item.detail, item.projectName, item.taskId, KNOWLEDGE_TYPE_LABEL(item.type)]
      .filter((value): value is string => !!value)
      .some((value) => value.toLowerCase().includes(needle));
  });
}
