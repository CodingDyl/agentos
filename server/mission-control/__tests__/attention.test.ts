import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Automation, ProjectSummary } from "../../../shared/agentos-types";
import type { WorkerJob } from "../../../shared/worker-types";
import {
  failedJobAttention,
  automationAttention,
  buildAttention,
  jobAttention,
  projectAttention,
} from "../attention";

/**
 * "What needs me?" has a correct answer, and these check it is given the same
 * way every time. A screen that asked a model this question would answer it
 * slightly differently on every refresh, which is exactly the property an
 * operations screen must not have — so the ordering, the wording and the
 * refusal to invent work are all pinned here.
 */

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: "job_aaaaaaaaaaaaaaaa",
    worker: "grok",
    project: "pantry-pilot",
    objective: "Implement the chef retry flow",
    status: "awaiting_review",
    createdAt: "2026-09-10T09:00:00.000Z",
    completedAt: "2026-09-10T09:20:00.000Z",
    ...overrides,
  } as WorkerJob;
}

function review(verdict: "pass" | "changes_required" | "blocked", issues = 0) {
  return {
    jobId: "job_aaaaaaaaaaaaaaaa",
    verdict,
    summary: "…",
    issues: Array.from({ length: issues }, (_, index) => ({
      severity: "major" as const,
      title: `Issue ${index}`,
      detail: "…",
    })),
    acceptanceCriteria: [],
    reviewedAt: "2026-09-10T09:25:00.000Z",
  };
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_1",
    name: "Morning Brief",
    schedule: "every day at 07:30",
    state: "active",
    enabled: true,
    warnings: [],
    ...overrides,
  } as Automation;
}

describe("what one job is asking for", () => {
  it("asks for approval once it has passed review", () => {
    const item = jobAttention(job({ review: review("pass") }));

    assert.equal(item?.type, "approval");
    assert.equal(item?.severity, "warning");
    assert.equal(item?.action.href, "/workers/jobs/job_aaaaaaaaaaaaaaaa");
  });

  it("does not ask for approval while the work is still running", () => {
    assert.equal(jobAttention(job({ status: "running" })), undefined);
    assert.equal(jobAttention(job({ status: "validating" })), undefined);
  });

  it("treats a failure as critical", () => {
    const item = jobAttention(
      job({ status: "failed", error: "Validation failed: npm run build" }),
    );

    assert.equal(item?.type, "failed");
    assert.equal(item?.severity, "critical");
    assert.match(item?.description ?? "", /npm run build/);
  });

  it("counts review findings and visual findings apart", () => {
    const item = jobAttention(
      job({
        status: "changes_required",
        review: review("changes_required", 2),
        visualVerification: {
          jobId: "job_aaaaaaaaaaaaaaaa",
          revision: 1,
          verdict: "changes_required",
          summary: "…",
          strengths: [],
          issues: [
            {
              severity: "major",
              category: "layout",
              title: "Over-framed",
              detail: "…",
            },
          ],
          criteria: [],
          screenshots: [],
          references: [],
          createdAt: "2026-09-10T09:30:00.000Z",
        },
      }),
    );

    // Named apart because they send the worker somewhere very different.
    assert.match(item?.description ?? "", /2 review findings/);
    assert.match(item?.description ?? "", /1 visual issue/);
  });

  it("sends a purely visual finding straight to the screenshots", () => {
    const item = jobAttention(
      job({
        status: "changes_required",
        visualVerification: {
          jobId: "job_aaaaaaaaaaaaaaaa",
          revision: 1,
          verdict: "changes_required",
          summary: "…",
          strengths: [],
          issues: [
            {
              severity: "major",
              category: "spacing",
              title: "Tight",
              detail: "…",
            },
          ],
          criteria: [],
          screenshots: [],
          references: [],
          createdAt: "2026-09-10T09:30:00.000Z",
        },
      }),
    );

    assert.equal(item?.action.href, "/workers/jobs/job_aaaaaaaaaaaaaaaa#visual");
    assert.equal(item?.action.label, "View visual review");
  });

  it("will not call a job approvable when it was never looked at", () => {
    // Passing a code review says nothing about what the screen looks like, and
    // "not checked" must never be able to read as "checked and fine".
    const item = jobAttention(
      job({
        review: review("pass"),
        visualAcceptance: { enabled: true, routes: [] },
      }),
    );

    assert.equal(item?.type, "review");
    assert.match(item?.description ?? "", /not been verified visually/);
  });

  it("asks for approval on a job whose visual check also passed", () => {
    const item = jobAttention(
      job({
        review: review("pass"),
        visualAcceptance: { enabled: true, routes: [] },
        visualVerification: {
          jobId: "job_aaaaaaaaaaaaaaaa",
          revision: 1,
          verdict: "pass",
          summary: "…",
          strengths: [],
          issues: [],
          criteria: [],
          screenshots: [],
          references: [],
          createdAt: "2026-09-10T09:30:00.000Z",
        },
      }),
    );

    assert.equal(item?.type, "approval");
  });

  it("says plainly when nobody has reviewed it yet", () => {
    const item = jobAttention(job());

    assert.equal(item?.type, "review");
    assert.match(item?.description ?? "", /Nobody has reviewed it yet/);
  });
});

describe("what an automation is asking for", () => {
  it("raises a failing schedule", () => {
    const item = automationAttention(
      automation({
        lastRun: { status: "failed", timestamp: "2026-09-10T07:30:00.000Z" },
      }),
    );

    assert.equal(item?.type, "automation");
    assert.equal(item?.severity, "critical");
  });

  it("says nothing about a schedule that was turned off", () => {
    // A job you disabled is a decision, not a fault, however long it is quiet.
    assert.equal(
      automationAttention(
        automation({
          state: "disabled",
          lastRun: { status: "failed", timestamp: "2026-09-10T07:30:00.000Z" },
        }),
      ),
      undefined,
    );
  });

  it("says nothing about a healthy schedule", () => {
    assert.equal(automationAttention(automation()), undefined);
  });
});

describe("what a project is asking for", () => {
  const project = (overrides: Partial<ProjectSummary> = {}): ProjectSummary =>
    ({
      slug: "pantry-pilot",
      name: "Pantry Pilot",
      state: "active",
      priority: "high",
      ...overrides,
    }) as ProjectSummary;

  it("raises a project the vault itself calls blocked", () => {
    const item = projectAttention(project({ state: "blocked" }));

    assert.equal(item?.type, "blocked");
    assert.equal(item?.action.href, "/workspaces/pantry-pilot");
  });

  it("says nothing about a project that is simply active", () => {
    assert.equal(projectAttention(project()), undefined);
  });
});

describe("the order the list is read in", () => {
  it("puts what is broken above what is merely waiting", () => {
    const items = buildAttention({
      jobs: [
        job({ id: "job_bbbbbbbbbbbbbbbb", review: review("pass") }),
        job({ id: "job_cccccccccccccccc", status: "failed" }),
        job({
          id: "job_dddddddddddddddd",
          status: "changes_required",
          review: review("changes_required", 1),
        }),
      ],
      automations: [
        automation({
          lastRun: { status: "failed", timestamp: "2026-09-10T07:30:00.000Z" },
        }),
      ],
      projects: [],
      degraded: [],
    });

    assert.deepEqual(
      items.map((item) => item.type),
      ["failed", "approval", "changes_required", "automation"],
    );
  });

  it("breaks ties on age, oldest first", () => {
    const items = buildAttention({
      jobs: [
        job({
          id: "job_eeeeeeeeeeeeeeee",
          review: review("pass"),
          completedAt: "2026-09-10T11:00:00.000Z",
        }),
        job({
          id: "job_ffffffffffffffff",
          review: review("pass"),
          completedAt: "2026-09-10T08:00:00.000Z",
        }),
      ],
      automations: [],
      projects: [],
      degraded: [],
    });

    assert.deepEqual(
      items.map((item) => item.id),
      ["job-job_ffffffffffffffff", "job-job_eeeeeeeeeeeeeeee"],
    );
  });

  it("returns nothing at all on a quiet day", () => {
    // The good state, and a real answer. Nothing here invents work to fill it.
    assert.deepEqual(
      buildAttention({
        jobs: [job({ status: "completed" }), job({ status: "running" })],
        automations: [automation()],
        projects: [],
        degraded: [],
      }),
      [],
    );
  });

  it("reports a source it could not read, at the bottom", () => {
    const items = buildAttention({
      jobs: [],
      automations: [],
      projects: [],
      degraded: [{ label: "Automations", detail: "Hermes is not configured." }],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].type, "system");
    assert.match(items[0].title, /Automations could not be read/);
  });
});

describe("repeat failures and retries", () => {
  const failed = (id: string, createdAt: string, error = "Worker exited with code 1") =>
    job({ id, status: "failed", createdAt, completedAt: createdAt, error });

  it("shows two failed attempts at the same work as one card, latest first", () => {
    const items = failedJobAttention([
      failed("job_1111111111111111", "2026-09-14T10:00:00.000Z"),
      failed("job_2222222222222222", "2026-09-16T10:00:00.000Z"),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].occurrences, 2);
    assert.equal(items[0].retry?.jobId, "job_2222222222222222");
  });

  it("drops a failure a later attempt has taken over", () => {
    const items = failedJobAttention(
      [failed("job_1111111111111111", "2026-09-14T10:00:00.000Z")],
      [job({ id: "job_3333333333333333", status: "running", createdAt: "2026-09-15T10:00:00.000Z" })],
    );
    assert.deepEqual(items, []);
  });

  it("keeps different work apart", () => {
    const items = failedJobAttention([
      failed("job_1111111111111111", "2026-09-14T10:00:00.000Z"),
      job({ id: "job_4444444444444444", status: "failed", objective: "Something else entirely", createdAt: "2026-09-14T11:00:00.000Z" }),
    ]);
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => item.occurrences === undefined));
  });

  it("recognises a usage limit as a reason to try another worker", () => {
    const [limited] = failedJobAttention([
      failed(
        "job_5555555555555555",
        "2026-09-14T10:00:00.000Z",
        "Grok exited with code 1: Error: You've reached your free Grok Build usage limit for now.",
      ),
    ]);
    assert.deepEqual(limited.retry, { jobId: "job_5555555555555555", worker: "grok", limitHit: true });

    const [broken] = failedJobAttention([failed("job_6666666666666666", "2026-09-14T10:00:00.000Z", "Tests failed")]);
    assert.equal(broken.retry?.limitHit, false);
  });
});
