import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkerDiff, WorkerJob, WorkerReview } from "../../../shared/worker-types";
import { outputContract, readReview } from "../../hermes/worker-review";
import { buildReviewPacket, previousIssuesFor } from "../review-builder";

/**
 * Hermes used to review every revision from a blank slate, finding a different
 * handful of issues each time, so work cycled between reviewer and worker. The
 * first review is now the complete one and a follow-up only checks it.
 */

const issue = (title: string, severity: "critical" | "major" | "minor" = "major") => ({
  severity,
  title,
  detail: `${title} detail`,
});

const first: WorkerReview = {
  jobId: "job_1",
  verdict: "changes_required",
  summary: "Two problems.",
  issues: [issue("Build is broken"), issue("Missing alt text", "minor")],
  acceptanceCriteria: [],
  reviewedAt: "2026-10-20T00:00:00.000Z",
  revision: 1,
};

const diff: WorkerDiff = { jobId: "job_1", files: [], baseCommit: "abc" } as unknown as WorkerDiff;

const job = (overrides: Partial<WorkerJob> = {}): WorkerJob =>
  ({
    id: "job_1",
    worker: "claude-code",
    project: "bosch",
    objective: "Build the site",
    status: "awaiting_review",
    createdAt: "2026-10-20T00:00:00.000Z",
    revision: 1,
    ...overrides,
  }) as WorkerJob;

const reply = (body: unknown) => `Reasoning.\n\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;

describe("the review contract", () => {
  it("asks for every issue at once on a first review", () => {
    const contract = outputContract("first");
    assert.match(contract, /THIS IS THE ONE FULL REVIEW/);
    assert.match(contract, /EVERY issue/);
    assert.doesNotMatch(contract, /previousIssues/);
  });

  it("asks a follow-up to verify earlier issues by id and report only what is new", () => {
    const contract = outputContract("follow-up");
    assert.match(contract, /FOLLOW-UP REVIEW/);
    assert.match(contract, /"previousIssues"/);
    assert.match(contract, /NOT already in the packet/);
    assert.doesNotMatch(contract, /ONE FULL REVIEW/);
  });
});

describe("what a follow-up review is shown", () => {
  it("lists the previous review's issues by id, and nothing on a first review", () => {
    assert.deepEqual(previousIssuesFor(job()), []);

    const second = job({ revision: 2, review: first });
    assert.equal(previousIssuesFor(second).length, 2);

    const packet = buildReviewPacket(second, diff);
    assert.match(packet, /follow-up review/);
    assert.match(packet, /P1\. \[major\] Build is broken/);
    assert.match(packet, /P2\. \[minor\] Missing alt text/);
  });

  it("does not treat a re-run of the same revision's review as a follow-up", () => {
    assert.deepEqual(previousIssuesFor(job({ revision: 1, review: first })), []);
  });

  it("names issues settled in even earlier rounds so they are not raised again", () => {
    const earlier: WorkerReview = { ...first, revision: 1, issues: [issue("Old finding")] };
    const second: WorkerReview = { ...first, revision: 2, issues: [issue("Newer finding")] };
    const packet = buildReviewPacket(job({ revision: 3, review: second, reviewHistory: [earlier] }), diff);

    assert.match(packet, /P1\. \[major\] Newer finding/);
    assert.match(packet, /ALREADY SETTLED[\s\S]*Old finding/);
  });
});

describe("reading a follow-up reply", () => {
  const previous = first.issues;

  it("passes when every earlier issue is resolved and nothing new is raised", () => {
    const review = readReview(
      "job_1",
      reply({
        verdict: "PASS",
        summary: "All fixed.",
        previousIssues: [
          { id: "P1", resolved: true },
          { id: "P2", resolved: true },
        ],
        issues: [],
        acceptanceCriteria: [],
      }),
      2,
      previous,
    );

    assert.equal(review.verdict, "pass");
    assert.deepEqual(review.issues, []);
    assert.deepEqual(review.resolutions?.map((entry) => entry.resolved), [true, true]);
  });

  it("carries an unresolved issue forward, ahead of new ones, in the same shape", () => {
    const review = readReview(
      "job_1",
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "One left, one new.",
        previousIssues: [
          { id: "P1", resolved: false, note: "Still fails on the footer." },
          { id: "P2", resolved: true },
        ],
        issues: [issue("Heading skips a level")],
        acceptanceCriteria: [],
      }),
      2,
      previous,
    );

    assert.equal(review.verdict, "changes_required");
    assert.deepEqual(review.issues.map((entry) => entry.title), ["Still open: Build is broken", "Heading skips a level"]);
    assert.equal(review.issues[0].severity, "major");
    assert.match(review.issues[0].detail, /Still fails on the footer/);
  });

  it("treats an issue the reviewer did not answer as still open, never as a quiet fix", () => {
    const review = readReview(
      "job_1",
      reply({ verdict: "PASS", summary: "Looks fine.", previousIssues: [{ id: "P2", resolved: true }], issues: [], acceptanceCriteria: [] }),
      2,
      previous,
    );

    assert.equal(review.verdict, "changes_required", "an unanswered major issue cannot pass");
    assert.equal(review.issues[0].title, "Still open: Build is broken");
    assert.equal(review.resolutions?.[0].resolved, false);
  });

  it("leaves a first review's shape alone", () => {
    const review = readReview(
      "job_1",
      reply({ verdict: "CHANGES_REQUIRED", summary: "s", issues: [issue("A"), issue("B")], acceptanceCriteria: [] }),
      1,
    );

    assert.equal(review.issues.length, 2);
    assert.equal(review.resolutions, undefined);
  });
});
