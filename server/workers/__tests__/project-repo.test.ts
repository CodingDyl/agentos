import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { gitCommonDir, gitDir, gitToplevel, isGitRoot } from "../../agentos/git";
import { ensureProjectRepo, inspectProjectRepo } from "../project-repo";
import { createWorktree, projectDirIn, worktreeRoot } from "../worktree";
import { gitWritableRoots } from "../git-sandbox";

const run = promisify(execFile);

/**
 * A project folder that is not its own git repo — it sits inside a larger
 * vault repository, the way Bosch's site sits inside AgentOS. Worktrees
 * created from that folder used to check out the whole vault.
 */

describe("a project folder inside a parent repository", () => {
  let directory: string;
  let vault: string;
  let site: string;
  let previousUi: string | undefined;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-nested-repo-"));
    previousUi = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = path.join(directory, "ui");

    vault = path.join(directory, "AgentOS");
    site = path.join(vault, "AgentOS-Memory", "projects", "bosch", "site");
    await fs.mkdir(site, { recursive: true });
    await fs.mkdir(path.join(vault, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(vault, "README.md"), "# Vault\n", "utf8");
    await fs.writeFile(
      path.join(site, "package.json"),
      JSON.stringify({ name: "bosch-site", version: "1.0.0" }),
    );
    await fs.mkdir(path.join(site, "node_modules", "next", "dist", "docs"), { recursive: true });
    await fs.writeFile(path.join(site, "node_modules", "next", "dist", "docs", "index.md"), "# Next docs\n");

    await run("git", ["init", "-q", "-b", "main", "."], { cwd: vault });
    await run("git", ["add", "-A"], { cwd: vault });
    await run("git", ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "vault"], {
      cwd: vault,
    });
  });

  after(async () => {
    if (previousUi === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previousUi;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("sees the site as a nested checkout of the vault, not its own repo", async () => {
    const inspection = await inspectProjectRepo(site);

    assert.equal(inspection.exists, true);
    assert.equal(inspection.isRepository, true);
    assert.equal(inspection.isGitRoot, false);
    assert.equal(inspection.hasOwnGit, false);
    assert.equal(inspection.nestedInParent, true);
    assert.equal(inspection.toplevel, vault);
  });

  it("makes the site its own repository so worktrees are of the project", async () => {
    const isolated = await ensureProjectRepo(site);

    assert.equal(isolated.gitRoot, path.resolve(site));
    assert.equal(isolated.projectPrefix, "");
    assert.equal(isolated.initialized, true);
    assert.equal(isolated.nestedInParent, true);
    assert.equal(isolated.parentGitRoot, vault);
    assert.match(isolated.note ?? "", /own git repository/);

    assert.equal(await isGitRoot(site), true);
    assert.equal(await gitToplevel(site), path.resolve(site));
    assert.notEqual(await gitToplevel(site), vault);
  });

  it("creates a worktree whose top level is the site, not the vault", async () => {
    const handle = await createWorktree(site, "job_eede2fd9aeac4c71");

    assert.equal(handle.path, path.join(worktreeRoot(), "job_eede2fd9aeac4c71"));
    await fs.access(path.join(handle.path, "package.json"));
    await assert.rejects(fs.access(path.join(handle.path, "AgentOS-Memory")));
    await assert.rejects(fs.access(path.join(handle.path, "artifacts")));

    assert.equal(await projectDirIn(handle.path, site), handle.path);

    const dir = await gitDir(handle.path);
    const common = await gitCommonDir(handle.path);
    assert.ok(dir, "worktree has a gitdir");
    assert.ok(common, "worktree has a common dir");
    assert.ok(dir.startsWith(path.join(site, ".git")), dir);
    assert.ok(!dir.startsWith(handle.path + path.sep), "gitdir lives in the source repo, not the worktree");
    assert.ok(!dir.startsWith(path.join(vault, ".git")), "gitdir is not the parent vault's");

    const roots = await gitWritableRoots(handle.path);
    assert.ok(roots);
    assert.ok(roots.extraRoots.includes(dir));
    assert.ok(roots.extraRoots.includes(common));
    for (const root of roots.extraRoots) {
      assert.ok(
        path.resolve(root) === path.resolve(handle.path) ||
          !root.startsWith(handle.path + path.sep),
        `${root} should be an extra writable root outside the worktree`,
      );
    }
  });
});
