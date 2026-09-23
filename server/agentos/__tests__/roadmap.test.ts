import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { ProjectMilestone } from "../../../shared/agentos-types";
import type { TaskDelegationState } from "../../../shared/delegation-types";

/**
 * Step 54: milestones, derived task status, progress and health.
 *
 * The document layer and the roadmap assembly are tested purely; the
 * mutations run against a throwaway vault like every other mutation test.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));

process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const { parseMilestoneDocument, serializeMilestoneDocument } = await import(
  "../mutations/milestone-document"
);
const {
  assignTask,
  completeMilestone,
  createMilestone,
  deleteMilestone,
  patchMilestone,
  readMilestones,
  reorderMilestones,
  setCriterion,
} = await import("../mutations/milestones");
const { createTask, readTasks, updateTask } = await import("../mutations/tasks");
const { parseTaskDocument, renderTask, splitTaskTail } = await import("../mutations/task-document");
const { assembleRoadmap, executionStatus, healthOf, getRoadmap } = await import("../roadmap");
const { findTask } = await import("../task-delegation");

const MILESTONES = `# Pantry Pilot Milestones

Where the product is going, one outcome at a time.

## Chef Experience

Id: chef-experience
Status: Active
Target: 2026-09-25
Created: 2026-09-01

Outcome:
Make the AI Chef reliable, fast and enjoyable enough for beta.

Criteria:
- [x] Fallback recipe generation
- [ ] Retry generation

Tasks:
- PP-001
- PP-002
- PP-003

A note the operator left here.

### Review

Not written yet.

## Pantry Intelligence

Status: Planned

Tasks:
- PP-004
`;

const TASKS = `# Pantry Pilot Tasks

## Now

- [x] [PP-001] Fallback generation.
- [ ] [PP-002] Retry flow · ready
- [ ] [PP-003] Loading polish · after PP-002

## Next

- [ ] [PP-004] Pantry-aware suggestions · ready · after PP-002, PP-003
- [ ] [PP-005] Something unplanned.

## Later
`;

const PORTFOLIO = `# Project Portfolio

## Projects

### Pantry Pilot
Type: Product
State: Active
Priority: High

Goal:
Ship it.
`;

function vaultFile(relative: string): string {
  return path.join(root, relative);
}

function read(relative: string): string {
  return fs.readFileSync(vaultFile(relative), "utf8");
}

beforeEach(() => {
  fs.rmSync(path.join(root, "projects"), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "projects", "pantry-pilot"), { recursive: true });
  fs.writeFileSync(vaultFile("projects/PORTFOLIO.md"), PORTFOLIO, "utf8");
  fs.writeFileSync(vaultFile("projects/pantry-pilot/TASKS.md"), TASKS, "utf8");
  fs.writeFileSync(vaultFile("projects/pantry-pilot/MILESTONES.md"), MILESTONES, "utf8");
  fs.writeFileSync(vaultFile("projects/pantry-pilot/PROJECT.md"), "# Pantry Pilot\n\n## Purpose\n\nX.\n", "utf8");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

describe("task line tail", () => {
  it("reads ready and after markers, leaving the title intact", () => {
    const tail = splitTaskTail("Loading polish · after PP-002, pp-003 · ready");

    assert.equal(tail.title, "Loading polish");
    assert.equal(tail.ready, true);
    assert.deepEqual(tail.after, ["PP-002", "PP-003"]);
  });

  it("keeps a title that merely contains a separator", () => {
    const tail = splitTaskTail("Design · build · ship");

    assert.equal(tail.title, "Design · build · ship");
    assert.equal(tail.ready, false);
  });

  it("round-trips through the document without touching untouched lines", () => {
    const document = parseTaskDocument(TASKS);
    const tasks = document.blocks.filter((block) => block.kind === "task");

    assert.equal(tasks.length, 5);
    for (const block of tasks) {
      if (block.kind === "task") assert.equal(renderTask(block), block.raw);
    }
  });
});

describe("milestone document", () => {
  it("parses fields, criteria, tasks, notes and the review", () => {
    const document = parseMilestoneDocument(MILESTONES);

    assert.equal(document.milestones.length, 2);
    const [chef, pantry] = document.milestones;

    assert.equal(chef.id, "chef-experience");
    assert.equal(chef.status, "active");
    assert.equal(chef.targetDate, "2026-09-25");
    assert.equal(chef.outcome, "Make the AI Chef reliable, fast and enjoyable enough for beta.");
    assert.deepEqual(chef.criteria, [
      { text: "Fallback recipe generation", done: true },
      { text: "Retry generation", done: false },
    ]);
    assert.deepEqual(chef.taskIds, ["PP-001", "PP-002", "PP-003"]);
    assert.deepEqual(chef.notes, ["A note the operator left here."]);
    assert.equal(chef.review, "Not written yet.");

    // No Id line: derived from the title, status defaults to planned.
    assert.equal(pantry.id, "pantry-intelligence");
    assert.equal(pantry.status, "planned");
  });

  it("round-trips without losing the preamble, notes or review", () => {
    const again = serializeMilestoneDocument(parseMilestoneDocument(MILESTONES));

    assert.match(again, /Where the product is going/);
    assert.match(again, /A note the operator left here\./);
    assert.match(again, /### Review\n\nNot written yet\./);
    assert.match(again, /Id: pantry-intelligence/);
    assert.deepEqual(parseMilestoneDocument(again).milestones, parseMilestoneDocument(MILESTONES).milestones);
  });
});

describe("milestone mutations", () => {
  it("creates with a unique slug id and demotes the previous active one", async () => {
    const { revision } = await readMilestones("pantry-pilot");

    const created = await createMilestone("pantry-pilot", {
      title: "Chef Experience",
      status: "active",
      criteria: ["Beta testers complete the flow"],
      expectedRevision: revision,
    });

    assert.equal(created.milestoneId, "chef-experience-2");

    const { milestones } = await readMilestones("pantry-pilot");
    assert.equal(milestones.find((entry) => entry.id === "chef-experience")?.status, "planned");
    assert.equal(milestones.find((entry) => entry.id === "chef-experience-2")?.status, "active");
    assert.match(read("projects/pantry-pilot/MILESTONES.md"), /Created: \d{4}-\d{2}-\d{2}/);
  });

  it("patches fields and keeps the id on rename", async () => {
    await patchMilestone("pantry-pilot", "chef-experience", {
      title: "Chef Experience v2",
      targetDate: "",
      outcome: "New outcome.",
    });

    const { milestones } = await readMilestones("pantry-pilot");
    const chef = milestones[0];

    assert.equal(chef.id, "chef-experience");
    assert.equal(chef.title, "Chef Experience v2");
    assert.equal(chef.targetDate, undefined);
    assert.equal(chef.outcome, "New outcome.");
  });

  it("reorders, completes with a review, and ticks criteria", async () => {
    await reorderMilestones("pantry-pilot", ["pantry-intelligence"]);
    await setCriterion("pantry-pilot", "chef-experience", 1, true);
    await completeMilestone("pantry-pilot", "chef-experience", { review: "What shipped: everything." });

    const { milestones } = await readMilestones("pantry-pilot");

    assert.deepEqual(milestones.map((entry) => entry.id), ["pantry-intelligence", "chef-experience"]);
    const chef = milestones[1];
    assert.equal(chef.status, "completed");
    assert.ok(chef.completedAt);
    assert.equal(chef.review, "What shipped: everything.");
    assert.equal(chef.criteria[1].done, true);
  });

  it("assigns a task to exactly one milestone", async () => {
    await assignTask("pantry-pilot", "PP-001", "pantry-intelligence");

    const { milestones } = await readMilestones("pantry-pilot");
    assert.deepEqual(milestones[0].taskIds, ["PP-002", "PP-003"]);
    assert.deepEqual(milestones[1].taskIds, ["PP-004", "PP-001"]);

    await assignTask("pantry-pilot", "PP-001", undefined);
    const after = await readMilestones("pantry-pilot");
    assert.deepEqual(after.milestones[1].taskIds, ["PP-004"]);
  });

  it("refuses to delete a milestone with history", async () => {
    await assert.rejects(deleteMilestone("pantry-pilot", "chef-experience"), /Archive it/);

    const created = await createMilestone("pantry-pilot", { title: "Scratch" });
    await deleteMilestone("pantry-pilot", created.milestoneId);

    const { milestones } = await readMilestones("pantry-pilot");
    assert.equal(milestones.some((entry) => entry.id === "scratch"), false);
  });
});

describe("task ready and dependencies", () => {
  it("writes and clears the markers through updateTask", async () => {
    await updateTask({ slug: "pantry-pilot", taskId: "PP-005", ready: true, after: ["PP-001", "PP-005"] });

    let file = read("projects/pantry-pilot/TASKS.md");
    assert.match(file, /\[PP-005\] Something unplanned\. · ready · after PP-001/);

    await updateTask({ slug: "pantry-pilot", taskId: "PP-005", ready: false, after: [] });
    file = read("projects/pantry-pilot/TASKS.md");
    assert.match(file, /\[PP-005\] Something unplanned\.\n/);

    const { tasks } = await readTasks("pantry-pilot");
    assert.equal(tasks.find((task) => task.id === "PP-003")?.after?.[0], "PP-002");
  });

  it("new tasks carry no tail", async () => {
    const { taskId } = await createTask({ slug: "pantry-pilot", title: "Plain" });
    assert.match(read("projects/pantry-pilot/TASKS.md"), new RegExp(`\\[${taskId}\\] Plain\\n`));
  });
});

describe("execution status", () => {
  const open = new Set(["PP-002", "PP-003"]);

  it("derives done, blocked, review, in progress, ready and backlog in that order", () => {
    assert.equal(executionStatus({ title: "", completed: true }, open, undefined).status, "done");
    assert.deepEqual(executionStatus({ title: "", completed: false, after: ["PP-002", "PP-009"] }, open, undefined), {
      status: "blocked",
      blockedBy: ["PP-002"],
    });

    const review: TaskDelegationState = { taskId: "PP-003", jobId: "j", project: "p", delegatedAt: "", status: "awaiting_review", active: true };
    assert.equal(executionStatus({ title: "", completed: false, ready: true }, open, review).status, "review");

    const running: TaskDelegationState = { ...review, status: "running" };
    assert.equal(executionStatus({ title: "", completed: false }, open, running).status, "in_progress");

    assert.equal(executionStatus({ title: "", completed: false, ready: true }, open, undefined).status, "ready");
    assert.equal(executionStatus({ title: "", completed: false }, open, undefined).status, "backlog");
  });
});

describe("roadmap assembly and health", () => {
  const milestones: ProjectMilestone[] = [
    {
      id: "chef",
      project: "pantry-pilot",
      title: "Chef",
      status: "active",
      targetDate: "2026-09-25",
      criteria: [{ text: "a", done: true }, { text: "b", done: false }],
      taskIds: ["PP-001", "PP-002", "PP-003"],
    },
  ];

  const tasks = [
    { id: "PP-001", title: "a", completed: true, section: "now" },
    { id: "PP-002", title: "b", completed: false, section: "now", ready: true },
    { id: "PP-003", title: "c", completed: false, section: "now", after: ["PP-002"] },
    { id: "PP-005", title: "loose", completed: false, section: "next" },
  ];

  it("computes progress, unplanned and blocked health", () => {
    const roadmap = assembleRoadmap({
      project: "pantry-pilot",
      revision: "r1",
      tasksRevision: "r2",
      tasks,
      milestones,
      delegations: [],
      now: new Date("2026-09-14T09:00:00"),
    });

    const chef = roadmap.milestones[0];
    assert.deepEqual(chef.progress, {
      total: 3,
      completed: 1,
      percent: 33,
      criteriaTotal: 2,
      criteriaDone: 1,
      daysToTarget: 11,
    });
    assert.equal(chef.tasks.find((task) => task.id === "PP-003")?.status, "blocked");
    assert.deepEqual(roadmap.unplanned.map((task) => task.id), ["PP-005"]);
    assert.equal(roadmap.health, "blocked");
    assert.match(roadmap.healthReason, /PP-003/);
  });

  it("is at risk close to a target with little done, on track otherwise, no_target without a date", () => {
    const withoutBlock = tasks.map((task) => ({ ...task, after: undefined }));

    const soon = assembleRoadmap({
      project: "p", revision: "", tasksRevision: "", tasks: withoutBlock, milestones, delegations: [],
      now: new Date("2026-09-14T09:00:00"),
    });
    assert.equal(soon.health, "at_risk");

    const far = assembleRoadmap({
      project: "p", revision: "", tasksRevision: "", tasks: withoutBlock, milestones, delegations: [],
      now: new Date("2026-08-01T09:00:00"),
    });
    assert.equal(far.health, "on_track");

    const undated = assembleRoadmap({
      project: "p", revision: "", tasksRevision: "", tasks: withoutBlock,
      milestones: [{ ...milestones[0], targetDate: undefined }], delegations: [],
    });
    assert.equal(undated.health, "no_target");

    assert.equal(healthOf([], []).health, "no_target");
  });

  it("reads the real files end to end", async () => {
    const roadmap = await getRoadmap("pantry-pilot");

    assert.equal(roadmap.milestones[0].progress.total, 3);
    assert.equal(roadmap.milestones[0].progress.completed, 1);
    assert.equal(roadmap.milestones[1].tasks[0].status, "blocked");
    assert.deepEqual(roadmap.unplanned.map((task) => task.id), ["PP-005"]);
  });
});

describe("delegation guard", () => {
  it("refuses a blocked task", async () => {
    const result = await findTask("pantry-pilot", "PP-003");
    assert.match(result.error ?? "", /blocked by PP-002/);

    const ready = await findTask("pantry-pilot", "PP-002");
    assert.equal(ready.task?.id, "PP-002");
  });
});
