import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { appendEvalRun, compareToPrevious, evalHistoryFile, readEvalHistory, type EvalRun } from "../history";

const run = (passed: number, total: number, extra: Partial<EvalRun> = {}): EvalRun => ({ at: "2026-11-06T10:00:00.000Z", suite: "mail", commit: "abc1234", passed, total, ...extra });

describe("compareToPrevious", () => {
  it("is first for one run, and for none", () => {
    assert.equal(compareToPrevious([run(10, 12)]).verdict, "first");
    assert.equal(compareToPrevious([]).verdict, "first");
  });

  it("is better when the pass rate went up, worse when it went down, same when it did not move", () => {
    const better = compareToPrevious([run(10, 12), run(11, 12)]);
    assert.equal(better.verdict, "better");
    assert.match(better.line, /11\/12/);
    assert.match(better.line, /10\/12/);
    assert.equal(compareToPrevious([run(11, 12), run(10, 12)]).verdict, "worse");
    assert.equal(compareToPrevious([run(11, 12), run(11, 12)]).verdict, "same");
  });

  it("compares pass rate when the totals differ", () => {
    // 9/10 = 90% then 10/12 = 83%: fewer passed per case, so worse, though more passed in absolute terms.
    assert.equal(compareToPrevious([run(9, 10), run(10, 12)]).verdict, "worse");
    assert.equal(compareToPrevious([run(5, 10), run(7, 12)]).verdict, "better");
  });

  it("handles an empty suite without dividing by zero", () => {
    assert.equal(compareToPrevious([run(0, 0), run(3, 3)]).verdict, "better");
  });
});

describe("eval history", () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env.AGENTOS_UI_DIR;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-history-"));
    process.env.AGENTOS_UI_DIR = dir;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps only the listed fields, never prompt or response text", async () => {
    await appendEvalRun({ ...run(3, 4), prompt: "Secret mail text", response: "a reply", extra: 1 } as EvalRun);
    const stored = await fs.readFile(evalHistoryFile(), "utf8");
    assert.deepEqual(Object.keys(JSON.parse(stored.trim())).sort(), ["at", "commit", "passed", "suite", "total"]);
    assert.ok(!stored.includes("Secret mail text"));
  });

  it("reads runs oldest first, filtered by suite, and skips unreadable lines", async () => {
    await appendEvalRun(run(1, 2, { at: "2026-11-01T00:00:00.000Z" }));
    await appendEvalRun(run(2, 2, { at: "2026-11-03T00:00:00.000Z", suite: "other" }));
    await appendEvalRun(run(2, 3, { at: "2026-11-02T00:00:00.000Z" }));
    await fs.appendFile(evalHistoryFile(), "not json\n{\"at\":1}\n");
    assert.deepEqual((await readEvalHistory("mail")).map((entry) => entry.passed), [1, 2]);
    assert.equal((await readEvalHistory()).length, 3);
  });

  it("reads nothing when no eval has ever run", async () => {
    assert.deepEqual(await readEvalHistory(), []);
  });

  it("keeps every run when two finish at once", async () => {
    await Promise.all([1, 2, 3, 4].map((n) => appendEvalRun(run(n, 4))));
    assert.equal((await readEvalHistory()).length, 4);
  });
});
