import { CAREER_SLUG, type CareerGrowth, type GrowthSuggestion, type LinkedInPost, type WorkLogEntry } from "../../shared/career-types";
import { HermesError, sendToHermes } from "../hermes/client";
import { extractJson } from "../hermes/worker-review";
import { newId } from "./store";

/**
 * The two places Career asks Hermes for words. Both run only when a person
 * asks, and neither applies anything: a draft lands in the post editor, a
 * suggestion waits to be accepted or dismissed.
 */

const TIMEOUT_MS = 90_000;

export class CareerHermesError extends Error {}

function recentLog(log: readonly WorkLogEntry[], limit = 15): string {
  return log
    .slice(0, limit)
    .map((entry) =>
      [
        `${entry.date}${entry.client ? ` (${entry.client})` : ""}`,
        ...entry.workedOn.map((line) => `  worked on: ${line}`),
        ...entry.learned.map((line) => `  learned: ${line}`),
        ...entry.blockedBy.map((line) => `  blocked by: ${line}`),
      ].join("\n"),
    )
    .join("\n");
}

async function ask(message: string): Promise<string> {
  try {
    return await sendToHermes(message, { operation: "other", project: CAREER_SLUG, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    throw new CareerHermesError(error instanceof HermesError ? error.message : "Hermes could not be reached.");
  }
}

/** A LinkedIn draft from an idea and recent work. Plain text, no markdown. */
export async function draftLinkedInPost(post: LinkedInPost, log: readonly WorkLogEntry[]): Promise<string> {
  const reply = await ask(
    [
      "Draft a LinkedIn post for a software engineer, in their own first-person voice.",
      "Plain text only: no markdown, no hashtags unless essential, no emoji walls, under 1200 characters.",
      "Concrete and specific; never invent employers, clients, numbers or results that are not in the notes.",
      "Never reveal confidential client detail: describe the technical lesson, not the client's systems.",
      "",
      `Idea: ${post.idea}`,
      post.draft ? `Current draft to improve:\n${post.draft}` : "",
      "",
      "Recent work log (context only):",
      recentLog(log) || "(empty)",
      "",
      "Reply with the post text only.",
    ].join("\n"),
  );
  const text = reply.replace(/^```[a-z]*\n?|```$/g, "").trim();
  if (!text) throw new CareerHermesError("Hermes answered with an empty draft.");
  return text.slice(0, 3000);
}

const KINDS = new Set<GrowthSuggestion["kind"]>(["skill-gap", "next-step", "achievement", "mismatch"]);

/** Reads Hermes' JSON reply into suggestions; anything malformed is dropped. */
export function readSuggestions(value: unknown, now: Date): GrowthSuggestion[] {
  const list = Array.isArray((value as { suggestions?: unknown })?.suggestions) ? (value as { suggestions: unknown[] }).suggestions : [];
  return list.flatMap((item) => {
    const record = item as { kind?: unknown; text?: unknown; proposedGoal?: unknown };
    if (typeof record.text !== "string" || !record.text.trim()) return [];
    const kind = KINDS.has(record.kind as GrowthSuggestion["kind"]) ? (record.kind as GrowthSuggestion["kind"]) : "next-step";
    return [
      {
        id: newId("gs"),
        kind,
        text: record.text.trim().slice(0, 500),
        proposedGoal: typeof record.proposedGoal === "string" && record.proposedGoal.trim() ? record.proposedGoal.trim().slice(0, 500) : undefined,
        createdAt: now.toISOString(),
      },
    ];
  }).slice(0, 6);
}

/** Skill gaps, measurable next steps, achievements worth writing down, and goals the log doesn't match. */
export async function suggestGrowth(growth: CareerGrowth, log: readonly WorkLogEntry[], now: Date = new Date()): Promise<GrowthSuggestion[]> {
  const reply = await ask(
    [
      "You are reviewing a software engineer's career record. Suggest at most 5 items.",
      'Reply with JSON only: {"suggestions":[{"kind":"skill-gap|next-step|achievement|mismatch","text":"...","proposedGoal":"optional measurable goal"}]}',
      "- skill-gap: a skill their goals need that the log shows little of",
      "- next-step: a measurable next step towards a goal",
      "- achievement: something in the log worth recording as evidence",
      "- mismatch: a goal or growth area the recent activity does not serve",
      "Ground every item in the record below. Do not invent facts.",
      "",
      `Role: ${growth.role}`,
      `Next milestone: ${growth.nextMilestone || "(none)"}`,
      `Growth areas: ${growth.growthAreas.join("; ") || "(none)"}`,
      `Active goals: ${growth.goals.filter((goal) => goal.status === "active").map((goal) => goal.text).join("; ") || "(none)"}`,
      `Evidence: ${growth.evidence.slice(0, 15).map((item) => `${item.kind}: ${item.text}`).join("; ") || "(none)"}`,
      "",
      "Recent work log:",
      recentLog(log, 25) || "(empty)",
    ].join("\n"),
  );
  const suggestions = readSuggestions(extractJson(reply), now);
  if (suggestions.length === 0) throw new CareerHermesError("Hermes answered, but with no suggestions AgentOS could read.");
  return suggestions;
}
