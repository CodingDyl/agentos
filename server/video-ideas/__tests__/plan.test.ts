import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { closeLearningDatabase } from "../../learning/db";
import { decide, filePlan, parsePlan, planPrompt } from "../plan";
import { createIdea, getIdea, updateIdea } from "../store";

let root: string;
let studio: string;
const previousRoot = process.env.AGENTOS_ROOT;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-"));
  studio = await fs.mkdtemp(path.join(os.tmpdir(), "studio-"));
  process.env.AGENTOS_ROOT = root;
  await fs.mkdir(path.join(root, "projects", "agentos-os"), { recursive: true });
  await fs.writeFile(path.join(root, "projects", "agentos-os", "PROJECT.md"), "# AgentOS\n\n## Configuration\n\nTask prefix: FEATURE\n");
  await fs.writeFile(path.join(root, "projects", "agentos-os", "TASKS.md"), "# Tasks\n\n## Now\n\n- [ ] [FEATURE-001] Existing\n");
  await fs.mkdir(path.join(root, "knowledge", "assessments"), { recursive: true });
});

after(async () => {
  closeLearningDatabase();
  if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previousRoot;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(studio, { recursive: true, force: true });
});

const task = (n: number) => ({ title: `Task ${n}`, objective: `Do ${n} in server/x.ts`, acceptanceCriteria: [`${n} works`] });

function waiting(sourceId: string, verdict: "adopt" | "skip" = "adopt") {
  const idea = createIdea({ id: sourceId, externalId: "dQw4w9WgXcQ", title: `Idea ${sourceId}` }, "assess");
  return updateIdea(idea.id, { stage: "awaiting_decision", verdict, assessmentPath: `knowledge/assessments/${sourceId}.md` });
}

describe("deciding and planning", () => {
  it("only decides an idea that is waiting for a decision", async () => {
    const idea = createIdea({ id: "ls-p0", externalId: "dQw4w9WgXcQ", title: "Not yet" }, "assess");
    await assert.rejects(decide(idea.id, { decision: "approve" }), (error: Error & { status?: number }) => error.status === 409);
  });

  it("files a decline with its reason", async () => {
    const idea = waiting("ls-p1");
    const declined = await decide(idea.id, { decision: "decline", reason: "Not now" });
    assert.equal(declined.stage, "declined");
    assert.equal(declined.declineReason, "Not now");
  });

  it("approves even a Skip verdict: Dylan has the final say", async () => {
    const idea = waiting("ls-p2", "skip");
    let launched = "";
    const approved = await decide(idea.id, { decision: "approve" }, async (current) => {
      launched = current.id;
      return updateIdea(current.id, { stage: "planning" });
    });
    assert.equal(launched, idea.id);
    assert.equal(approved.stage, "planning");
  });

  it("refuses a plan that is too big or unreadable", () => {
    assert.deepEqual(parsePlan(JSON.stringify({ tasks: [1, 2, 3, 4, 5, 6].map(task) })), { error: "Plan too big — split it" });
    assert.deepEqual(parsePlan("{nope"), { error: "Plan could not be read" });
    assert.deepEqual(parsePlan(JSON.stringify({ tasks: [] })), { error: "Plan could not be read" });
    assert.deepEqual(parsePlan(JSON.stringify({ tasks: [task(1)] })), { tasks: [task(1)] });
  });

  it("asks for at most five self-contained tasks", () => {
    const prompt = planPrompt(waiting("ls-p3"), "ASSESSMENT");
    assert.match(prompt, /1 to 5 tasks/);
    assert.ok(prompt.includes("ASSESSMENT"));
  });

  it("turns the plan into AgentOS tasks and starts building", async () => {
    const idea = updateIdea(waiting("ls-p4").id, { stage: "planning" });
    await fs.writeFile(path.join(root, idea.assessmentPath!), "---\nverdict: adopt\n---\n# Assessment\n");
    const out = path.join(studio, "ideas", idea.id);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "plan.json"), JSON.stringify({ tasks: [task(1), task(2), task(3)] }));

    const filed = await filePlan(idea, [studio]);
    assert.equal(filed.stage, "building");
    assert.equal(filed.currentTask, 0);
    assert.equal(filed.taskIds.length, 3);
    assert.ok(filed.taskIds.every((id) => /^FEATURE-\d+$/.test(id)));
    assert.equal(filed.plan?.length, 3);

    const tasks = await fs.readFile(path.join(root, "projects", "agentos-os", "TASKS.md"), "utf8");
    assert.ok(tasks.includes("Task 2"));
    const assessment = await fs.readFile(path.join(root, idea.assessmentPath!), "utf8");
    assert.ok(assessment.includes("## Plan"));
    assert.ok(assessment.includes(`${filed.taskIds[0]} — Task 1`));
  });

  it("fails without creating tasks when the plan is too big", async () => {
    const idea = updateIdea(waiting("ls-p5").id, { stage: "planning" });
    const out = path.join(studio, "ideas", idea.id);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "plan.json"), JSON.stringify({ tasks: [1, 2, 3, 4, 5, 6].map(task) }));
    const filed = await filePlan(idea, [studio]);
    assert.equal(filed.stage, "failed");
    assert.equal(filed.failedAt, "planning");
    assert.equal(filed.error, "Plan too big — split it");
    assert.deepEqual(getIdea(idea.id)?.taskIds, []);
  });
});
