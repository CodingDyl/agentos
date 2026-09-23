import type {
  VisualCriterion,
  VisualIssue,
  VisualIssueCategory,
  VisualIssueSeverity,
  VisualVerificationVerdict,
} from "../../shared/visual-verification-types";
import { sendToHermes } from "../hermes/client";
import type { VisualContext } from "./references";

/**
 * Asking Hermes whether the implementation looks like the design.
 *
 * Two ideas govern this module.
 *
 * The first is what is being compared. Not pixels — the references in this
 * system are usually inspiration, and "17% different from a mood board" is a
 * precise answer to a question nobody asked. What is compared is intent:
 * hierarchy, layout, spacing, typography, colour, component language, density,
 * design-system compliance. Pixel regression against an exact baseline is a
 * later, different tool.
 *
 * The second is the same asymmetry the code reviewer has: **a pass has to be
 * earned by a reply this module could actually parse.** Anything malformed,
 * ambiguous or unrecognised becomes `unverifiable`. A wrongly-unverifiable job
 * costs an operator a second look; a wrongly-passed one is how a screen nobody
 * checked reaches production.
 */

/** The Hermes skill that carries the visual reviewer's instructions. */
const REVIEW_SKILL = "/verify-visual-implementation";

const SEVERITIES = new Set<VisualIssueSeverity>(["major", "minor"]);

const CATEGORIES = new Set<VisualIssueCategory>([
  "layout",
  "typography",
  "spacing",
  "color",
  "component",
  "responsive",
  "design-system",
  "other",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = asString(entry);
        return text ? [text] : [];
      })
    : [];
}

/** `PASS`, `changes required`, `CHANGES_REQUIRED` — all the same verdict. */
export function readVerdict(
  value: unknown,
): VisualVerificationVerdict | undefined {
  const raw = asString(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return undefined;

  if (raw === "pass" || raw === "passed") return "pass";
  if (raw === "changes_required" || raw === "changes") return "changes_required";

  // `blocked` is what the code reviewer calls the same state, and a reviewer
  // that reaches for it here means the same thing.
  if (raw === "unverifiable" || raw === "blocked") return "unverifiable";

  return undefined;
}

/**
 * Finds the JSON the reviewer was asked to end with.
 *
 * Tries the fenced block first, then the whole reply, then the last
 * brace-delimited span — a model that forgets its fences has still said
 * something structured, and that is worth reading.
 */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter((body) => body.startsWith("{"));

  // The last block, because the reviewer was asked to end with it.
  for (const body of fenced.reverse()) {
    try {
      return JSON.parse(body);
    } catch {
      continue;
    }
  }

  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to the brace scan.
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function readIssues(value: unknown): VisualIssue[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const source = asRecord(entry);
    if (!source) return [];

    const title = asString(source.title) ?? asString(source.summary);
    if (!title) return [];

    const severity = asString(source.severity)?.toLowerCase() as
      | VisualIssueSeverity
      | undefined;

    const category = asString(source.category)
      ?.toLowerCase()
      .replace(/\s+/g, "-") as VisualIssueCategory | undefined;

    return [
      {
        // An unclassifiable finding is still a finding, and defaults to the
        // reading that asks for attention rather than the one that excuses it.
        severity: severity && SEVERITIES.has(severity) ? severity : "major",
        category: category && CATEGORIES.has(category) ? category : "other",
        title,
        detail: asString(source.detail) ?? asString(source.description) ?? title,
        route: asString(source.route),
      },
    ];
  });
}

function readCriteria(value: unknown): VisualCriterion[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const source = asRecord(entry);
    if (!source) return [];

    const criterion = asString(source.criterion) ?? asString(source.name);
    if (!criterion) return [];

    return [
      {
        criterion,
        // Only an explicit yes satisfies a criterion. A missing or unreadable
        // answer is not a quiet one.
        satisfied: source.satisfied === true || source.met === true,
        note: asString(source.note) ?? asString(source.detail),
      },
    ];
  });
}

export interface ParsedVisualReview {
  verdict: VisualVerificationVerdict;
  summary: string;
  strengths: string[];
  issues: VisualIssue[];
  criteria: VisualCriterion[];
  unverifiableReason?: string;
  raw: string;
}

/**
 * Reads Hermes' reply into a verdict.
 *
 * Exported so the parsing can be tested against real replies without calling
 * Hermes. Never returns a `pass` it did not read from structured output.
 */
export function readVisualVerification(text: string): ParsedVisualReview {
  const payload = asRecord(extractJson(text));
  const verdict = readVerdict(payload?.verdict);

  if (!payload || !verdict) {
    // No structured verdict. The one thing that must not happen here is a
    // pass, so the reply is treated as a review that did not conclude.
    const mentionsChanges = /changes[\s_-]?required/i.test(text);

    return {
      verdict: mentionsChanges ? "changes_required" : "unverifiable",
      summary: mentionsChanges
        ? "The reviewer asked for changes but did not return a structured review. Read its reply in full."
        : "The visual review could not be read. It returned no verdict this system could interpret, so it is not being treated as a pass.",
      strengths: [],
      issues: [],
      criteria: [],
      unverifiableReason: mentionsChanges
        ? undefined
        : "Hermes' reply contained no verdict that could be parsed.",
      raw: text,
    };
  }

  const issues = readIssues(payload.issues);
  const summary = asString(payload.summary) ?? "The reviewer returned no summary.";

  // A pass that lists major findings is contradicting itself. The findings are
  // the more specific claim, so they win.
  const contradicted =
    verdict === "pass" && issues.some((issue) => issue.severity === "major");

  return {
    verdict: contradicted ? "changes_required" : verdict,
    summary: contradicted
      ? `${summary} (Recorded as changes required: the review passed the implementation while also raising findings that are not minor.)`
      : summary,
    strengths: asStrings(payload.strengths),
    issues,
    criteria: readCriteria(payload.criteria ?? payload.acceptanceCriteria),
    unverifiableReason:
      verdict === "unverifiable"
        ? (asString(payload.unverifiableReason) ??
          asString(payload.reason) ??
          summary)
        : undefined,
    raw: text,
  };
}

/** The instruction that makes the reply machine-readable without hiding it. */
const OUTPUT_CONTRACT = `Write your review as prose, and end with a single fenced JSON block:

\`\`\`json
{
  "verdict": "PASS" | "CHANGES_REQUIRED" | "UNVERIFIABLE",
  "summary": "one or two sentences",
  "strengths": ["what the implementation gets right"],
  "criteria": [
    { "criterion": "as written above", "satisfied": true, "note": "optional" }
  ],
  "issues": [
    {
      "severity": "major" | "minor",
      "category": "layout" | "typography" | "spacing" | "color" | "component" | "responsive" | "design-system" | "other",
      "title": "short",
      "detail": "what is wrong, and what would bring it in line",
      "route": "optional route this was seen on"
    }
  ],
  "unverifiableReason": "only when the verdict is UNVERIFIABLE"
}
\`\`\`

Rules for the verdict:
- PASS when the implementation follows the intended visual direction closely
  enough to put in front of a person. It does not have to be identical to the
  references.
- CHANGES_REQUIRED when the implementation is functionally there but visually
  off. List every change you want, and only changes you can point at in a
  screenshot.
- UNVERIFIABLE when you cannot honestly judge it — a screenshot is missing, the
  references do not bear on what was built, or you were not given enough to
  compare. Never round this up to a pass.`;

export interface VisualReviewPacketInput {
  project: string;
  objective: string;
  revision: number;
  acceptanceCriteria: readonly string[];
  /** Absolute paths to this revision's captures, with what each one is. */
  screenshots: { route: string; viewport: string; path: string }[];
  context: VisualContext;
  /** Routes that could not be captured, so the verdict can account for them. */
  captureFailures: readonly string[];
}

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

/**
 * The brief Hermes is actually sent.
 *
 * Deliberately narrow: this feature, these references, this design system's
 * rules, these screenshots. Not the whole repository, not the whole design
 * library, not every inspiration image ever collected.
 *
 * Images are given as numbered local paths, which is what the vision tool
 * takes, and each is labelled with what it is — an approved reference or a
 * capture of the implementation. Which side of the comparison an image is on
 * is the one thing the reviewer must not have to guess.
 */
export function buildVisualReviewPacket(input: VisualReviewPacketInput): string {
  const { context } = input;

  const references = context.references.map((reference, index) => {
    const known = [
      reference.tags.length > 0 ? `tags: ${reference.tags.join(", ")}` : undefined,
      reference.notes ? `note: ${reference.notes}` : undefined,
    ].filter(Boolean);

    return `${index + 1}. ${reference.path}\n   (${reference.filename}${
      known.length > 0 ? `; ${known.join("; ")}` : ""
    })`;
  });

  const screenshots = input.screenshots.map(
    (shot, index) =>
      `${index + 1}. ${shot.path}\n   (route ${shot.route}, ${shot.viewport} viewport)`,
  );

  const sections: (string | undefined)[] = [
    "VISUAL IMPLEMENTATION REVIEW",
    "",
    "An automated worker implemented a change, and AgentOS ran the result and",
    "photographed it. Your job is to say whether what it built follows the",
    "intended visual direction. This is not a code review — the code has been",
    "reviewed separately and may be perfectly correct while the screen is wrong.",
    "",
    `PROJECT\n${input.project}`,
    "",
    `WHAT WAS ASKED FOR\n${input.objective}`,
    input.revision > 1
      ? `\nREVISION\nThis is revision ${input.revision}. Earlier visual findings were sent back to the worker; check they were actually addressed.`
      : undefined,
    input.acceptanceCriteria.length > 0
      ? `\nTASK ACCEPTANCE CRITERIA\n${numbered([...input.acceptanceCriteria])}`
      : undefined,
    context.designBrief
      ? `\nDESIGN BRIEF${context.designBriefPath ? ` (${context.designBriefPath})` : ""}\n${context.designBrief}`
      : "\nDESIGN BRIEF\nNone was attached. Judge against the references and the design system, and say in your summary that there was no brief.",
    context.designSystem
      ? `\nDESIGN SYSTEM${context.designSystemPath ? ` (${context.designSystemPath})` : ""}\n${context.designSystem}`
      : undefined,
    references.length > 0
      ? `\nAPPROVED REFERENCE DIRECTION\nThese are the approved direction, not exact mockups. Do not compare them pixel for pixel.\n${references.join("\n")}`
      : "\nAPPROVED REFERENCE DIRECTION\nNone were attached.",
    context.missing.length > 0
      ? `\nMISSING REFERENCES\nThese were named but are no longer in the design library: ${context.missing.join(", ")}. You are comparing against less than was intended.`
      : undefined,
    context.missingBoard
      ? `\nMISSING BOARD\nThe board ${context.missingBoard} was named but no longer exists, so its assets are not below.`
      : undefined,
    screenshots.length > 0
      ? `\nIMPLEMENTATION SCREENSHOTS\n${screenshots.join("\n")}`
      : "\nIMPLEMENTATION SCREENSHOTS\nNone were captured.",
    input.captureFailures.length > 0
      ? `\nROUTES THAT COULD NOT BE CAPTURED\n${input.captureFailures.map((failure) => `- ${failure}`).join("\n")}\nWeigh this in your verdict — you have not seen all of the work.`
      : undefined,
    "",
    "WHAT TO COMPARE",
    "Hierarchy, layout, spacing, typography, colour, component language,",
    "interaction structure, imagery, density, and compliance with the design",
    "system above. Not pixel difference: the references are direction, not a",
    "baseline.",
    "",
    "Inspect every image with vision_analyze before saying anything about it.",
    "Keep what you observed separate from what you recommend — \"the references",
    "use less card framing\" is an observation; \"remove the container borders",
    "around the grid\" is a recommendation. State the observation first.",
    "Describe only what is actually visible; do not infer a screen you were not",
    "shown.",
    "",
    OUTPUT_CONTRACT,
  ];

  return sections.filter((part): part is string => part !== undefined).join("\n");
}

/**
 * Sends one visual review to Hermes and reads the verdict.
 *
 * A Hermes that cannot be reached is not a pass either — the failure is
 * raised, and the caller records the work as unverified rather than as
 * verified and fine.
 */
export async function requestVisualVerification(
  packet: string,
  attribution?: { jobId?: string; project?: string },
): Promise<ParsedVisualReview> {
  const reply = await sendToHermes(`${REVIEW_SKILL}\n\n${packet}`, {
    operation: "visual-review",
    jobId: attribution?.jobId,
    project: attribution?.project,
  });

  return readVisualVerification(reply);
}
