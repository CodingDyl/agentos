/**
 * The pure rules of talking to Jarvis. No React, no audio: everything here is
 * decidable from its arguments, so it is tested without a microphone.
 */

export type VoicePhase =
  | "idle"
  | "listening"
  | "transcribing"
  | "confirming"
  | "thinking"
  | "speaking"
  | "error";

/** How long a transcript waits before it is sent. Send goes now; editing stops the clock. */
export const AUTO_SEND_MS = 700;

/** A recording longer than this is stopped for you. */
export const MAX_RECORDING_MS = 60_000;

export interface NamedProject {
  name: string;
  slug: string;
}

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * The one project a sentence names, or none.
 *
 * Whole-name matching only, against the project's name and its slug ("Pantry
 * Pilot", "pantry-pilot"). Ambiguity resolves to nothing rather than a guess:
 * a task filed against the wrong project is worse than one that asks. The
 * confirm step shows the resolved project, so a miss is visible before it
 * matters.
 */
export function projectNamedIn(text: string, projects: readonly NamedProject[]): string | undefined {
  const spoken = normalise(text);

  const hits = projects
    .map((project) => {
      const matched = [project.name, project.slug]
        .map(normalise)
        .filter((needle) => needle.trim().length >= 3 && spoken.includes(needle))
        .sort((a, b) => b.length - a.length)[0];
      return matched ? { slug: project.slug, matched } : undefined;
    })
    .filter((hit): hit is { slug: string; matched: string } => hit !== undefined)
    .sort((a, b) => b.matched.length - a.matched.length);

  if (hits.length === 0) return undefined;

  // "Pilot" is inside "Pantry Pilot": the longer name wins over the name it
  // contains, but two unrelated projects in one sentence stay ambiguous.
  const [best, ...rest] = hits;
  return rest.every((hit) => best.matched.includes(hit.matched)) ? best.slug : undefined;
}

/** What you said beats where you were standing. */
export function resolveProject(
  text: string,
  projects: readonly NamedProject[],
  contextSlug: string | undefined,
): string | undefined {
  return projectNamedIn(text, projects) ?? contextSlug;
}

/** A transcript worth sending: trimmed, and not just filler. */
export function isSendable(text: string): boolean {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").length > 0;
}

/** What each phase says, for the panel and for screen readers. */
export const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: "Ready",
  listening: "Listening",
  transcribing: "Transcribing",
  confirming: "Sending soon",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong",
};
