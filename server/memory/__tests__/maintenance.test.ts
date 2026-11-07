import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { applyDailyLogArchive, planDailyLogArchive } from "../maintenance";

const now = new Date("2026-11-06T12:00:00Z");

describe("daily log archive", () => {
  let parent: string;
  let root: string;
  const daily = () => path.join(root, "logs/daily");
  const write = async (name: string, body = "log\n") => fs.writeFile(path.join(daily(), name), body);

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "memory-maintenance-"));
    root = path.join(parent, "vault");
    await fs.mkdir(daily(), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  it("plans a log 31 days old into archive/logs/daily/YYYY-MM/, and leaves a 29 day old one", async () => {
    await write("2026-10-06.md");
    await write("2026-10-08.md");
    const plan = await planDailyLogArchive(root, now);
    assert.deepEqual(plan.moves, [{ from: "logs/daily/2026-10-06.md", to: "archive/logs/daily/2026-10/2026-10-06.md" }]);
  });

  it("matches dated names with a suffix, and skips sidecars and undated names", async () => {
    await write("2026-09-01-standup.md");
    await write("._2026-09-02.md");
    await write("notes.md");
    const plan = await planDailyLogArchive(root, now);
    assert.deepEqual(plan.moves.map((move) => move.from), ["logs/daily/2026-09-01-standup.md"]);
    assert.deepEqual(plan.skipped.map((entry) => entry.file).sort(), ["._2026-09-02.md", "notes.md"]);
  });

  it("never overwrites an existing destination", async () => {
    await write("2026-09-01.md", "new\n");
    await fs.mkdir(path.join(root, "archive/logs/daily/2026-09"), { recursive: true });
    await fs.writeFile(path.join(root, "archive/logs/daily/2026-09/2026-09-01.md"), "kept\n");
    const plan = await planDailyLogArchive(root, now);
    assert.equal(plan.moves.length, 0);
    assert.match(plan.skipped[0].reason, /already/i);
    assert.deepEqual(await applyDailyLogArchive(root, now), { moved: 0, skipped: 1 });
    assert.equal(await fs.readFile(path.join(root, "archive/logs/daily/2026-09/2026-09-01.md"), "utf8"), "kept\n");
    assert.equal(await fs.readFile(path.join(daily(), "2026-09-01.md"), "utf8"), "new\n");
  });

  it("moves the files, and only moves", async () => {
    await write("2026-09-01.md", "old\n");
    await write("2026-11-05.md", "recent\n");
    assert.deepEqual(await applyDailyLogArchive(root, now), { moved: 1, skipped: 0 });
    assert.equal(await fs.readFile(path.join(root, "archive/logs/daily/2026-09/2026-09-01.md"), "utf8"), "old\n");
    await assert.rejects(fs.access(path.join(daily(), "2026-09-01.md")));
    assert.equal(await fs.readFile(path.join(daily(), "2026-11-05.md"), "utf8"), "recent\n");
  });

  it("skips a symlink instead of following it out of the vault", async () => {
    const outside = path.join(parent, "outside.md");
    await fs.writeFile(outside, "secret\n");
    await fs.symlink(outside, path.join(daily(), "2026-09-03.md"));
    const plan = await planDailyLogArchive(root, now);
    assert.equal(plan.moves.length, 0);
    assert.equal(plan.skipped.length, 1);
  });

  it("refuses a missing vault root and creates nothing", async () => {
    const missing = path.join(parent, "unplugged", "vault");
    await assert.rejects(planDailyLogArchive(missing, now), /not available/);
    await assert.rejects(applyDailyLogArchive(missing, now), /not available/);
    await assert.rejects(fs.access(path.join(parent, "unplugged")));
  });

  it("does nothing when there is no logs/daily folder", async () => {
    await fs.rm(path.join(root, "logs"), { recursive: true });
    assert.deepEqual(await planDailyLogArchive(root, now), { moves: [], skipped: [] });
  });
});
