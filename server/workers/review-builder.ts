import type { VisualIssue } from "../../shared/visual-verification-types";
import type { WorkerDiff, WorkerJob } from "../../shared/worker-types";

/**
 * The review packet.
 *
 * Everything a reviewer needs to judge one job, and nothing else: the brief it
 * was given, what it was supposed to satisfy, what changed, and what the
 * validation commands actually returned. No vault, no portfolio, no session
 * history, no other jobs.
 *
 * Scope is doing two jobs here. It keeps the review cheap and focused, and it
 * keeps the reviewer honest: a reviewer that cannot see the rest of the system
 * cannot excuse a change by appealing to something outside the brief.
 *
 * The packet is built from the job record and from git — never from the
 * worker's own account of what it did. The worker's summary is included, but
 * labelled as a claim, because a reviewer should be able to notice when a
 * summary and a diff disagree.
 */

/** Bounds the packet so one enormous diff cannot swamp the request. */
const MAX_PATCH_CHARS = 120_000;

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function bulleted(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * The output schema is deliberately NOT here.
 *
 * It travels as a system message from `server/hermes/worker-review.ts`, next
 * to the parser that has to agree with it. In the packet it lost to Hermes'
 * own persona and reviews came back with no JSON block at all; a system
 * message is the only place it reliably wins. This file assembles evidence.
 */

/**
 * Renders the diff for review.
 *
 * Files whose patch could not be included are still named, with their line
 * counts, so a reviewer knows the change is bigger than what they were shown
 * rather than silently reviewing part of it.
 */
function renderDiff(diff: WorkerDiff): string {
  if (diff.files.length === 0) return "The worker changed nothing.";

  const listing = diff.files
    .map(
      (file) =>
        `${file.status.charAt(0)}  ${file.path}  (+${file.additions} −${file.deletions})`,
    )
    .join("\n");

  let budget = MAX_PATCH_CHARS;
  const omitted: string[] = [];
  const patches: string[] = [];

  for (const file of diff.files) {
    if (file.patch && file.patch.length <= budget) {
      patches.push(file.patch);
      budget -= file.patch.length;
    } else {
      omitted.push(file.path);
    }
  }

  return [
    listing,
    "",
    "DIFF",
    patches.join("\n\n"),
    omitted.length > 0
      ? `\nNot shown, too large to include: ${omitted.join(", ")}. Judge these by their line counts, or say the diff was incomplete.`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * Builds the packet for one job.
 *
 * Plain text, like the job packet a worker gets, and for the same reason: an
 * operator can read exactly what the reviewer was shown when they want to know
 * why it said what it said.
 */
export function buildReviewPacket(job: WorkerJob, diff: WorkerDiff): string {
  const validation = (job.result?.tests ?? []).map(
    (test) =>
      `${test.success ? "PASS" : "FAIL"}  ${test.command}${
        test.success ? "" : `\n      ${test.detail ?? ""}`.trimEnd()
      }`,
  );

  const sections: (string | undefined)[] = [
    "WORKER REVIEW",
    "",
    "You are reviewing a completed implementation before a person is asked to",
    "accept it. The work was done by an automated worker in an isolated",
    "checkout. Nothing has been committed, and nothing will be until a person",
    "approves it.",
    "",
    `PROJECT\n${job.project}`,
    "",
    `OBJECTIVE\n${job.objective}`,
    job.revision && job.revision > 1
      ? `\nREVISION\nThis is revision ${job.revision}. Earlier findings were sent back to the worker; check they were actually addressed.`
      : undefined,
    (job.acceptanceCriteria ?? []).length > 0
      ? `\nACCEPTANCE CRITERIA\n${numbered(job.acceptanceCriteria ?? [])}`
      : "\nACCEPTANCE CRITERIA\nNone were given. Say so, and judge against the objective alone.",
    (job.constraints ?? []).length > 0
      ? `\nCONSTRAINTS\n${bulleted(job.constraints ?? [])}`
      : undefined,
    (job.contextFiles ?? []).length > 0
      ? `\nRELEVANT CONTEXT\n${bulleted(job.contextFiles ?? [])}`
      : undefined,
    validation.length > 0
      ? `\nVALIDATION (run by AgentOS, not by the worker)\n${validation.join("\n")}`
      : "\nVALIDATION\nNothing was verified. Weigh that in your verdict.",
    // Labelled as a claim on purpose: noticing where this and the diff diverge
    // is one of the more useful things a reviewer can do.
    `\nWHAT THE WORKER SAID IT DID (its own account; verify it against the diff)\n${
      job.result?.summary ?? "It said nothing."
    }`,
    (job.result?.blockers ?? []).length > 0
      ? `\nBLOCKERS THE WORKER REPORTED\n${bulleted(job.result?.blockers ?? [])}`
      : undefined,
    `\nCHANGED FILES (read from git)\n${renderDiff(diff)}`,
  ];

  return sections.filter((part): part is string => part !== undefined).join("\n");
}

/**
 * The revision request sent back to a worker after a review found something.
 *
 * Deliberately narrow. The worker already has the original brief and its own
 * work in front of it; what it needs now is the findings and an instruction not
 * to treat them as licence to keep going.
 */
export function buildRevisionRequest(
  job: WorkerJob,
  findings: readonly string[],
): string {
  return [
    "REVISION REQUEST",
    "",
    "Your previous implementation was reviewed independently. The work is still",
    "in the same checkout; continue from it rather than starting again.",
    "",
    `ORIGINAL OBJECTIVE\n${job.objective}`,
    "",
    `FINDINGS TO ADDRESS\n${numbered(findings)}`,
    "",
    "Address only these findings. Do not expand the scope, refactor beyond what",
    "they require, or take the opportunity to make unrelated improvements.",
    "",
    (job.validationCommands ?? []).length > 0
      ? `When you are finished, re-run:\n${bulleted(job.validationCommands ?? [])}`
      : "",
    "",
    "Then reply with a short summary of what you changed in response to each",
    "finding.",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * The revision request sent back after a *visual* review found something.
 *
 * Narrower than the code-review one, and pointedly so. The implementation has
 * already passed validation and may have passed code review too — what is
 * wrong with it is what it looks like. A worker told only "there were findings"
 * will start refactoring, so this says outright that the code is fine and that
 * the findings below are the entire scope.
 *
 * Findings are rendered with their route and category, because "the spacing is
 * wrong" is not actionable and "the section labels on /designs sit too close to
 * their content" is.
 */
export function buildVisualRevisionRequest(
  job: WorkerJob,
  issues: readonly VisualIssue[],
): string {
  const findings = issues.map((issue) =>
    [
      `[${issue.severity}/${issue.category}] ${issue.title}`,
      issue.route ? `Route: ${issue.route}` : undefined,
      issue.detail,
    ]
      .filter(Boolean)
      .join("\n   "),
  );

  const acceptance = job.visualAcceptance;

  const references = [
    acceptance?.designBriefPath
      ? `Design brief: ${acceptance.designBriefPath}`
      : undefined,
    acceptance?.boardId
      ? `Approved design board: ${acceptance.boardId}`
      : undefined,
    "The repository's own design system document, if it has one.",
  ].filter((line): line is string => line !== undefined);

  return [
    "VISUAL REVISION REQUEST",
    "",
    "Your implementation was run and photographed, and the screenshots were",
    "reviewed against the approved design direction. The work is functionally",
    "correct. This is not a bug report. It is still in the same checkout;",
    "continue from it rather than starting again.",
    "",
    `ORIGINAL OBJECTIVE\n${job.objective}`,
    "",
    `VISUAL FINDINGS TO ADDRESS\n${numbered(findings)}`,
    "",
    "Address only these visual findings. Do not change unrelated functionality,",
    "do not refactor, and do not take the opportunity to redesign anything that",
    "was not named above.",
    "",
    `REFERENCE\n${bulleted(references)}`,
    "",
    (job.validationCommands ?? []).length > 0
      ? `When you are finished, re-run:\n${bulleted(job.validationCommands ?? [])}`
      : "",
    "",
    "Then reply with a short summary of what you changed in response to each",
    "finding. The implementation will be run and photographed again, and the",
    "new screenshots reviewed. Saying it is fixed is not what closes this.",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}
