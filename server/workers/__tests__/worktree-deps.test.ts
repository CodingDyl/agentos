import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { prepareWorktreeDependencies } from "../worktree-deps";

describe("preparing dependencies in a worktree", () => {
  let directory: string;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-wt-deps-"));
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("symlinks node_modules from the source checkout", async () => {
    const source = path.join(directory, "source");
    const worktree = path.join(directory, "worktree");
    await fs.mkdir(path.join(source, "node_modules", "next", "dist", "docs"), { recursive: true });
    await fs.writeFile(path.join(source, "package.json"), "{}\n");
    await fs.writeFile(path.join(source, "node_modules", "next", "dist", "docs", "index.md"), "docs");
    await fs.mkdir(worktree, { recursive: true });
    await fs.writeFile(path.join(worktree, "package.json"), "{}\n");

    const result = await prepareWorktreeDependencies(source, worktree);

    assert.equal(result.ok, true);
    assert.equal(result.method, "symlink");
    const linked = await fs.readFile(
      path.join(worktree, "node_modules", "next", "dist", "docs", "index.md"),
      "utf8",
    );
    assert.equal(linked, "docs");
  });

  it("does nothing when there is no package.json", async () => {
    const empty = path.join(directory, "empty");
    await fs.mkdir(empty, { recursive: true });

    const result = await prepareWorktreeDependencies(empty, empty);
    assert.equal(result.ok, true);
    assert.equal(result.method, "none");
  });

  it("leaves an already-installed worktree alone", async () => {
    const dir = path.join(directory, "installed");
    await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), "{}\n");

    const result = await prepareWorktreeDependencies(dir, dir);
    assert.equal(result.method, "none");
    assert.match(result.detail, /already present/);
  });
});
