import type {
  DesignInsight,
  DesignReview,
  DesignReviewMode,
} from "../../shared/design-intelligence-types";
import type { ResolvedReference } from "../designs/review-context";

/**
 * Asking Hermes what a set of design references suggests.
 *
 * The skill does the looking — it is told to inspect each image with
 * `vision_analyze` before saying anything. This module composes the request
 * and reads the answer back, and its whole job is to keep two things apart
 * that a model will happily merge: what is visible in the images, and what
 * someone should do about it.
 *
 * The reply is prose with headings rather than JSON, deliberately. A design
 * review is written to be read, and the structure here exists to let the
 * console lay it out — not to reduce it to fields. The raw answer is kept
 * either way, because the parse is a reading and readings can be wrong.
 */

/** The Hermes skill that carries the reviewer's instructions. */
const REVIEW_SKILL = "/review-design";

const MAX_ITEMS = 10;
const MAX_ITEM_CHARS = 400;
const MAX_SUMMARY_CHARS = 2_000;

/** What each mode is actually asking for, in one line for the prompt. */
const MODE_BRIEF: Record<DesignReviewMode, string> = {
  direction:
    "Identify the shared direction these references point to, and what would suit this project.",
  critique:
    "Evaluate these as interfaces: hierarchy, usability, consistency, accessibility, interaction clarity.",
  compare:
    "Compare the references: what differs, what is strongest in each, what should and should not be combined.",
  "design-system":
    "Extract the system these imply: colour, typography, spacing, radii, surfaces, controls, layout, motion.",
};

export interface ReviewPacketInput {
  project: string;
  mode: DesignReviewMode;
  question?: string;
  references: ResolvedReference[];
  projectContext: string;
}

/**
 * The brief Hermes is actually sent.
 *
 * References are given as numbered local paths, which is what the vision tool
 * takes. What the library already knows about each one — its filename, tags,
 * notes — is included so the answer can refer to an image the way a person
 * would rather than as "image 3".
 */
export function buildReviewPacket(input: ReviewPacketInput): string {
  const references = input.references.map((reference, index) => {
    const known = [
      reference.tags.length > 0 ? `tags: ${reference.tags.join(", ")}` : undefined,
      reference.notes ? `note: ${reference.notes}` : undefined,
    ].filter(Boolean);

    return `${index + 1}. ${reference.path}\n   (${reference.filename}${
      known.length > 0 ? `; ${known.join("; ")}` : ""
    })`;
  });

  return [
    `Mode: ${input.mode}`,
    "",
    `Project: ${input.project}`,
    "",
    MODE_BRIEF[input.mode],
    "",
    "References:",
    ...references,
    "",
    input.question ? `Question:\n${input.question}\n` : undefined,
    input.projectContext
      ? `Project context:\n\n${input.projectContext}\n`
      : undefined,
    "Inspect every reference with vision_analyze before answering. Describe",
    "only what is actually visible. Do not infer a screen you cannot see.",
    "Keep what you observed separate from what you recommend.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

/** The full input for one run, skill invocation included. */
export function buildReviewInput(input: ReviewPacketInput): string {
  return `${REVIEW_SKILL}\n\n${buildReviewPacket(input)}`;
}

/**
 * Everything under one `##` heading, up to the next one.
 *
 * The trailing lookahead is `(?![\s\S])` — end of input — rather than `\z`,
 * which JavaScript does not have and would silently match a literal "z",
 * truncating any section that happened to contain one.
 */
function section(markdown: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const pattern = new RegExp(
      `^#{1,4}\\s*${escaped}\\s*$([\\s\\S]*?)(?=^#{1,4}\\s|(?![\\s\\S]))`,
      "im",
    );

    const match = pattern.exec(markdown);
    const body = match?.[1]?.trim();

    if (body) return body;
  }

  return undefined;
}

/** Bullet lines in a section, without their markers. */
function bullets(body: string | undefined): string[] {
  if (!body) return [];

  return body
    .split("\n")
    .map((line) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .map((line) => line.slice(0, MAX_ITEM_CHARS))
    .slice(0, MAX_ITEMS);
}

/**
 * A bullet read as a titled insight.
 *
 * `**Large focal areas** — every reference leads with one image` becomes a
 * title and a detail. A bullet with no such split keeps its whole text as the
 * title, because inventing a division that is not there would be worse than
 * showing the line as written.
 */
function insights(body: string | undefined): DesignInsight[] {
  return bullets(body).map((line) => {
    const bold = /^\*\*(.+?)\*\*\s*[—–:-]?\s*(.*)$/.exec(line);

    if (bold) {
      return { title: bold[1].trim(), detail: bold[2].trim() || bold[1].trim() };
    }

    const split = /^(.{3,60}?)\s+[—–]\s+(.+)$/.exec(line);

    if (split) return { title: split[1].trim(), detail: split[2].trim() };

    return { title: line, detail: line };
  });
}

/** Prose from a section, with any bullets left out. */
function prose(body: string | undefined): string | undefined {
  if (!body) return undefined;

  const text = body
    .split("\n")
    .filter((line) => !/^\s*(?:[-*+]|\d+[.)])\s+/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > 0 ? text.slice(0, MAX_SUMMARY_CHARS) : undefined;
}

/**
 * Reads a reply into a review.
 *
 * Tolerant by design. The skill asks for specific headings, but a model that
 * writes `## Design Direction` instead of `## Direction`, or omits a section
 * it had nothing to say about, has still produced a usable review — and the
 * raw text is kept regardless, so nothing is lost to a heading this did not
 * recognise.
 */
export function readDesignReview(
  text: string,
): Pick<
  DesignReview,
  | "summary"
  | "patterns"
  | "recommendations"
  | "avoid"
  | "implementationNotes"
  | "bestNextMove"
  | "raw"
> {
  const directionBody = section(text, "Direction", "Design Direction", "Summary");
  const avoid = bullets(section(text, "Avoid", "What to Avoid"));
  const notes = bullets(section(text, "Implementation Notes", "Implementation"));
  const next = prose(section(text, "Best Next Move", "Next Move", "Next Step"));

  // The whole reply is the fallback summary. A review whose headings could not
  // be read is still worth showing, and showing nothing would be worse.
  const summary =
    prose(directionBody) ??
    prose(text.replace(/^#.*$/gm, "")) ??
    "Hermes returned a review that could not be read. The full reply is below.";

  return {
    summary,
    patterns: insights(section(text, "Patterns", "Observations")),
    recommendations: insights(
      section(text, "Recommendations", "Recommendation"),
    ),
    avoid: avoid.length > 0 ? avoid : undefined,
    implementationNotes: notes.length > 0 ? notes : undefined,
    bestNextMove: next,
    raw: text,
  };
}
