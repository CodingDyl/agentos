import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkerJob, WorkerReview } from "../../../shared/worker-types";
import { readReview } from "../../hermes/worker-review";
import { buildScopingPacket } from "../../hermes/task-scoping";
import { buildContextPacket } from "../context-builder";

/**
 * The send-back loop: a review asking for something the worker cannot do
 * (install Firefox, test on a real iPhone) sent the same job back six times.
 * Such issues are now marked unfixable, a review made only of them is blocked,
 * and a finding that has come back unresolved twice stops being sent.
 */

const reply = (json: object) => `Prose first.\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

describe("reading unfixable findings", () => {
  it("records a review whose serious issues are all beyond the worker as blocked", () => {
    const review = readReview(
      "job_x",
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "Firefox untested.",
        acceptanceCriteria: [],
        issues: [{ severity: "major", title: "Firefox not tested", detail: "Playwright Firefox is not installed", fixable: false }],
      }),
    );
    assert.equal(review.verdict, "blocked");
    assert.equal(review.issues[0].fixable, false);
  });

  it("still asks for changes when something serious is fixable", () => {
    const review = readReview(
      "job_x",
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "Two things.",
        acceptanceCriteria: [],
        issues: [
          { severity: "major", title: "Firefox not tested", detail: "x", fixable: false },
          { severity: "major", title: "Hero overlaps nav at 390px", detail: "y" },
        ],
      }),
    );
    assert.equal(review.verdict, "changes_required");
    assert.equal(review.issues[1].fixable, undefined);
  });
});

describe("what scoping and workers are told", () => {
  it("scoping asks for criteria checkable in one browser, on this machine", () => {
    const packet = buildScopingPacket({ project: "bosch", task: { id: "BO-007", title: "Visual QA", section: "now" } } as never);
    assert.match(packet, /one browser: Chromium/);
    assert.match(packet, /Never require Firefox, Safari/);
  });

  it("workers are told to stop rather than wait on a missing required tool", () => {
    const packet = buildContextPacket({ id: "job_x", project: "bosch", objective: "QA" } as unknown as WorkerJob);
    assert.match(packet, /Do not install browsers/);
    assert.match(packet, /required tool \(reading or editing the project files\) is refused/);
    assert.match(packet, /say so in your summary and stop/);
    assert.match(packet, /optional tool is unavailable or refused/);
  });

  it("tells workers AgentOS runs Chromium outside the sandbox, and not to run it themselves", () => {
    const packet = buildContextPacket({ id: "job_x", project: "bosch", objective: "QA" } as unknown as WorkerJob);
    assert.match(packet, /outside the worker sandbox/);
    assert.match(packet, /Do not run Chromium, Playwright, or a browser-check script/);
    assert.match(packet, /Do not wait for browser evidence of your own/);
    assert.doesNotMatch(packet, /browser-check\.mjs/);
    assert.doesNotMatch(packet, /To look before then/);
  });
});

describe("sending work back", () => {
  let ui: string;
  let previous: string | undefined;
  let review: typeof import("../review");
  let store: typeof import("../job-store");

  const issue = (title: string, extra: object = {}) => ({ severity: "major" as const, title, detail: "d", ...extra });
  const reviewOf = (revision: number, issues: WorkerReview["issues"]): WorkerReview =>
    ({ jobId: "job_loop0000000000000", verdict: "changes_required", summary: "s", issues, acceptanceCriteria: [], reviewedAt: new Date().toISOString(), revision }) as WorkerReview;

  async function job(id: string, current: WorkerReview, history: WorkerReview[] = []) {
    await store.saveJob({
      id,
      worker: "mock",
      requestedWorker: "mock",
      resolvedWorker: "mock",
      project: "demo",
      objective: "QA",
      status: "changes_required",
      revision: history.length + 1,
      createdAt: new Date().toISOString(),
      review: current,
      reviewHistory: history,
    } as never);
  }

  before(async () => {
    ui = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-loop-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = ui;
    review = await import("../review");
    store = await import("../job-store");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(ui, { recursive: true, force: true });
  });

  it("refuses to send back findings the worker cannot fix, and says what to do instead", async () => {
    await job("job_unfixable00000000", reviewOf(1, [issue("Firefox not tested", { fixable: false })]));
    const result = await review.requestRevision("job_unfixable00000000");
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /would repeat the same round/);
    assert.match(result.error ?? "", /acceptance criteria/);
    assert.equal((await store.readJob("job_unfixable00000000"))?.status, "changes_required");
  });

  it("stops sending a finding that came back unresolved after two send-backs", async () => {
    const stuck = issue("WebKit run missing");
    const history = [reviewOf(1, [stuck]), reviewOf(2, [issue("Still open: WebKit run missing")])];
    await job("job_loop0000000000000", reviewOf(3, [issue("Still open: Still open: WebKit run missing")]), history);

    const loaded = await store.readJob("job_loop0000000000000");
    assert.deepEqual([...review.stuckIssues(loaded!)], ["webkit run missing"]);
    const result = await review.requestRevision("job_loop0000000000000");
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /sent back 2 times and still open/);
  });

  it("a finding sent back once can still be sent again", async () => {
    await job("job_once0000000000000", reviewOf(2, [issue("Still open: Hero overlaps nav")]), [reviewOf(1, [issue("Hero overlaps nav")])]);
    assert.equal(review.stuckIssues((await store.readJob("job_once0000000000000"))!).size, 0);
  });
});
