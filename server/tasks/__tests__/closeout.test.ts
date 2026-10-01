import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";
import { buildCloseout } from "../closeout";

const job = {
  id: "job_0031",
  worker: "auto",
  resolvedWorker: "claude",
  status: "completed",
  createdAt: "2026-10-01T09:00:00.000Z",
  objective: "Chef fallback",
  project: "pantry-pilot",
  result: {
    summary: [
      "Chef now falls back to internal generation when external lookup fails.",
      "Remember: pattern | Recipe fallback handling | When external lookup returns no suitable recipe, use the internal generation fallback.",
      "Remember: lesson | MealDB response | MealDB returns null meals rather than an empty array when nothing matches.",
      "Status update: Chef fallback is complete and validated. Next focus is performance and loading UX.",
    ].join("\n"),
    changedFiles: ["src/chef/fallback.ts"],
    artifacts: [{ title: "Implementation Notes", path: "artifacts/notes.md", registeredPath: "projects/pantry-pilot/tasks/PP-031/Implementation Notes.md" }],
    tests: [
      { command: "npm run build", success: true },
      { command: "npm test", success: true },
    ],
  },
} as unknown as WorkerJob;

describe("task closeout", () => {
  it("answers what changed, what was learned, and whether status should move", () => {
    const closeout = buildCloseout("pantry-pilot", "PP-031", job);
    assert.equal(closeout.summary, "Chef now falls back to internal generation when external lookup fails.");
    assert.deepEqual(closeout.changedFiles, ["src/chef/fallback.ts"]);
    assert.deepEqual(closeout.artifacts, ["projects/pantry-pilot/tasks/PP-031/Implementation Notes.md"]);
    assert.equal(closeout.worker, "claude");
    assert.deepEqual(closeout.validation?.map((entry) => entry.success), [true, true]);
    assert.match(closeout.suggestedStatusUpdate ?? "", /performance and loading UX/);

    const [pattern, lesson] = closeout.memoryProposals;
    assert.equal(pattern.type, "pattern");
    assert.equal(pattern.selected, true, "patterns are ticked by default");
    assert.equal(lesson.selected, false, "lessons are the person's call");
    assert.equal(pattern.proposedBy, "agent:claude");
    assert.equal(pattern.sourceTask, "PP-031");
    assert.equal(pattern.sourceRun, "job_0031");
    assert.equal(pattern.id, buildCloseout("pantry-pilot", "PP-031", job).memoryProposals[0].id, "stable ids");
  });

  it("closes out a job that proposed nothing without inventing memory", () => {
    const quiet = { ...job, result: { summary: "Done." } } as unknown as WorkerJob;
    const closeout = buildCloseout("pantry-pilot", "PP-032", quiet);
    assert.deepEqual(closeout.memoryProposals, []);
    assert.equal(closeout.suggestedStatusUpdate, undefined);
  });
});

describe("completing a task with its closeout", () => {
  it("ticks the task, saves only what the person kept, applies status, and refuses duplicates before writing", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { saveJob } = await import("../../workers/job-store");
    const { saveTaskLink } = await import("../../agentos/task-jobs");
    const { MemoryService } = await import("../../memory/service");
    const { CloseoutError, completeTaskWithCloseout, draftCloseout, readCloseoutRecord } = await import("../closeout");

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "closeout-"));
    const previousRoot = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_ROOT = root;
    const service = new MemoryService({ root, cacheFile: path.join(root, "..", `${path.basename(root)}-cache.json`), probeMs: 60_000, reconcileMs: 60_000 });

    try {
      const project = path.join(root, "projects/pantry-pilot");
      await fs.mkdir(path.join(project, "memory"), { recursive: true });
      await fs.writeFile(path.join(project, "PROJECT.md"), "# Pantry Pilot\n\n## Purpose\n\nRecipes.\n");
      await fs.writeFile(path.join(project, "STATUS.md"), "# Status\n\n## Current Stage\n\nChef fallback implementation underway.\n");
      await fs.writeFile(path.join(project, "TASKS.md"), "# Tasks\n\n## Active\n\n- [ ] [PP-031] Chef fallback\n");
      await fs.writeFile(
        path.join(project, "memory/Recipe fallback handling.md"),
        "---\ntype: pattern\ncreatedAt: \"2026-09-12\"\n---\n# Recipe fallback handling\n\nWhen external lookup returns no suitable recipe, use the internal generation fallback.\n",
      );
      const projectBefore = await fs.readFile(path.join(project, "PROJECT.md"), "utf8");
      await service.start();

      await saveJob({ ...job, id: "job_0031", status: "completed" } as WorkerJob);
      await saveTaskLink({ project: "pantry-pilot", taskId: "PP-031", jobId: "job_0031", delegatedAt: "2026-10-01T09:00:00.000Z" });

      const draft = await draftCloseout(service, "pantry-pilot", "PP-031");
      assert.ok(draft?.ready);
      const [pattern, lesson] = draft.proposals;
      assert.equal(pattern.duplicates[0]?.id, "projects/pantry-pilot/memory/Recipe fallback handling.md", "duplicate surfaced");
      assert.equal(lesson.duplicates.length, 0);

      // Creating the duplicate without acknowledging it stops everything.
      await assert.rejects(
        completeTaskWithCloseout(service, "pantry-pilot", "PP-031", {
          memory: [{ proposal: pattern, action: "create" }],
        }),
        (error: unknown) => error instanceof CloseoutError && error.status === 409,
      );
      assert.match(await fs.readFile(path.join(project, "TASKS.md"), "utf8"), /- \[ \] \[PP-031\]/, "task still open");

      const record = await completeTaskWithCloseout(service, "pantry-pilot", "PP-031", {
        memory: [
          { proposal: pattern, action: "update", targetId: pattern.duplicates[0].id, targetRevision: pattern.duplicates[0].revision },
          { proposal: { ...lesson, body: "MealDB returns `meals: null` when nothing matches — check for null, not length." }, action: "create" },
        ],
        statusUpdate: { body: "Chef fallback is complete and validated. Next focus is performance and loading UX.", expectedRevision: draft.currentStatus!.revision },
      });

      assert.match(await fs.readFile(path.join(project, "TASKS.md"), "utf8"), /- \[x\] \[PP-031\]/);
      assert.deepEqual(record.memoryOutcomes.map((outcome) => outcome.outcome), ["updated", "created"]);
      assert.equal(record.statusApplied, true);
      assert.match(await fs.readFile(path.join(project, "STATUS.md"), "utf8"), /Next focus is performance/);
      assert.equal(await fs.readFile(path.join(project, "PROJECT.md"), "utf8"), projectBefore, "PROJECT.md untouched");

      const lessonNote = record.memoryOutcomes[1].target!;
      const lessonText = await fs.readFile(path.join(root, lessonNote), "utf8");
      assert.match(lessonText, /createdBy: "agent:claude"/);
      assert.match(lessonText, /approvedBy: "human"/);
      assert.match(lessonText, /sourceTask: "PP-031"/);
      assert.match(lessonText, /check for null/, "the person's edit was saved");
      assert.ok(service.index.notes.has(lessonNote), "indexed");

      assert.equal((await readCloseoutRecord("pantry-pilot", "PP-031"))?.memoryOutcomes.length, 2);
    } finally {
      service.stop();
      if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
      else process.env.AGENTOS_ROOT = previousRoot;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
