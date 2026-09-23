import type {
  WorkerReview,
  WorkerReviewCriterion,
  WorkerReviewIssue,
  WorkerReviewVerdict,
} from "../../shared/worker-types";
import { REVIEW_TIMEOUT_MS, sendToHermes } from "./client";

/**
 * Asking Hermes to review a worker's implementation.
 *
 * The reviewer is a language model, so its reply is read defensively. The rule
 * that matters is this: **a pass has to be earned by a reply this module could
 * actually parse.** Anything ambiguous, malformed, or unrecognised becomes
 * `blocked`, never `pass`.
 *
 * That asymmetry is deliberate. A wrongly-blocked job costs an operator a
 * second look; a wrongly-passed job is how unreviewed code reaches a real
 * branch. The failure modes are not symmetrical, so the parsing is not either.
 */

/** The Hermes skill that carries the reviewer's instructions. */
const REVIEW_SKILL = "/review-worker-job";

/**
 * The output contract, sent as a system message.
 *
 * It lives here rather than in the packet for two reasons. The first is that
 * it has to agree with the parser below, and a schema that drifts from its
 * reader is worse than no schema; keeping them in one file makes a change to
 * one an obvious prompt to change the other.
 *
 * The second is that in the packet it did not work. Hermes' persona tells it
 * to answer briefly and to report finished work as "what changed, what's
 * verified, what's left", and that instruction sits above both the packet and
 * the review skill. Reviews of eighteen-file diffs were coming back as three
 * lines of prose with no JSON block at all, and `readReview` — correctly —
 * refused to read a pass out of them, so every job stalled with no verdict.
 * A system message is the one place an instruction outranks the persona.
 *
 * The vocabulary is spelled out because the first version of this did not,
 * and Hermes returned `"verdict": "Accepted"` and an `acceptanceCriteria`
 * object instead of an array — both well-formed JSON that `readVerdict` and
 * `readCriteria` would still have thrown away.
 */
const OUTPUT_CONTRACT = `You are operating as an automated reviewer inside a program, not talking to a person. Your reply is parsed by machine. Reply-length conventions and any habit of reporting work as "what changed / what's verified / what's left" do not apply here — the schema below replaces them.

Review the packet you are given, write your reasoning as prose, then end your reply with one fenced json block and nothing after it:

\`\`\`json
{
  "verdict": "PASS",
  "summary": "one or two sentences",
  "acceptanceCriteria": [
    { "criterion": "copied verbatim from the packet", "satisfied": true, "note": "optional" }
  ],
  "issues": [
    {
      "severity": "critical",
      "title": "short",
      "detail": "what is wrong and what would fix it",
      "file": "optional path",
      "criterion": "optional criterion this bears on"
    }
  ]
}
\`\`\`

- verdict MUST be exactly one of: PASS, CHANGES_REQUIRED, BLOCKED. No other word is read.
- acceptanceCriteria MUST be an array with one entry per criterion in the packet — never an object or a map.
- severity MUST be one of: critical, major, minor.
- PASS only when the work is safe to put in front of a person for acceptance. Passing validation does not by itself earn a PASS, and a PASS must not also list critical or major issues.
- CHANGES_REQUIRED when something must change. List every issue you want addressed.
- BLOCKED when you cannot responsibly judge it — the diff is unreadable, or the brief and the change do not correspond.
- If there are no issues, return an empty array and say so in the summary.

Judge only what the packet contains. The changed files are already quoted in it; do not try to read them from disk, do not modify anything, and do not run commands. A reply without a parseable block is discarded and the job is recorded as unreviewed.`;

const SEVERITIES = new Set(["critical", "major", "minor"]);

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

/** `PASS`, `changes required`, `CHANGES_REQUIRED` — all the same verdict. */
function readVerdict(value: unknown): WorkerReviewVerdict | undefined {
  const raw = asString(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return undefined;

  if (raw === "pass" || raw === "passed") return "pass";
  if (raw === "changes_required" || raw === "changes") return "changes_required";
  if (raw === "blocked") return "blocked";

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

function readIssues(value: unknown): WorkerReviewIssue[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const source = asRecord(entry);
    if (!source) return [];

    const title =
      asString(source.title) ?? asString(source.summary) ?? asString(source.issue);
    const detail = asString(source.detail) ?? asString(source.description) ?? "";

    if (!title) return [];

    const severity = asString(source.severity)?.toLowerCase() ?? "major";

    return [
      {
        // An unrecognised severity is treated as major rather than dropped: a
        // finding nobody can classify is still a finding.
        severity: (SEVERITIES.has(severity) ? severity : "major") as
          | "critical"
          | "major"
          | "minor",
        title,
        detail: detail || title,
        file: asString(source.file) ?? asString(source.path),
        criterion: asString(source.criterion),
      },
    ];
  });
}

function readCriteria(value: unknown): WorkerReviewCriterion[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const source = asRecord(entry);
    if (!source) return [];

    const criterion =
      asString(source.criterion) ?? asString(source.name) ?? asString(source.title);

    if (!criterion) return [];

    return [
      {
        criterion,
        // Only an explicit `true` satisfies a criterion. A missing or unreadable
        // answer is not a quiet yes.
        satisfied: source.satisfied === true || source.met === true,
        note: asString(source.note) ?? asString(source.detail),
      },
    ];
  });
}

/**
 * Reads Hermes' reply into a review.
 *
 * Exported so the parsing can be tested against real replies without calling
 * Hermes. Never returns a `pass` it did not read from structured output.
 */
export function readReview(
  jobId: string,
  text: string,
  revision?: number,
): WorkerReview {
  const reviewedAt = new Date().toISOString();
  const base = { jobId, reviewedAt, revision, raw: text };

  const payload = asRecord(extractJson(text));
  const verdict = readVerdict(payload?.verdict);

  if (!payload || !verdict) {
    // No structured verdict. The one thing that must not happen here is a pass,
    // so the reply is treated as one the reviewer could not complete.
    const mentionsChanges = /changes[\s_-]?required/i.test(text);

    return {
      ...base,
      verdict: mentionsChanges ? "changes_required" : "blocked",
      summary: mentionsChanges
        ? "The reviewer asked for changes but did not return a structured review. Read its reply in full."
        : "The review could not be read. It did not return a verdict this system could interpret, so it is not being treated as a pass.",
      issues: [],
      acceptanceCriteria: [],
    };
  }

  const issues = readIssues(payload.issues);
  const summary =
    asString(payload.summary) ?? "The reviewer returned no summary.";

  // A pass that lists critical or major findings is contradicting itself. The
  // findings are the more specific claim, so they win.
  const contradicted =
    verdict === "pass" &&
    issues.some((issue) => issue.severity !== "minor");

  return {
    ...base,
    verdict: contradicted ? "changes_required" : verdict,
    summary: contradicted
      ? `${summary} (Recorded as changes required: the review passed the work while also raising findings that are not minor.)`
      : summary,
    issues,
    acceptanceCriteria: readCriteria(payload.acceptanceCriteria ?? payload.criteria),
  };
}

/**
 * Sends one review packet to Hermes and reads the verdict.
 *
 * A Hermes that cannot be reached is not a pass either — the failure is raised,
 * and the caller records the job as unreviewed rather than as reviewed and fine.
 */
export async function requestReview(
  jobId: string,
  packet: string,
  revision?: number,
  project?: string,
): Promise<WorkerReview> {
  const reply = await sendToHermes(`${REVIEW_SKILL}\n\n${packet}`, {
    operation: "code-review",
    jobId,
    project,
    system: OUTPUT_CONTRACT,
    timeoutMs: REVIEW_TIMEOUT_MS,
  });

  return readReview(jobId, reply, revision);
}
