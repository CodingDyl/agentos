import type {
  WorkerReview,
  WorkerReviewCriterion,
  WorkerReviewIssue,
  WorkerReviewResolution,
  WorkerReviewVerdict,
} from "../../shared/worker-types";
import { ONE_BROWSER_RULE } from "../workers/verifiable";
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
const ONE_BROWSER = `${ONE_BROWSER_RULE} Do not raise missing coverage of other browsers or devices as an issue.`;

const CONTRACT_TEMPLATE = `You are operating as an automated reviewer inside a program, not talking to a person. Your reply is parsed by machine. Reply-length conventions and any habit of reporting work as "what changed / what's verified / what's left" do not apply here: the schema below replaces them.

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
      "criterion": "optional criterion this bears on",
      "fixable": true
    }
  ]
}
\`\`\`

- verdict MUST be exactly one of: PASS, CHANGES_REQUIRED, BLOCKED. No other word is read.
- acceptanceCriteria MUST be an array with one entry per criterion in the packet: never an object or a map.
- severity MUST be one of: critical, major, minor.
- PASS only when the work is safe to put in front of a person for acceptance. Passing validation does not by itself earn a PASS, and a PASS must not also list critical or major issues.
- CHANGES_REQUIRED when something must change.
- BLOCKED when you cannot responsibly judge it: the diff is unreadable, or the brief and the change do not correspond.
- fixable: false when the worker cannot resolve the issue by changing code in its checkout: a tool or browser is not installed, a command needs permission, it needs network, a real device, an external account, or a decision only the person can make. Sending such an issue back to the worker only repeats it. Use BLOCKED when every critical or major issue is not fixable.
- ${ONE_BROWSER}
- Judge the result, not the worker's process. Which tools, skills or instructions files the worker used is not an issue; what the code does is. A check AgentOS ran (its build and its Chromium browser check, under VALIDATION) is browser evidence: do not ask the worker for browser testing it already covers.
- If there are no issues, return an empty array and say so in the summary.

__ROUND__

Judge only what the packet contains. The changed files are already quoted in it; do not try to read them from disk, do not modify anything, and do not run commands. A reply without a parseable block is discarded and the job is recorded as unreviewed.`;

/**
 * The rule for a first review: say everything now.
 *
 * Reviews used to drip-feed. Each one found a few issues, the worker fixed
 * them, and the next one found a few different ones that had been there all
 * along, so work cycled between reviewer and worker for as long as the reviewer
 * kept noticing new things. The first review is the one complete pass; the
 * follow-up only verifies it.
 */
const FIRST_ROUND = `THIS IS THE ONE FULL REVIEW. Go through the work completely before you answer: every acceptance criterion, every changed file, correctness, edge cases, error handling, security, accessibility, and fit with the constraints. List EVERY issue you find in this single pass, minor ones included, ordered most severe first. Do not hold anything back for a later review: after this, the worker fixes what you list and a follow-up review only checks those fixes. Issues you leave out now will not be asked about again.

CHANGES_REQUIRED: list every issue you want addressed, in "issues".`;

/**
 * The rule for a follow-up: verify, then report only what is new.
 *
 * The earlier issues are numbered in the packet so the reply can answer each
 * by id. Anything the reviewer does not answer is treated as still open, so a
 * forgotten issue can never read as a quiet fix.
 */
const FOLLOW_UP_ROUND = `THIS IS A FOLLOW-UP REVIEW. The packet lists the issues the previous review raised, each with an id (P1, P2, ...). The worker was asked to fix them.

1. Add a "previousIssues" array to the JSON, one entry per listed issue: { "id": "P1", "resolved": true, "note": "optional, required when not resolved" }. Check each against the diff; do not take the worker's word for it. An issue you do not answer is treated as still open.
2. "issues" lists only problems that are NOT already in the packet's list: something the revision broke or introduced, or a real defect the first review missed. Same fields as before. Do not repeat an unresolved earlier issue there (it is carried forward from previousIssues), do not re-open one you marked resolved, and do not raise preferences or style opinions that were not issues before.
3. CHANGES_REQUIRED only if an earlier critical or major issue is still unresolved, or you list a new critical or major issue. Otherwise PASS, with any new minor issues listed.`;

export type ReviewRound = "first" | "follow-up";

export function outputContract(round: ReviewRound): string {
  return CONTRACT_TEMPLATE.replace("__ROUND__", round === "first" ? FIRST_ROUND : FOLLOW_UP_ROUND);
}

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
        // Only an explicit `false` marks an issue as beyond the worker.
        ...(source.fixable === false ? { fixable: false } : {}),
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
 * Reads a follow-up's answers about the issues it was shown.
 *
 * Returns the earlier issues still open, rewritten as issues so they travel in
 * the same list as new ones, and one resolution per earlier issue. An issue the
 * reviewer did not answer, or answered in a way that cannot be read, is open:
 * only an explicit `resolved: true` closes one.
 */
function readFollowUp(
  value: unknown,
  previous: readonly WorkerReviewIssue[],
): { carried: WorkerReviewIssue[]; resolutions: WorkerReviewResolution[] } {
  const answers = new Map<string, { resolved: boolean; note?: string }>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      const source = asRecord(entry);
      const id = asString(source?.id)?.toUpperCase();
      if (!source || !id) continue;
      answers.set(id, { resolved: source.resolved === true, note: asString(source.note) });
    }
  }

  const carried: WorkerReviewIssue[] = [];
  const resolutions: WorkerReviewResolution[] = [];

  previous.forEach((issue, index) => {
    const answer = answers.get(`P${index + 1}`);
    const resolved = answer?.resolved === true;
    const note = answer?.note ?? (answer ? undefined : "The follow-up review did not say, so this is treated as still open.");

    resolutions.push({ title: issue.title, resolved, note });

    if (!resolved) {
      carried.push({
        ...issue,
        title: `Still open: ${issue.title.replace(/^Still open:\s*/i, "")}`,
        detail: note ? `${issue.detail}\n\nFollow-up review: ${note}` : issue.detail,
      });
    }
  });

  return { carried, resolutions };
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
  previous: readonly WorkerReviewIssue[] = [],
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

  const raised = readIssues(payload.issues);
  const { carried, resolutions } = readFollowUp(payload.previousIssues, previous);
  // Earlier issues that are still open come first: they are the reason a
  // revision is still being asked for, and the worker is sent this list.
  const issues = [...carried, ...raised];
  const summary =
    asString(payload.summary) ?? "The reviewer returned no summary.";

  // A pass that lists critical or major findings is contradicting itself. The
  // findings are the more specific claim, so they win.
  const contradicted =
    verdict === "pass" &&
    issues.some((issue) => issue.severity !== "minor");

  // Changes the worker cannot make are not a revision: sending them back only
  // repeats the round. When nothing serious is left that the worker can fix,
  // the job is blocked on a person instead.
  const serious = issues.filter((issue) => issue.severity !== "minor");
  const beyondWorker = verdict === "changes_required" && serious.length > 0 && serious.every((issue) => issue.fixable === false);

  return {
    ...base,
    verdict: contradicted ? "changes_required" : beyondWorker ? "blocked" : verdict,
    summary: beyondWorker
      ? `${summary} (Recorded as blocked: every remaining issue needs something the worker cannot do in its checkout.)`
      : contradicted
      ? `${summary} (Recorded as changes required: the review passed the work while also raising findings that are not minor.)`
      : summary,
    issues,
    ...(previous.length > 0 ? { resolutions } : {}),
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
  /** The issues the previous review raised, when this is a follow-up to it. */
  previous: readonly WorkerReviewIssue[] = [],
): Promise<WorkerReview> {
  const reply = await sendToHermes(`${REVIEW_SKILL}\n\n${packet}`, {
    operation: "code-review",
    jobId,
    project,
    system: outputContract(previous.length > 0 ? "follow-up" : "first"),
    timeoutMs: REVIEW_TIMEOUT_MS,
  });

  return readReview(jobId, reply, revision, previous);
}
