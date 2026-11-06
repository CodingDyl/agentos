import { DESIGN_RUBRIC_MAX, type RebuildDesignConcept } from "@shared/website-rebuild-types";

/** What the critique said about a concept, in words a person reads at a glance. */
export function critiqueStatus(entry: RebuildDesignConcept | undefined): { text: string; tone: "green" | "flame" | "marigold" | "muted" } {
  if (!entry || entry.score === undefined) return { text: entry?.escalated ? "Not scored: your call" : "Not scored", tone: "muted" };
  const score = `${entry.score}/${DESIGN_RUBRIC_MAX}`;
  if (entry.passed) return { text: entry.autoRevised ? `${score} · passed after one revision` : score, tone: "green" };
  return { text: entry.autoRevised ? `${score} · below the bar after one revision` : `${score} · below the bar`, tone: entry.autoRevised ? "flame" : "marigold" };
}
