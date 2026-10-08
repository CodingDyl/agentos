import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

/**
 * Step 53's additions to the mutation layer: project configuration, task
 * archiving, bulk edits, and create-from-plan. Same throwaway-vault approach
 * as `mutations.test.ts`, for the same reason — these are claims about files.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));

process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const {
  applyConfiguration,
  mergeConfiguration,
  parseConfiguration,
  renderConfiguration,
} = await import("../configuration");
const { archiveTask, bulkTasks, createTask, readTasks, restoreTask } = await import(
  "../tasks"
);
const { applyRepositoryPath, createProject, patchProject } = await import("../projects");
const { readForEdit } = await import("../writer");
const { RevisionConflictError } = await import("../revision");
const { getProjectDetail } = await import("../../projects");

const PROJECT = `# Pantry Pilot

## Purpose

Make meal planning easier.

## Connected Systems

- Local repository: ~/Developer/pantry-pilot
- Supabase project: pantry-prod

## Configuration

Task prefix: PP
Default branch: main
Worker preference: Claude
Visual verification: ui-tasks
Validation:
- npm test
- \`npm run lint\`

## Notes

Keep this file short.
`;

const TASKS = `# Pantry Pilot Tasks

## Now

- [ ] [PP-001] First task.
- [ ] [PP-002] Second task.

## Next

- [ ] [PP-003] Third task.

## Done

- [x] [PP-000] Finished task.

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
  fs.writeFileSync(vaultFile("projects/pantry-pilot/PROJECT.md"), PROJECT, "utf8");
  fs.writeFileSync(
    vaultFile("projects/pantry-pilot/STATUS.md"),
    "# Pantry Pilot Status\n\n## Current Stage\n\nActive development.\n",
    "utf8",
  );
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

describe("project configuration", () => {
  it("round-trips every registered worker preference", async () => {
    const { WorkerPreferenceSchema } = await import("../../../../shared/agentos-types");
    for (const workerPreference of WorkerPreferenceSchema.options) {
      const config = mergeConfiguration(parseConfiguration("# Project\n"), { workerPreference });
      const document = applyConfiguration("# Project\n", config);
      assert.equal(parseConfiguration(document).workerPreference, workerPreference);
    }
  });

  it("reads the section, tolerating case and backticks", () => {
    const config = parseConfiguration(PROJECT);

    assert.equal(config.taskPrefix, "PP");
    assert.equal(config.defaultBranch, "main");
    assert.equal(config.workerPreference, "claude");
    assert.equal(config.visualVerification, "ui-tasks");
    assert.deepEqual(config.validationCommands, ["npm test", "npm run lint"]);
    assert.equal(config.designBoard, undefined);
  });

  it("falls back to defaults for a file without the section", () => {
    const config = parseConfiguration("# Thing\n\n## Purpose\n\nStuff.\n");

    assert.equal(config.workerPreference, "auto");
    assert.equal(config.visualVerification, "ui-tasks");
    assert.deepEqual(config.validationCommands, []);
    assert.equal(config.taskPrefix, undefined);
  });

  it("ignores prose after the validation list and unknown fields", () => {
    const config = parseConfiguration(
      "# T\n\n## Configuration\n\nColour: blue\nValidation:\n- npm test\n\nRemember to run these first.\n- not a command\n",
    );

    assert.deepEqual(config.validationCommands, ["npm test"]);
  });

  it("round-trips through render and parse", () => {
    const config = parseConfiguration(PROJECT);
    const again = parseConfiguration(`# X\n\n## Configuration\n\n${renderConfiguration(config)}\n`);

    assert.deepEqual(again, config);
  });

  it("replaces only the configuration section when applying", () => {
    const next = applyConfiguration(
      PROJECT,
      mergeConfiguration(parseConfiguration(PROJECT), {
        validationCommands: ["npm run build"],
        designBoard: "Chef Board",
      }),
    );

    assert.match(next, /## Purpose\n\nMake meal planning easier\./);
    assert.match(next, /- Supabase project: pantry-prod/);
    assert.match(next, /## Notes\n\nKeep this file short\./);
    assert.match(next, /Design board: Chef Board/);
    assert.match(next, /Validation:\n- npm run build\n/);
    assert.doesNotMatch(next, /npm test/);
  });

  it("does not add a section of defaults to a file that had none", () => {
    const plain = "# Thing\n\n## Purpose\n\nStuff.\n";

    assert.equal(applyConfiguration(plain, parseConfiguration(plain)), plain);
  });

  it("clears a field when the patch sends an empty string", () => {
    const merged = mergeConfiguration(parseConfiguration(PROJECT), { defaultBranch: "" });

    assert.equal(merged.defaultBranch, undefined);
  });

  it("links a Vercel project and round-trips it", () => {
    const merged = mergeConfiguration(parseConfiguration(PROJECT), {
      vercelProjectId: "prj_abc123",
      vercelProjectName: "Pantry Pilot",
    });
    const next = applyConfiguration(PROJECT, merged);

    assert.match(next, /Vercel project: prj_abc123/);
    assert.match(next, /Vercel project name: Pantry Pilot/);
    assert.deepEqual(parseConfiguration(next), merged);
  });

  it("merges localPath without wiping other configuration fields", () => {
    const baseConfig = parseConfiguration(PROJECT);
    assert.equal(baseConfig.taskPrefix, "PP");
    assert.equal(baseConfig.defaultBranch, "main");
    assert.equal(baseConfig.workerPreference, "claude");
    
    const merged = mergeConfiguration(baseConfig, {
      localPath: "~/AgentOS/coder/pantry-pilot",
    });
    
    assert.equal(merged.localPath, "~/AgentOS/coder/pantry-pilot");
    assert.equal(merged.taskPrefix, "PP", "taskPrefix should be preserved");
    assert.equal(merged.defaultBranch, "main", "defaultBranch should be preserved");
    assert.equal(merged.workerPreference, "claude", "workerPreference should be preserved");
    assert.equal(merged.visualVerification, "ui-tasks", "visualVerification should be preserved");
    assert.deepEqual(merged.validationCommands, ["npm test", "npm run lint"], "validationCommands should be preserved");
  });

  it("updates localPath without creating other fields", () => {
    const minimal = parseConfiguration("# Project\n");
    const merged = mergeConfiguration(minimal, {
      localPath: "~/code/project",
    });
    
    assert.equal(merged.localPath, "~/code/project");
    assert.equal(merged.taskPrefix, undefined, "taskPrefix should remain undefined");
    assert.equal(merged.defaultBranch, undefined, "defaultBranch should remain undefined");
  });
});

describe("repository path", () => {
  it("rewrites the existing line in place", () => {
    const next = applyRepositoryPath(PROJECT, "~/dev/pp");

    assert.match(next, /- Local repository: ~\/dev\/pp\n- Supabase project: pantry-prod/);
  });

  it("adds the section when the file has none", () => {
    const next = applyRepositoryPath("# T\n\n## Purpose\n\nStuff.\n", "~/dev/pp");

    assert.match(next, /## Connected Systems\n\n- Local repository: ~\/dev\/pp/);
  });
});

describe("patchProject across two files", () => {
  it("edits PROJECT.md for configuration and leaves the portfolio alone", async () => {
    const before = read("projects/PORTFOLIO.md");
    const { revision } = await readForEdit("projects/pantry-pilot/PROJECT.md");

    const result = await patchProject({
      slug: "pantry-pilot",
      configuration: { workerPreference: "grok" },
      expectedRevisions: { project: revision },
    });

    assert.equal(result.portfolio, undefined);
    assert.ok(result.project?.revision);
    assert.equal(read("projects/PORTFOLIO.md"), before);
    assert.match(read("projects/pantry-pilot/PROJECT.md"), /Worker preference: grok/);
  });

  it("checks PROJECT.md against its own revision", async () => {
    await assert.rejects(
      patchProject({
        slug: "pantry-pilot",
        repoPath: "~/elsewhere",
        expectedRevisions: { project: "sha256:stale" },
      }),
      RevisionConflictError,
    );
  });

  it("edits both files when both kinds of field change", async () => {
    const result = await patchProject({
      slug: "pantry-pilot",
      priority: "low",
      repoPath: "~/elsewhere",
    });

    assert.ok(result.portfolio?.revision);
    assert.ok(result.project?.revision);
    assert.match(read("projects/PORTFOLIO.md"), /Priority: Low/);
    assert.match(read("projects/pantry-pilot/PROJECT.md"), /Local repository: ~\/elsewhere/);
  });

  it("exposes configuration and purpose on the project detail", async () => {
    const detail = await getProjectDetail("pantry-pilot");

    assert.ok(detail);
    assert.equal(detail.configuration.taskPrefix, "PP");
    assert.equal(detail.purpose, "Make meal planning easier.");
    assert.equal(detail.archivedTaskCount, 0);
  });
});

describe("task prefix preference", () => {
  it("mints new ids with the configured prefix, leaving old ids alone", async () => {
    await patchProject({ slug: "pantry-pilot", configuration: { taskPrefix: "PANT" } });

    const { taskId } = await createTask({ slug: "pantry-pilot", title: "New one" });

    assert.equal(taskId, "PANT-001");
    assert.match(read("projects/pantry-pilot/TASKS.md"), /\[PP-001\] First task/);
  });
});

describe("archiving tasks", () => {
  it("moves a task to an Archived section that it creates", async () => {
    await archiveTask({ slug: "pantry-pilot", taskId: "PP-002" });

    const file = read("projects/pantry-pilot/TASKS.md");

    assert.match(file, /## Archived\n\n- \[ \] \[PP-002\] Second task\./);
    assert.doesNotMatch(file, /## Now\n\n- \[ \] \[PP-001\] First task\.\n- \[ \] \[PP-002\]/);
    // The operator's own trailing section survives, and Archived sits before it
    // only if it was created after Done — either way Rule is intact.
    assert.match(file, /## Rule\n\nPrefer completing/);

    const { tasks } = await readTasks("pantry-pilot");
    assert.equal(tasks.find((task) => task.id === "PP-002")?.section, "archived");

    const detail = await getProjectDetail("pantry-pilot");
    assert.equal(detail?.archivedTaskCount, 1);
    assert.equal(detail?.tasks.now.length, 1);
  });

  it("restores to Later, reopened", async () => {
    await archiveTask({ slug: "pantry-pilot", taskId: "PP-000" });
    await restoreTask({ slug: "pantry-pilot", taskId: "PP-000" });

    const { tasks } = await readTasks("pantry-pilot");
    const restored = tasks.find((task) => task.id === "PP-000");

    assert.equal(restored?.section, "later");
    assert.equal(restored?.completed, false);
  });

  it("refuses to restore into Archived", async () => {
    await assert.rejects(
      restoreTask({ slug: "pantry-pilot", taskId: "PP-001", section: "archived" }),
      /not a restore/,
    );
  });
});

describe("bulk task actions", () => {
  it("completes several tasks in one write with one undo", async () => {
    const { revision } = await readTasks("pantry-pilot");

    const result = await bulkTasks("pantry-pilot", {
      taskIds: ["PP-001", "PP-003"],
      action: "complete",
      expectedRevision: revision,
    });

    assert.deepEqual(result.applied, ["PP-001", "PP-003"]);
    assert.ok(result.undoId);

    const { tasks } = await readTasks("pantry-pilot");
    for (const id of ["PP-001", "PP-003"]) {
      const task = tasks.find((entry) => entry.id === id);
      assert.equal(task?.completed, true);
      assert.equal(task?.section, "done");
    }
  });

  it("moves tasks and reopens ones that were done", async () => {
    const result = await bulkTasks("pantry-pilot", {
      taskIds: ["PP-000", "PP-003"],
      action: "move",
      section: "now",
    });

    assert.deepEqual(result.applied, ["PP-000", "PP-003"]);

    const { tasks } = await readTasks("pantry-pilot");
    const reopened = tasks.find((entry) => entry.id === "PP-000");

    assert.equal(reopened?.section, "now");
    assert.equal(reopened?.completed, false);
  });

  it("reports missing ids without failing the rest", async () => {
    const result = await bulkTasks("pantry-pilot", {
      taskIds: ["PP-001", "PP-999"],
      action: "archive",
    });

    assert.deepEqual(result.applied, ["PP-001"]);
    assert.deepEqual(result.missing, ["PP-999"]);
  });

  it("needs a section to move", async () => {
    await assert.rejects(
      bulkTasks("pantry-pilot", { taskIds: ["PP-001"], action: "move" }),
      /needs a section/,
    );
  });

  it("refuses a stale revision", async () => {
    await assert.rejects(
      bulkTasks("pantry-pilot", {
        taskIds: ["PP-001"],
        action: "complete",
        expectedRevision: "sha256:stale",
      }),
      RevisionConflictError,
    );
  });
});

describe("creating a project from a plan", () => {
  it("writes configuration, seeded tasks and decisions", async () => {
    const created = await createProject({
      name: "Listing Writer",
      goal: "Generate property listing copy.",
      state: "incubating",
      configuration: { validationCommands: ["npm test"], workerPreference: "claude" },
      tasks: [
        { title: "Set up repo", section: "now" },
        { title: "Draft prompt", section: "next" },
      ],
      decisions: [{ title: "Stack", body: "Next.js and Supabase." }],
    });

    assert.equal(created.slug, "listing-writer");

    const project = read("projects/listing-writer/PROJECT.md");
    assert.match(project, /## Configuration\n\nWorker preference: claude/);
    assert.match(project, /Validation:\n- npm test/);

    const tasks = read("projects/listing-writer/TASKS.md");
    assert.match(tasks, /## Now\n\n- \[ \] \[LW-001\] Set up repo/);
    assert.match(tasks, /## Next\n\n- \[ \] \[LW-002\] Draft prompt/);

    assert.match(read("projects/listing-writer/DECISIONS.md"), /## Stack\n[\s\S]*Next\.js and Supabase\./);
  });

  it("omits the configuration section when nothing was configured", async () => {
    await createProject({ name: "Plain Thing" });

    assert.doesNotMatch(read("projects/plain-thing/PROJECT.md"), /## Configuration/);
  });
});
