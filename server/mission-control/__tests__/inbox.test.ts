import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MotionRun } from "../../../shared/motion-design-types";
import type { OperatorRun } from "../../../shared/operator-types";
import type { RebuildRunSummary, RebuildStage } from "../../../shared/website-rebuild-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { aggregateInbox, applyBlockersInbox, motionInbox, operatorInbox, rebuildInbox, uncertainJobInbox } from "../inbox";
import { buildAttention } from "../attention";

function stage(overrides: Partial<RebuildStage> & Pick<RebuildStage, "id" | "status">): RebuildStage {
  return {
    attempts: 1,
    revision: overrides.revision ?? 1,
    ...overrides,
  };
}

function rebuild(overrides: Partial<RebuildRunSummary> = {}): RebuildRunSummary {
  return {
    id: "reb_1",
    prospectId: "p1",
    company: "Acme Electrical",
    updatedAt: "2026-10-12T09:00:00.000Z",
    stages: [],
    ...overrides,
  };
}

function motion(overrides: Partial<MotionRun> = {}): MotionRun {
  return {
    id: "mdn_aaaaaaaaaaaaaaaa",
    workspaceSlug: "dusk-counter",
    status: "running",
    step: "progress",
    brief: {
      brandName: "Dusk",
      brandSells: "",
      brandAudience: "",
      vibe: "",
      journeyStart: "",
      journeyEnd: "",
      journeyBeats: "",
      sections: "",
      cta: "",
      extrasCharacter: false,
      extrasDeploy: "",
      youDecide: {},
    },
    references: [],
    budgetPlan: "standard",
    codeOnly: false,
    model: "claude-opus-5-5",
    effort: "max",
    concepts: [],
    notes: [],
    createdAt: "2026-10-12T08:00:00.000Z",
    updatedAt: "2026-10-12T09:00:00.000Z",
    ...overrides,
  };
}

function operator(overrides: Partial<OperatorRun> = {}): OperatorRun {
  return {
    id: "run_1",
    input: "Stand up the preview",
    mode: "do",
    plan: [],
    risks: [],
    agents: [],
    connectors: [],
    status: "awaiting_approval",
    changes: [],
    memoryProposals: [],
    taskProposals: [],
    jobIds: [],
    errors: [],
    usage: { modelCalls: 0, estimate: "low" },
    startedAt: "2026-10-12T08:00:00.000Z",
    ...overrides,
  } as OperatorRun;
}

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: "job_aaaaaaaaaaaaaaaa",
    worker: "claude-code",
    project: "pantry-pilot",
    objective: "Ship the retry flow",
    status: "running",
    createdAt: "2026-10-12T08:00:00.000Z",
    ...overrides,
  } as WorkerJob;
}

describe("website rebuild inbox items", () => {
  it("raises a hero concept pick as an approval, with Open rather than a blind Approve", () => {
    const [item] = rebuildInbox(
      rebuild({
        stages: [stage({ id: "hero", status: "awaiting_approval", revision: 2, finishedAt: "2026-10-12T09:00:00.000Z" })],
      }),
    );
    assert.equal(item.type, "approval");
    assert.equal(item.source, "rebuild");
    assert.match(item.title, /Acme Electrical/);
    assert.match(item.description ?? "", /concept/i);
    assert.equal(item.action.href, "/rebuilds/reb_1");
    assert.equal(item.rebuild?.approve, false);
    assert.equal(item.rebuild?.stage, "hero");
    assert.equal(item.rebuild?.revision, 2);
  });

  it("lets a non-hero gated stage be approved inline", () => {
    const [item] = rebuildInbox(
      rebuild({
        stages: [stage({ id: "build", status: "awaiting_approval", revision: 1 })],
      }),
    );
    assert.equal(item.rebuild?.approve, true);
    assert.equal(item.rebuild?.stage, "build");
  });

  it("offers Deploy now (force) and Re-check Vercel on a blocked preview, and Retry on other blocked stages", () => {
    const preview = rebuildInbox(
      rebuild({
        stages: [
          stage({
            id: "preview",
            status: "blocked",
            blocker: "Vercel started a production deployment of the preview branch.",
            finishedAt: "2026-10-12T10:00:00.000Z",
          }),
        ],
      }),
    )[0];
    assert.equal(preview.type, "blocked");
    assert.equal(preview.rebuild?.forceDeploy, true);
    assert.equal(preview.rebuild?.recheck, true);
    assert.equal(preview.rebuild?.retry, false);

    const capture = rebuildInbox(
      rebuild({
        stages: [stage({ id: "capture", status: "blocked", blocker: "The site answered 503." })],
      }),
    )[0];
    assert.equal(capture.rebuild?.forceDeploy, false);
    assert.equal(capture.rebuild?.retry, true);
  });

  it("ignores stages that are moving or done", () => {
    assert.deepEqual(
      rebuildInbox(
        rebuild({
          stages: [
            stage({ id: "workspace", status: "complete" }),
            stage({ id: "research", status: "in_progress" }),
            stage({ id: "hero", status: "not_started", revision: 0 }),
          ],
        }),
      ),
      [],
    );
  });
});

describe("motion design credit and concept gates", () => {
  it("raises a credit approval gate with the brand name", () => {
    const [item] = motionInbox(
      motion({
        status: "awaiting_approval",
        step: "approval",
        concepts: [
          {
            id: "a",
            title: "Dusk counter",
            summary: "Overhead kitchen film.",
            plannedCredits: 280,
            itemized: [],
          },
        ],
      }),
    );
    assert.equal(item.type, "approval");
    assert.equal(item.source, "motion");
    assert.match(item.title, /Dusk/);
    assert.match(item.description ?? "", /credit|concept/i);
    assert.equal(item.action.href, "/workspaces/dusk-counter");
    assert.equal(item.motion?.runId, "mdn_aaaaaaaaaaaaaaaa");
  });

  it("raises a failed Claude motion run", () => {
    const [item] = motionInbox(motion({ status: "failed", error: "Claude Code (`claude`) is not installed." }));
    assert.equal(item.type, "failed");
    assert.equal(item.source, "motion");
    assert.match(item.description ?? "", /claude/i);
  });

  it("says nothing about a run that is building or done", () => {
    assert.deepEqual(motionInbox(motion({ status: "building" })), []);
    assert.deepEqual(motionInbox(motion({ status: "completed" })), []);
  });
});

describe("operator, uncertain jobs, and apply blockers", () => {
  it("raises an operator run waiting for approval", () => {
    const [item] = operatorInbox(operator());
    assert.equal(item.type, "approval");
    assert.equal(item.source, "operator");
    assert.equal(item.operator?.runId, "run_1");
    assert.equal(item.operator?.approve, true);
    assert.equal(item.action.href, "/operator/runs/run_1");
  });

  it("raises a blocked operator run, not a completed one", () => {
    const [blocked] = operatorInbox(operator({ status: "blocked", statusDetail: "GitHub refused the repo." }));
    assert.equal(blocked.type, "blocked");
    assert.deepEqual(operatorInbox(operator({ status: "completed" })), []);
  });

  it("raises an uncertain worker job, including a stale Claude run, and ignores a live one", () => {
    const stale = uncertainJobInbox(job({ worker: "claude-code", resolvedWorker: "claude-code", startedAt: "2026-10-12T06:00:00.000Z" }), new Set());
    assert.equal(stale?.type, "blocked");
    assert.equal(stale?.source, "workers");
    assert.match(stale?.description ?? "", /unconfirmed|stale|not running/i);

    assert.equal(
      uncertainJobInbox(job({ id: "job_live", status: "running" }), new Set(["job_live"])),
      undefined,
    );
    assert.equal(uncertainJobInbox(job({ status: "failed" }), new Set()), undefined);
  });

  it("raises recorded apply blockers on a job that has otherwise passed review", () => {
    const [item] = applyBlockersInbox(
      job({
        status: "awaiting_review",
        review: {
          jobId: "job_aaaaaaaaaaaaaaaa",
          verdict: "pass",
          summary: "ok",
          issues: [],
          acceptanceCriteria: [],
          reviewedAt: "2026-10-12T09:00:00.000Z",
        },
        result: { summary: "done", blockers: ["The source repository has uncommitted changes."] },
      }),
    );
    assert.equal(item.type, "blocked");
    assert.equal(item.source, "apply");
    assert.match(item.description ?? "", /uncommitted changes/);
    assert.equal(item.action.href, "/workers/jobs/job_aaaaaaaaaaaaaaaa");
  });

  it("does not invent an apply blocker when none were recorded", () => {
    assert.deepEqual(
      applyBlockersInbox(
        job({
          status: "awaiting_review",
          review: {
            jobId: "job_aaaaaaaaaaaaaaaa",
            verdict: "pass",
            summary: "ok",
            issues: [],
            acceptanceCriteria: [],
            reviewedAt: "2026-10-12T09:00:00.000Z",
          },
        }),
      ),
      [],
    );
  });
});

describe("one aggregated inbox", () => {
  it("merges every source and keeps the existing severity-first order", () => {
    const items = aggregateInbox({
      attention: buildAttention({
        jobs: [job({ id: "job_fail", status: "failed", error: "build failed", completedAt: "2026-10-12T09:00:00.000Z" })],
        automations: [],
        projects: [],
        degraded: [],
      }),
      rebuilds: [
        rebuild({
          stages: [stage({ id: "hero", status: "awaiting_approval", revision: 1 })],
        }),
      ],
      motion: [motion({ status: "awaiting_approval", step: "approval" })],
      operator: [operator()],
      jobs: [job({ id: "job_stale", worker: "claude-code", status: "running", startedAt: "2026-10-11T08:00:00.000Z" })],
      runningJobIds: new Set(),
    });

    const sources = new Set(items.map((item) => item.source));
    assert.ok(sources.has("workers"));
    assert.ok(sources.has("rebuild"));
    assert.ok(sources.has("motion"));
    assert.ok(sources.has("operator"));
    assert.equal(items[0]?.type, "failed");
  });

  it("returns nothing on a quiet day", () => {
    assert.deepEqual(
      aggregateInbox({
        attention: [],
        rebuilds: [rebuild({ stages: [stage({ id: "workspace", status: "complete" })] })],
        motion: [motion({ status: "completed" })],
        operator: [operator({ status: "completed" })],
        jobs: [job({ status: "running" })],
        runningJobIds: new Set(["job_aaaaaaaaaaaaaaaa"]),
      }),
      [],
    );
  });

  it("does not double-count a failed job that attention already raised", () => {
    const failed = job({ status: "failed", error: "boom", completedAt: "2026-10-12T09:00:00.000Z" });
    const items = aggregateInbox({
      attention: buildAttention({ jobs: [failed], automations: [], projects: [], degraded: [] }),
      rebuilds: [],
      motion: [],
      operator: [],
      jobs: [failed],
      runningJobIds: new Set(),
    });
    assert.equal(items.filter((item) => item.id.includes(failed.id)).length, 1);
  });
});
