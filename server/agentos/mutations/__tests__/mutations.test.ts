import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

/**
 * The whole mutation chain, against a throwaway vault.
 *
 * Deliberately an integration test rather than a unit one. The properties worth
 * proving here are about files — that a conflicting write is refused, that a
 * backup exists afterwards, that an id is never handed out twice — and none of
 * those survive being mocked.
 *
 * The vault below is a copy of the shapes a real one has, including the prose
 * and the trailing section that a careless serializer would eat.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));

process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const { createTask, updateTask, completeTask, deleteTask, reorderTasks, readTasks } =
  await import("../tasks");
const { createProject, patchProject, archiveProject } = await import("../projects");
const { writeDecision, readDecisions, deleteDecision } = await import("../decisions");
const { readStatus, writeStatus } = await import("../status");
const { listBackups, restoreBackup, readForEdit } = await import("../writer");
const { RevisionConflictError } = await import("../revision");

const TASKS = `# Pantry Pilot Tasks

## Now

- [ ] [PP-001] First task.
- [ ] [PP-002] Second task.

## Later

Only move items here once current work is stable.

## Rule

Prefer completing existing tasks before adding additional features.
`;

const PORTFOLIO = `# Project Portfolio

## Projects

### Pantry Pilot
Type: Product
State: Active
Priority: High

Goal:
Build Pantry Pilot into a polished production-ready consumer application.

## Rules

- Do not treat every project as active work.
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
  fs.writeFileSync(
    vaultFile("projects/pantry-pilot/STATUS.md"),
    "# Pantry Pilot Status\n\n## Current Stage\n\nActive development.\n",
    "utf8",
  );
  fs.writeFileSync(
    vaultFile("projects/pantry-pilot/DECISIONS.md"),
    "# Decisions\n\nNo confirmed decisions recorded yet.\n",
    "utf8",
  );
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

describe("task mutations", () => {
  it("creates a task with the project's own prefix", async () => {
    const { taskId } = await createTask({
      slug: "pantry-pilot",
      title: "Improve recipe diversity",
    });

    // The prefix comes from the file's existing ids, never from the slug.
    assert.match(taskId, /^PP-\d{3,}$/);
    assert.ok(
      read("projects/pantry-pilot/TASKS.md").includes(
        `- [ ] [${taskId}] Improve recipe diversity`,
      ),
    );
  });

  it("keeps the operator's prose intact through a full edit cycle", async () => {
    await createTask({ slug: "pantry-pilot", title: "New work", section: "later" });
    await completeTask({ slug: "pantry-pilot", taskId: "PP-001" });
    await updateTask({ slug: "pantry-pilot", taskId: "PP-002", title: "Renamed" });

    const after = read("projects/pantry-pilot/TASKS.md");

    assert.ok(after.includes("Only move items here once current work is stable."));
    assert.ok(after.includes("## Rule"));
    assert.ok(after.includes("Prefer completing existing tasks before adding additional features."));
    assert.ok(after.includes("- [x] [PP-001] First task."));
    assert.ok(after.includes("- [ ] [PP-002] Renamed"));
  });

  it("moves a completed task into Done", async () => {
    await completeTask({ slug: "pantry-pilot", taskId: "PP-001" });

    const after = read("projects/pantry-pilot/TASKS.md");

    assert.ok(after.includes("## Done"));
    assert.ok(after.indexOf("## Done") < after.indexOf("## Rule"));
    assert.ok(after.indexOf("[PP-001]") > after.indexOf("## Done"));
  });

  it("never reuses the id of a deleted task", async () => {
    const first = await createTask({ slug: "pantry-pilot", title: "Doomed" });

    await deleteTask({ slug: "pantry-pilot", taskId: first.taskId });

    const second = await createTask({ slug: "pantry-pilot", title: "Next one" });

    // The whole point: the first id is spent, even though nothing in the file
    // uses it any more. The mark is durable enough to survive the file being
    // replaced wholesale, which is why these are compared rather than asserted
    // against literals.
    assert.notEqual(second.taskId, first.taskId);
    assert.ok(
      Number.parseInt(second.taskId.split("-")[1], 10) >
        Number.parseInt(first.taskId.split("-")[1], 10),
    );
  });

  it("reorders within a section", async () => {
    await reorderTasks({
      slug: "pantry-pilot",
      section: "now",
      taskIds: ["PP-002", "PP-001"],
    });

    const after = read("projects/pantry-pilot/TASKS.md");

    assert.ok(after.indexOf("[PP-002]") < after.indexOf("[PP-001]"));
  });

  it("reads tasks back with the section they are in", async () => {
    const { tasks } = await readTasks("pantry-pilot");

    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].section, "now");
  });

  it("refuses a path that is not a project slug", async () => {
    await assert.rejects(
      () => createTask({ slug: "../../etc", title: "nope" }),
      /Invalid project/,
    );
  });
});

describe("conflict detection", () => {
  it("refuses a write composed against a stale revision", async () => {
    const { revision } = await readForEdit("projects/pantry-pilot/TASKS.md");

    // Something else — an editor, or Hermes — changes the file underneath.
    fs.writeFileSync(
      vaultFile("projects/pantry-pilot/TASKS.md"),
      `${TASKS}\n- [ ] [PP-009] Added elsewhere.\n`,
      "utf8",
    );

    await assert.rejects(
      () =>
        updateTask({
          slug: "pantry-pilot",
          taskId: "PP-001",
          title: "Renamed",
          expectedRevision: revision,
        }),
      (error: unknown) => error instanceof RevisionConflictError,
    );

    // And the other writer's change is still there, unharmed.
    assert.ok(read("projects/pantry-pilot/TASKS.md").includes("[PP-009]"));
  });

  it("accepts a write composed against the current revision", async () => {
    const { revision } = await readForEdit("projects/pantry-pilot/TASKS.md");

    await updateTask({
      slug: "pantry-pilot",
      taskId: "PP-001",
      title: "Renamed",
      expectedRevision: revision,
    });

    assert.ok(read("projects/pantry-pilot/TASKS.md").includes("[PP-001] Renamed"));
  });
});

describe("undo", () => {
  it("restores what an edit replaced", async () => {
    const before = read("projects/pantry-pilot/TASKS.md");

    const { undoId } = await completeTask({ slug: "pantry-pilot", taskId: "PP-001" });

    assert.ok(undoId, "an edit should leave something to undo");
    assert.notEqual(read("projects/pantry-pilot/TASKS.md"), before);

    await restoreBackup(undoId);

    assert.equal(read("projects/pantry-pilot/TASKS.md"), before);
  });

  it("lists recent edits newest first", async () => {
    await completeTask({ slug: "pantry-pilot", taskId: "PP-001" });
    await createTask({ slug: "pantry-pilot", title: "Another" });

    const backups = await listBackups(5);

    assert.ok(backups.length >= 2);
    assert.equal(backups[0].label, "task.create");
  });
});

describe("project mutations", () => {
  it("creates the directory, the four files and the portfolio entry", async () => {
    const { slug } = await createProject({
      name: "Pantry Pilot Web",
      goal: "Build and launch the website.",
      state: "active",
      priority: "high",
      repoPath: "~/Developer/pantry-pilot-web",
    });

    assert.equal(slug, "pantry-pilot-web");

    for (const file of ["PROJECT.md", "STATUS.md", "TASKS.md", "DECISIONS.md"]) {
      assert.ok(
        fs.existsSync(vaultFile(`projects/${slug}/${file}`)),
        `${file} should exist`,
      );
    }

    const portfolio = read("projects/PORTFOLIO.md");

    assert.ok(portfolio.includes("### Pantry Pilot Web"));
    assert.ok(portfolio.includes("State: Active"));
    // Filed under Projects, not after the operator's own Rules section.
    assert.ok(portfolio.indexOf("### Pantry Pilot Web") < portfolio.indexOf("## Rules"));
    assert.ok(portfolio.includes("- Do not treat every project as active work."));
  });

  it("refuses a slug that already exists", async () => {
    await assert.rejects(
      () => createProject({ name: "Pantry Pilot" }),
      /already exists/,
    );
  });

  it("changes state without touching the rest of the portfolio", async () => {
    await patchProject({ slug: "pantry-pilot", state: "paused", priority: "low" });

    const portfolio = read("projects/PORTFOLIO.md");

    assert.ok(portfolio.includes("State: Paused"));
    assert.ok(portfolio.includes("Priority: Low"));
    assert.ok(portfolio.includes("Type: Product"));
    assert.ok(portfolio.includes("Build Pantry Pilot into a polished"));
    assert.ok(portfolio.includes("## Rules"));
  });

  it("rewrites the goal in place", async () => {
    await patchProject({ slug: "pantry-pilot", goal: "Ship version two." });

    const portfolio = read("projects/PORTFOLIO.md");

    assert.ok(portfolio.includes("Ship version two."));
    assert.ok(!portfolio.includes("polished production-ready"));
    assert.ok(portfolio.includes("State: Active"));
  });

  it("archives without removing anything", async () => {
    await archiveProject("pantry-pilot");

    assert.ok(read("projects/PORTFOLIO.md").includes("State: Archived"));
    // The files are all still there — archiving is a state, not a deletion.
    assert.ok(fs.existsSync(vaultFile("projects/pantry-pilot/TASKS.md")));
  });
});

describe("decisions", () => {
  it("replaces the placeholder with the first real decision", async () => {
    await writeDecision({
      slug: "pantry-pilot",
      title: "Worker routing",
      body: "Use Grok as the implementation worker.",
      decidedOn: "2026-09-11",
    });

    const file = read("projects/pantry-pilot/DECISIONS.md");

    assert.ok(!file.includes("No confirmed decisions recorded yet."));
    assert.ok(file.includes("## Worker routing"));
    assert.ok(file.includes("Decided: 2026-09-11"));
  });

  it("revises a decision rather than duplicating it", async () => {
    await writeDecision({ slug: "pantry-pilot", title: "Worker routing", body: "Use Grok." });
    await writeDecision({ slug: "pantry-pilot", title: "Worker routing", body: "Use Claude." });

    const { decisions } = await readDecisions("pantry-pilot");

    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].body, "Use Claude.");
  });

  it("removes one without disturbing its neighbours", async () => {
    await writeDecision({ slug: "pantry-pilot", title: "One", body: "First." });
    await writeDecision({ slug: "pantry-pilot", title: "Two", body: "Second." });

    await deleteDecision({ slug: "pantry-pilot", title: "One" });

    const { decisions } = await readDecisions("pantry-pilot");

    assert.deepEqual(decisions.map((decision) => decision.title), ["Two"]);
  });
});

describe("status prose", () => {
  it("edits the heading the project actually uses", async () => {
    const before = await readStatus("pantry-pilot");

    assert.equal(before.heading, "Current Stage");

    await writeStatus({ slug: "pantry-pilot", body: "Beta testing." });

    const after = read("projects/pantry-pilot/STATUS.md");

    assert.ok(after.includes("## Current Stage"));
    assert.ok(after.includes("Beta testing."));
    assert.ok(after.includes("# Pantry Pilot Status"));
  });
});
