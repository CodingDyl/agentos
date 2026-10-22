import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { needsInTreeNodeModules, prepareWorktreeDependencies } from "../worktree-deps";

async function writeManifest(directory: string, manifest: object): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeLockfile(directory: string, contents: string): Promise<void> {
  await fs.writeFile(path.join(directory, "package-lock.json"), contents);
}

async function plantModules(directory: string, pkg = "next"): Promise<void> {
  const pkgDir = path.join(directory, "node_modules", pkg);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }));
}

async function isRealDirectory(target: string): Promise<boolean> {
  const stat = await fs.lstat(target);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

describe("which projects need an in-tree node_modules", () => {
  it("treats Next, Vite and other workspace bundlers as needing a real directory", () => {
    assert.equal(needsInTreeNodeModules({ dependencies: { next: "15.0.0" } }), true);
    assert.equal(needsInTreeNodeModules({ devDependencies: { vite: "6.0.0" } }), true);
    assert.equal(needsInTreeNodeModules({ dependencies: { astro: "5.0.0" } }), true);
    assert.equal(needsInTreeNodeModules({ scripts: { dev: "next dev" } }), true);
    assert.equal(needsInTreeNodeModules({ dependencies: { express: "4.0.0" } }), false);
    assert.equal(needsInTreeNodeModules(undefined), false);
  });
});

describe("preparing dependencies in a worktree", () => {
  let directory: string;
  let previousUiDir: string | undefined;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-wt-deps-"));
    previousUiDir = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
  });

  after(async () => {
    if (previousUiDir === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previousUiDir;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("gives a Next.js worktree a real node_modules, not a symlink outside it", async () => {
    const source = path.join(directory, "next-source");
    const worktree = path.join(directory, "next-worktree");
    const manifest = { name: "bosch", dependencies: { next: "15.5.4" } };
    const lock = '{"lockfileVersion": 3, "name": "bosch"}\n';

    await writeManifest(source, manifest);
    await writeLockfile(source, lock);
    await plantModules(source);
    await writeManifest(worktree, manifest);
    await writeLockfile(worktree, lock);

    const result = await prepareWorktreeDependencies(source, worktree);

    assert.equal(result.ok, true);
    assert.ok(result.method === "clone" || result.method === "copy", result.method);
    assert.equal(await isRealDirectory(path.join(worktree, "node_modules")), true);
    const nextPkg = path.join(worktree, "node_modules", "next", "package.json");
    assert.equal((await fs.lstat(nextPkg)).isSymbolicLink(), false);
    assert.match(await fs.readFile(nextPkg, "utf8"), /"next"/);
  });

  it("does the same for Vite, which also will not follow an outside symlink", async () => {
    const source = path.join(directory, "vite-source");
    const worktree = path.join(directory, "vite-worktree");
    const manifest = { name: "site", devDependencies: { vite: "6.0.0" } };

    await writeManifest(source, manifest);
    await plantModules(source, "vite");
    await writeManifest(worktree, manifest);

    const result = await prepareWorktreeDependencies(source, worktree);

    assert.equal(result.ok, true);
    assert.ok(result.method === "clone" || result.method === "copy", result.method);
    assert.equal(await isRealDirectory(path.join(worktree, "node_modules")), true);
  });

  it("may still symlink node_modules for a project that does not use a workspace bundler", async () => {
    const source = path.join(directory, "cli-source");
    const worktree = path.join(directory, "cli-worktree");
    const manifest = { name: "cli", dependencies: { commander: "12.0.0" } };

    await writeManifest(source, manifest);
    await plantModules(source, "commander");
    await writeManifest(worktree, manifest);

    const result = await prepareWorktreeDependencies(source, worktree);

    assert.equal(result.ok, true);
    assert.equal(result.method, "symlink");
    const linked = await fs.readFile(path.join(worktree, "node_modules", "commander", "package.json"), "utf8");
    assert.match(linked, /commander/);
  });

  it("replaces a leftover outside symlink on a Next.js worktree so Turbopack can resolve next", async () => {
    const source = path.join(directory, "stale-source");
    const worktree = path.join(directory, "stale-worktree");
    const manifest = { name: "bosch", dependencies: { next: "15.5.4" } };

    await writeManifest(source, manifest);
    await plantModules(source);
    await writeManifest(worktree, manifest);
    await fs.symlink(path.join(source, "node_modules"), path.join(worktree, "node_modules"), "dir");

    const result = await prepareWorktreeDependencies(source, worktree);

    assert.equal(result.ok, true);
    assert.ok(result.method === "clone" || result.method === "copy", result.method);
    assert.equal(await isRealDirectory(path.join(worktree, "node_modules")), true);
    assert.equal((await fs.lstat(path.join(source, "node_modules"))).isDirectory(), true);
  });

  it("reuses a lockfile cache when the source checkout has no node_modules", async () => {
    const source = path.join(directory, "cache-source");
    const first = path.join(directory, "cache-worktree-a");
    const second = path.join(directory, "cache-worktree-b");
    const manifest = { name: "cached", dependencies: { next: "15.5.4" } };
    const lock = '{"lockfileVersion": 3, "name": "cached-unique"}\n';

    await writeManifest(source, manifest);
    await writeLockfile(source, lock);
    await plantModules(source);
    await writeManifest(first, manifest);
    await writeLockfile(first, lock);

    const seeded = await prepareWorktreeDependencies(source, first);
    assert.equal(seeded.ok, true);
    assert.ok(seeded.method === "clone" || seeded.method === "copy");

    await fs.rm(path.join(source, "node_modules"), { recursive: true, force: true });
    await writeManifest(second, manifest);
    await writeLockfile(second, lock);

    const result = await prepareWorktreeDependencies(source, second);

    assert.equal(result.ok, true);
    assert.ok(result.method === "clone" || result.method === "copy", result.detail);
    assert.equal(await isRealDirectory(path.join(second, "node_modules")), true);
    assert.match(await fs.readFile(path.join(second, "node_modules", "next", "package.json"), "utf8"), /"next"/);
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
