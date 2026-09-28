import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";
import { extractJson, readReview } from "../../hermes/worker-review";
import { buildReviewPacket, buildRevisionRequest } from "../review-builder";
import { integrationBlockerDetails, integrationBlockers } from "../review";

/**
 * The review step is the one that decides whether generated code gets in front
 * of a person as "ready". Its failure modes are not symmetrical: a wrongly
 * blocked job wastes a few minutes, and a wrongly passed one puts unreviewed
 * code on a real branch. These tests are mostly about that asymmetry.
 */

const run = promisify(execFile);

const reply = (payload: unknown, prose = "Looks fine.") =>
  `${prose}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

describe("reading a review", () => {
  it("reads a clean pass", () => {
    const review = readReview(
      "job_1",
      reply({
        verdict: "PASS",
        summary: "Satisfies every criterion.",
        acceptanceCriteria: [{ criterion: "Grid renders", satisfied: true }],
        issues: [],
      }),
    );

    assert.equal(review.verdict, "pass");
    assert.equal(review.summary, "Satisfies every criterion.");
    assert.deepEqual(review.acceptanceCriteria, [
      { criterion: "Grid renders", satisfied: true, note: undefined },
    ]);
  });

  it("accepts the verdict however it is spelled", () => {
    for (const spelling of ["CHANGES_REQUIRED", "changes required", "Changes-Required"]) {
      const review = readReview("job_1", reply({ verdict: spelling, summary: "s", issues: [] }));
      assert.equal(review.verdict, "changes_required", spelling);
    }
  });

  it("refuses to read a pass out of an unparseable reply", () => {
    // The dangerous case: a reviewer that says something approving but returns
    // nothing structured. Treating this as a pass is how unreviewed code lands.
    const review = readReview(
      "job_1",
      "Looks great to me, I'd ship it. PASS, definitely.",
    );

    assert.equal(review.verdict, "blocked");
    assert.match(review.summary, /not being treated as a pass/);
  });

  it("still hears a request for changes in an unstructured reply", () => {
    const review = readReview("job_1", "This needs work — CHANGES_REQUIRED.");

    assert.equal(review.verdict, "changes_required");
  });

  it("keeps the reply verbatim, whatever it made of it", () => {
    const raw = "Some prose the parser could not use.";
    assert.equal(readReview("job_1", raw).raw, raw);
  });

  it("does not let a review pass work it also faulted", () => {
    // A reviewer contradicting itself is not a reason to take the more
    // permissive reading. The specific findings win over the general verdict.
    const review = readReview(
      "job_1",
      reply({
        verdict: "PASS",
        summary: "Mostly fine.",
        issues: [
          { severity: "major", title: "Bypasses HairlineCard", detail: "Reimplements it." },
        ],
      }),
    );

    assert.equal(review.verdict, "changes_required");
    assert.match(review.summary, /also raising findings/);
  });

  it("lets a pass stand when the only findings are minor", () => {
    const review = readReview(
      "job_1",
      reply({
        verdict: "PASS",
        summary: "Good.",
        issues: [{ severity: "minor", title: "Naming nit", detail: "Could be clearer." }],
      }),
    );

    assert.equal(review.verdict, "pass");
  });

  it("treats an unmarked criterion as unsatisfied", () => {
    const review = readReview(
      "job_1",
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "s",
        acceptanceCriteria: [
          { criterion: "Responsive", satisfied: "probably" },
          { criterion: "Tested" },
        ],
        issues: [],
      }),
    );

    // Silence is not consent: an unreadable answer must not count as met.
    assert.deepEqual(
      review.acceptanceCriteria.map((entry) => entry.satisfied),
      [false, false],
    );
  });

  it("keeps a finding it cannot classify rather than dropping it", () => {
    const review = readReview(
      "job_1",
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "s",
        issues: [{ severity: "catastrophic", title: "Something", detail: "d" }],
      }),
    );

    assert.equal(review.issues[0].severity, "major");
  });

  it("finds the JSON however the reviewer wrapped it", () => {
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('```\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(extractJson('{"a":3}'), { a: 3 });
    assert.deepEqual(extractJson('Here you go: {"a":4} — done'), { a: 4 });
    assert.equal(extractJson("no json at all"), undefined);
  });

  it("prefers the last block, which is the one it was asked to end with", () => {
    const text = '```json\n{"verdict":"PASS"}\n```\nActually:\n```json\n{"verdict":"BLOCKED"}\n```';

    assert.equal(readReview("job_1", text).verdict, "blocked");
  });
});

const job: WorkerJob = {
  id: "job_1",
  worker: "grok",
  resolvedWorker: "grok",
  project: "agentos",
  objective: "Add the masonry grid",
  status: "awaiting_review",
  createdAt: new Date().toISOString(),
  revision: 1,
  acceptanceCriteria: ["Grid renders", "Responsive"],
  constraints: ["Follow DESIGN.md"],
  validationCommands: ["npm run build"],
  result: {
    summary: "I added the grid and everything passes.",
    changedFiles: ["src/grid.tsx"],
    tests: [{ command: "npm run build", success: true, detail: "Exit code 0." }],
  },
};

const diff = {
  jobId: "job_1",
  baseCommit: "abc123",
  truncated: false,
  files: [
    {
      path: "src/grid.tsx",
      status: "Modified",
      additions: 12,
      deletions: 3,
      patch: "diff --git a/src/grid.tsx b/src/grid.tsx\n+const grid = 1;",
    },
  ],
};

describe("the review packet", () => {
  const packet = buildReviewPacket(job, diff);

  it("carries what the job was actually asked to satisfy", () => {
    assert.match(packet, /1\. Grid renders/);
    assert.match(packet, /2\. Responsive/);
    assert.match(packet, /Follow DESIGN\.md/);
  });

  it("says who ran the validation", () => {
    // The distinction the whole step rests on: these are AgentOS' results, not
    // the worker's claim about them.
    assert.match(packet, /VALIDATION \(run by AgentOS, not by the worker\)/);
    assert.match(packet, /PASS {2}npm run build/);
  });

  it("labels the worker's summary as a claim to be checked", () => {
    assert.match(packet, /its own account; verify it against the diff/);
    assert.match(packet, /I added the grid and everything passes\./);
  });

  it("includes the diff read from git", () => {
    assert.match(packet, /CHANGED FILES \(read from git\)/);
    assert.match(packet, /\+const grid = 1;/);
  });

  it("carries evidence only — the output schema travels as a system message", () => {
    // The contract used to be appended here, where Hermes' persona outranked
    // it and reviews came back with no JSON block. It now lives beside the
    // parser in `hermes/worker-review.ts` and is sent as a system message, so
    // the packet must not carry a second, driftable copy.
    assert.doesNotMatch(packet, /```json/);
    assert.doesNotMatch(packet, /CHANGES_REQUIRED/);
  });

  it("says plainly when nothing was verified", () => {
    const unverified = buildReviewPacket(
      { ...job, result: { summary: "done" } },
      diff,
    );

    assert.match(unverified, /Nothing was verified\. Weigh that in your verdict\./);
  });

  it("tells a re-review that it is one", () => {
    const second = buildReviewPacket({ ...job, revision: 2 }, diff);

    assert.match(second, /This is revision 2/);
    assert.match(second, /check they were actually addressed/);
  });

  it("admits when the diff was too big to show in full", () => {
    const big = buildReviewPacket(job, {
      ...diff,
      files: [{ path: "huge.ts", status: "Modified", additions: 9000, deletions: 0 }],
    });

    assert.match(big, /Not shown, too large to include: huge\.ts/);
  });
});

describe("the revision request", () => {
  const brief = buildRevisionRequest(job, ["[major] Bypasses HairlineCard"]);

  it("names the findings and nothing else", () => {
    assert.match(brief, /1\. \[major\] Bypasses HairlineCard/);
  });

  it("tells the worker to continue rather than start again", () => {
    assert.match(brief, /continue from it rather than starting again/);
  });

  it("closes the door on scope creep", () => {
    assert.match(brief, /Do not expand the scope/);
    assert.match(brief, /unrelated improvements/);
  });

  it("asks for the validation to be re-run", () => {
    assert.match(brief, /npm run build/);
  });
});

describe("what must be true before anything is integrated", () => {
  let directory: string;
  let repo: string;

  const integrable = (overrides: Partial<WorkerJob> = {}): WorkerJob => ({
    ...job,
    worktreePath: path.join(directory, "worktree"),
    sourceRepoPath: repo,
    workerBranch: "agentos-worker/job_1",
    review: {
      jobId: "job_1",
      verdict: "pass",
      summary: "Fine.",
      issues: [],
      acceptanceCriteria: [],
      reviewedAt: new Date().toISOString(),
    },
    ...overrides,
  });

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-integrate-"));
    repo = path.join(directory, "repo");

    await fs.mkdir(repo, { recursive: true });
    await run("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
    await fs.writeFile(path.join(repo, "README.md"), "# Test\n", "utf8");
    await run("git", ["add", "-A"], { cwd: repo });
    await run(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "init"],
      { cwd: repo },
    );
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("permits work that satisfies every condition", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();

    assert.deepEqual(
      await integrationBlockers(
        integrable({ baseCommit: head, targetBranch: "main" }),
      ),
      [],
    );
  });

  it("refuses work that was never reviewed", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const blockers = await integrationBlockers(
      integrable({ baseCommit: head, targetBranch: "main", review: undefined }),
    );

    assert.ok(blockers.some((blocker) => /has not been reviewed/.test(blocker)));
  });

  it("refuses work the review did not pass", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const blockers = await integrationBlockers(
      integrable({
        baseCommit: head,
        targetBranch: "main",
        review: { ...integrable().review!, verdict: "changes_required" },
      }),
    );

    assert.ok(blockers.some((blocker) => /not pass/.test(blocker)));
  });

  it("refuses work whose validation did not pass", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const blockers = await integrationBlockers(
      integrable({
        baseCommit: head,
        targetBranch: "main",
        result: {
          summary: "s",
          tests: [{ command: "npm run build", success: false }],
        },
      }),
    );

    assert.ok(blockers.some((blocker) => /validation did not pass/.test(blocker)));
  });

  it("refuses when the branch has moved since the job started", async () => {
    // The reviewed tree and the integrated tree would no longer be the same
    // thing, which is exactly what --ff-only exists to prevent.
    const blockers = await integrationBlockers(
      integrable({ baseCommit: "0".repeat(40), targetBranch: "main" }),
    );

    assert.ok(blockers.some((blocker) => /has advanced since this job started/.test(blocker)));
  });

  it("refuses when the operator is on a different branch", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const blockers = await integrationBlockers(
      integrable({ baseCommit: head, targetBranch: "release" }),
    );

    assert.ok(blockers.some((blocker) => /is on main, but this work was branched from release/.test(blocker)));
  });

  it("refuses when the source repository has uncommitted work", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    await fs.writeFile(path.join(repo, "scratch.txt"), "wip\n", "utf8");

    const blockers = await integrationBlockers(
      integrable({ baseCommit: head, targetBranch: "main" }),
    );

    assert.ok(blockers.some((blocker) => /uncommitted changes/.test(blocker)));

    await fs.rm(path.join(repo, "scratch.txt"));
  });
});

describe("the reply shapes that actually came back from Hermes", () => {
  /**
   * The real reply that stalled job_6aa465071c794f16: Hermes answered in its
   * persona's house format — brief prose, no fenced block — after being handed
   * a 116,000-character packet. The parser was not at fault and must not be
   * "fixed" into leniency; the contract now travels as a system message so
   * this shape stops arriving. This pins the behaviour if it ever does.
   */
  it("does not read a pass out of a persona-formatted reply with no JSON", () => {
    const review = readReview(
      "job_1",
      [
        "The worker's summary is a comprehensive report. This fulfills all acceptance criteria.",
        "",
        "**What changed:** A `TECH_DEBT_REPORT.md` file was supposedly created by the worker.",
        "**What's verified:** The worker's self-reported summary meets the criteria.",
        "**What's left:** The actual file was not accessible from the reported path.",
      ].join("\n"),
    );

    assert.equal(review.verdict, "blocked");
    assert.equal(review.issues.length, 0);
    assert.match(review.summary, /could not be read/i);
  });

  /**
   * The first draft of the system contract omitted the vocabulary, and Hermes
   * returned well-formed JSON that still said nothing this module accepts:
   * `"Accepted"` for a verdict, and criteria as a map. Both are thrown away
   * rather than guessed at, which is why the contract now names the enum.
   */
  it("refuses a verdict word it does not recognise, even in clean JSON", () => {
    const review = readReview(
      "job_1",
      '```json\n{"verdict":"Accepted","summary":"The greet function was added.","issues":[]}\n```',
    );

    assert.equal(review.verdict, "blocked");
  });

  it("ignores acceptance criteria sent as a map instead of an array", () => {
    const review = readReview(
      "job_1",
      '```json\n{"verdict":"PASS","summary":"Fine.","acceptanceCriteria":{"A greet function exists.":"Verified"},"issues":[]}\n```',
    );

    assert.equal(review.verdict, "pass");
    assert.deepEqual(review.acceptanceCriteria, []);
  });
});

describe("blockers that carry their own cure", () => {
  let directory: string;
  let repo: string;
  let head: string;

  const reviewed = (overrides: Partial<WorkerJob> = {}): WorkerJob => ({
    ...job,
    worktreePath: path.join(directory, "worktree"),
    sourceRepoPath: repo,
    workerBranch: "agentos-worker/job_1",
    baseCommit: head,
    targetBranch: "main",
    review: {
      jobId: "job_1",
      verdict: "pass",
      summary: "Fine.",
      issues: [],
      acceptanceCriteria: [],
      reviewedAt: new Date().toISOString(),
    },
    ...overrides,
  });

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-cures-"));
    repo = path.join(directory, "repo");

    await fs.mkdir(repo, { recursive: true });
    await run("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
    await fs.writeFile(path.join(repo, "README.md"), "# Test\n", "utf8");
    await run("git", ["add", "-A"], { cwd: repo });
    await run(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "init"],
      { cwd: repo },
    );

    head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("offers the branch to switch to, by name", async () => {
    await run("git", ["checkout", "-qb", "somewhere-else"], { cwd: repo });

    const blockers = await integrationBlockerDetails(reviewed());
    const wrongBranch = blockers.find((entry) => /is on somewhere-else/.test(entry.message));

    assert.deepEqual(wrongBranch?.cure, { kind: "switch", branch: "main" });

    await run("git", ["checkout", "-q", "main"], { cwd: repo });
  });

  it("offers a stash for uncommitted work", async () => {
    await fs.writeFile(path.join(repo, "README.md"), "# Test\n\nedited\n", "utf8");

    const blockers = await integrationBlockerDetails(reviewed());
    const dirty = blockers.find((entry) => /uncommitted changes/.test(entry.message));

    assert.deepEqual(dirty?.cure, { kind: "stash" });

    await run("git", ["checkout", "--", "README.md"], { cwd: repo });
  });

  /**
   * The one blocker with no cure, and the reason the rest of this exists.
   * Rebasing the reviewed tree onto a moved base integrates code nobody
   * reviewed, so the offer is a fresh run against what is actually there.
   */
  it("offers a re-run, never a rebase, when the base has moved", async () => {
    const blockers = await integrationBlockerDetails(
      reviewed({ baseCommit: "0000000000000000000000000000000000000000" }),
    );

    const moved = blockers.find((entry) => /has advanced since this job started/.test(entry.message));

    assert.deepEqual(moved?.cure, { kind: "retry" });
    assert.match(moved?.message ?? "", /rebasing it would produce a result nobody reviewed/);

    // Nothing anywhere in the set may offer to rebase or force.
    for (const entry of blockers) {
      assert.doesNotMatch(JSON.stringify(entry.cure ?? {}), /rebase|force|reset/i);
    }
  });

  /**
   * "Validation did not pass" used to be said of a job where nothing had ever
   * been run, which sent operators looking for a failure that did not exist.
   */
  it("distinguishes validation that failed from validation that never ran", async () => {
    const neverRan = await integrationBlockerDetails(
      reviewed({ validationCommands: [], result: { summary: "done", tests: [] } }),
    );

    const nothing = neverRan.find((entry) => /Nothing was verified/.test(entry.message));
    assert.ok(nothing, "a job with no commands must not be told validation failed");
    // Nothing to run, so nothing to offer.
    assert.equal(nothing?.cure, undefined);

    const notYetRun = await integrationBlockerDetails(
      reviewed({ validationCommands: ["npm test"], result: { summary: "done", tests: [] } }),
    );

    const pending = notYetRun.find((entry) => /has not been run/.test(entry.message));
    assert.deepEqual(pending?.cure, { kind: "validate" });

    const failed = await integrationBlockerDetails(
      reviewed({
        validationCommands: ["npm test"],
        result: { summary: "done", tests: [{ command: "npm test", success: false }] },
      }),
    );

    const broke = failed.find((entry) => /did not pass/.test(entry.message));
    // The failing command is named, so the blocker says something useful.
    assert.match(broke?.message ?? "", /npm test failed/);
    assert.deepEqual(broke?.cure, { kind: "validate" });
  });

  it("still answers the old prose shape for anything reading it", async () => {
    const prose = await integrationBlockers(reviewed({ baseCommit: "0".repeat(40) }));

    assert.ok(prose.every((entry) => typeof entry === "string"));
    assert.ok(prose.some((entry) => /has advanced/.test(entry)));
  });
});
