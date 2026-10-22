import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const previousRoot = process.env.AGENTOS_ROOT;
const previousProjects = process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
const previousSites = process.env.AGENTOS_CLIENT_SITES_DIR;

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-motion-site-repo-"));
const vault = path.join(directory, "AgentOS-Memory");
const clients = path.join(directory, "projects", "clients");

process.env.AGENTOS_ROOT = vault;
process.env.AGENTOS_CLIENT_PROJECTS_ROOT = clients;
delete process.env.AGENTOS_CLIENT_SITES_DIR;

await fs.mkdir(path.join(vault, "projects", "bosch"), { recursive: true });
await fs.mkdir(clients, { recursive: true });

const { defaultClientRepoPath, resolveClientRepoPath } = await import("../../website-rebuild/client-repo");
const { ensureMotionSiteRepo, siteRepoPath } = await import("../site-repo");

after(async () => {
  if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previousRoot;
  if (previousProjects === undefined) delete process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
  else process.env.AGENTOS_CLIENT_PROJECTS_ROOT = previousProjects;
  if (previousSites === undefined) delete process.env.AGENTOS_CLIENT_SITES_DIR;
  else process.env.AGENTOS_CLIENT_SITES_DIR = previousSites;
  await fs.rm(directory, { recursive: true, force: true });
});

describe("motion site repo location", () => {
  it("creates a new site outside the vault, as its own git repo", async () => {
    const repo = await ensureMotionSiteRepo("pantry-pilot", "Pantry Pilot");
    assert.equal(repo, path.join(clients, "pantry-pilot"));
    assert.equal(siteRepoPath("pantry-pilot"), path.join(clients, "pantry-pilot"));
    assert.equal(defaultClientRepoPath("pantry-pilot"), repo);
    assert.ok(!repo.startsWith(vault));

    const gitignore = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
    assert.match(gitignore, /node_modules/);
    assert.match(gitignore, /\.next/);
    assert.match(gitignore, /\._\*/);
    assert.match(gitignore, /\.DS_Store/);

    const branch = execFileSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(branch, "main");
    const toplevel = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    assert.equal(path.resolve(toplevel), path.resolve(repo));
  });

  it("keeps using a recorded vault-nested path instead of moving the files", async () => {
    const recorded = path.join(vault, "projects", "legacy", "site");
    await fs.mkdir(recorded, { recursive: true });
    await fs.writeFile(path.join(recorded, "package.json"), JSON.stringify({ name: "legacy-site" }), "utf8");
    const repo = await ensureMotionSiteRepo("legacy", "Legacy", recorded);
    assert.equal(repo, recorded);
    assert.equal(resolveClientRepoPath("legacy", recorded), recorded);
    assert.ok(!await fs.stat(path.join(clients, "legacy")).then(() => true).catch(() => false));
  });
});
