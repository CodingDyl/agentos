import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getTasks } from "../markdown";
import { parseProjectTasks } from "../projects";
import {
  fallbackPlan,
  readDelegationPlan,
  buildScopingPacket,
} from "../../hermes/task-scoping";
import type { ProjectTask } from "../../../shared/agentos-types";

/**
 * Delegating a task, tested where it touches things that matter.
 *
 * Two of these carry real risk. Reading `TASKS.md` wrongly would delegate work
 * against the wrong line, and writing it wrongly would damage a file a person
 * maintains by hand. Both are exercised against a throwaway vault rather than
 * the operator's own.
 */

describe("reading tasks out of TASKS.md", () => {
  it("takes the id out of the title rather than leaving it in", () => {
    const [task] = getTasks("- [ ] [PP-014] Implement Chef retry flow");

    assert.equal(task.id, "PP-014");
    // The id is an identifier, not part of what the task says.
    assert.equal(task.title, "Implement Chef retry flow");
    assert.equal(task.completed, false);
  });

  it("reads completed tasks as well as open ones", () => {
    const tasks = getTasks(
      ["- [x] [PP-013] Chef fallback", "- [ ] [PP-014] Retry flow"].join("\n"),
    );

    // A delegated task keeps its identity after it is done. Reading only open
    // work would lose a task at the moment it mattered most.
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].completed, true);
    assert.equal(tasks[1].completed, false);
  });

  it("keeps a task that has no id, without inventing one", () => {
    const [task] = getTasks("- [ ] Improve recipe search performance");

    assert.equal(task.id, undefined);
    // Shown, but not delegatable. A minted id would name something the vault
    // cannot name back.
    assert.equal(task.title, "Improve recipe search performance");
  });

  it("does not mistake a markdown link for an id", () => {
    const [task] = getTasks("- [ ] [see the notes](./NOTES.md) and fix it");

    assert.equal(task.id, undefined);
    assert.match(task.title, /see the notes/);
  });

  it("keeps horizons apart", () => {
    const tasks = parseProjectTasks(
      [
        "# Tasks",
        "## Now",
        "- [ ] [PP-001] First",
        "## Next",
        "- [ ] [PP-002] Second",
      ].join("\n"),
    );

    assert.equal(tasks.now[0].id, "PP-001");
    assert.equal(tasks.now[0].section, "now");
    assert.equal(tasks.next[0].section, "next");
    assert.equal(tasks.later.length, 0);
  });
});

describe("scoping a task", () => {
  const task: ProjectTask & { id: string } = {
    id: "PP-014",
    title: "Implement Chef retry flow",
    section: "now",
    completed: false,
  };

  it("reads a well-formed plan", () => {
    const plan = readDelegationPlan(
      `\`\`\`json
{"objective":"Add retry to AI Chef results.",
 "contextFiles":["src/chef.tsx"],
 "constraints":["Do not change the prompt format"],
 "acceptanceCriteria":["Retry control visible"],
 "validationCommands":["npm run build"],
 "suggestedTaskType":"implementation"}
\`\`\``,
      { taskId: "PP-014", project: "pantry-pilot" },
    );

    assert.equal(plan?.objective, "Add retry to AI Chef results.");
    assert.deepEqual(plan?.validationCommands, ["npm run build"]);
    assert.equal(plan?.suggestedTaskType, "implementation");
    assert.equal(plan?.scopedBy, "hermes");
  });

  it("refuses a plan with no objective", () => {
    // Every other field can reasonably be empty. An empty objective would
    // delegate a worker to do nothing in particular.
    assert.equal(
      readDelegationPlan('{"acceptanceCriteria":["something"]}', {
        taskId: "PP-014",
        project: "pantry-pilot",
      }),
      undefined,
    );
  });

  it("invents no acceptance criteria when it falls back", () => {
    const plan = fallbackPlan({ project: "pantry-pilot", task });

    assert.equal(plan.scopedBy, "agentos");
    assert.equal(plan.objective, task.title);
    // A criterion invented here would be a standard the work is judged
    // against that nobody actually set.
    assert.deepEqual(plan.acceptanceCriteria, []);
    // And a guessed command fails the job rather than checking it.
    assert.deepEqual(plan.validationCommands, []);
  });

  it("sends the project's own documents and says what may not be contradicted", () => {
    const packet = buildScopingPacket({
      project: "pantry-pilot",
      task,
      decisionsMarkdown: "## Use Compose\nSettled in March.",
    });

    assert.match(packet, /\[PP-014\] Implement Chef retry flow/);
    assert.match(packet, /Settled in March/);
    assert.match(packet, /Respect what DECISIONS\.md has already settled/);
    // Guessing a validation command would fail the job rather than check it.
    assert.match(packet, /empty list rather than guessing/);
  });
});

describe("closing a task in TASKS.md", () => {
  let vault: string;
  let previousRoot: string | undefined;
  let completion: typeof import("../task-completion");

  const TASKS = [
    "# Pantry Pilot Tasks",
    "",
    "## Now",
    "",
    "- [ ] [PP-014] Implement Chef retry flow",
    "- [ ] [PP-015] Improve recipe loading  <!-- keep this comment -->",
    "",
    "## Rule",
    "",
    "Prefer completing existing tasks before adding features.",
    "",
  ].join("\n");

  before(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-vault-"));
    previousRoot = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_ROOT = vault;

    await fs.mkdir(path.join(vault, "projects", "pantry-pilot"), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(vault, "projects", "pantry-pilot", "TASKS.md"),
      TASKS,
      "utf8",
    );

    completion = await import("../task-completion");
  });

  after(async () => {
    if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previousRoot;

    await fs.rm(vault, { recursive: true, force: true });
  });

  const job = (status: string) =>
    ({ id: "job_1", status }) as unknown as import(
      "../../../shared/worker-types"
    ).WorkerJob;

  it("will not close a task whose work only passed review", () => {
    // The rule the whole module exists for. Passing review is evidence; being
    // in the repository is the thing.
    return completion
      .proposeCompletion("pantry-pilot", "PP-014", job("awaiting_review"))
      .then((proposal) => {
        assert.equal(proposal?.ready, false);
        assert.match(proposal?.blockedReason ?? "", /review and approval/);
      });
  });

  it("will not close a task that was approved but not integrated", async () => {
    const proposal = await completion.proposeCompletion(
      "pantry-pilot",
      "PP-014",
      job("approved"),
    );

    assert.equal(proposal?.ready, false);
    assert.match(proposal?.blockedReason ?? "", /not integrated/);
  });

  it("will not close a task that was never delegated", async () => {
    const proposal = await completion.proposeCompletion(
      "pantry-pilot",
      "PP-014",
      undefined,
    );

    assert.equal(proposal?.ready, false);
    assert.match(proposal?.blockedReason ?? "", /not been delegated/);
  });

  it("shows the exact line that would change once work is integrated", async () => {
    const proposal = await completion.proposeCompletion(
      "pantry-pilot",
      "PP-014",
      job("completed"),
    );

    assert.equal(proposal?.ready, true);
    assert.equal(proposal?.before, "- [ ] [PP-014] Implement Chef retry flow");
    assert.equal(proposal?.after, "- [x] [PP-014] Implement Chef retry flow");
  });

  it("changes one line and leaves the rest of the file alone", async () => {
    const result = await completion.applyCompletion("pantry-pilot", "PP-014");
    assert.equal(result.ok, true);

    const after = await fs.readFile(
      path.join(vault, "projects", "pantry-pilot", "TASKS.md"),
      "utf8",
    );

    assert.match(after, /- \[x\] \[PP-014\] Implement Chef retry flow/);

    // Everything a person wrote survives: the other task untouched, its
    // trailing comment intact, the prose and headings exactly as they were.
    assert.match(after, /- \[ \] \[PP-015\] Improve recipe loading {2}<!-- keep this comment -->/);
    assert.match(after, /Prefer completing existing tasks before adding features\./);

    assert.equal(
      after.split("\n").length,
      TASKS.split("\n").length,
      "closing a task must not add or remove lines",
    );
  });

  it("is safe to run twice", async () => {
    // The desired state is already the actual state, which is not an error.
    assert.deepEqual(
      await completion.applyCompletion("pantry-pilot", "PP-014"),
      { ok: true },
    );
  });

  it("refuses a task id that is not in the file", async () => {
    const result = await completion.applyCompletion("pantry-pilot", "PP-999");

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not in TASKS\.md/);
  });
});
