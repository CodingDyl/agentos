import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_CLIENT_PROJECTS_ROOT,
  DEFAULT_CLIENT_SITES_DIR,
  clientSitesDir,
  defaultClientRepoPath,
  ensureClientRepo,
  resolveClientRepoPath,
  usableRepoPath,
} from "../client-repo";

function withoutClientRoot<T>(run: () => T): T {
  const projects = process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
  const sites = process.env.AGENTOS_CLIENT_SITES_DIR;
  delete process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
  delete process.env.AGENTOS_CLIENT_SITES_DIR;
  try {
    return run();
  } finally {
    if (projects === undefined) delete process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
    else process.env.AGENTOS_CLIENT_PROJECTS_ROOT = projects;
    if (sites === undefined) delete process.env.AGENTOS_CLIENT_SITES_DIR;
    else process.env.AGENTOS_CLIENT_SITES_DIR = sites;
  }
}

async function withClientRoot<T>(values: { projects?: string; sites?: string }, run: () => T | Promise<T>): Promise<T> {
  const previousProjects = process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
  const previousSites = process.env.AGENTOS_CLIENT_SITES_DIR;
  if (values.projects === undefined) delete process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
  else process.env.AGENTOS_CLIENT_PROJECTS_ROOT = values.projects;
  if (values.sites === undefined) delete process.env.AGENTOS_CLIENT_SITES_DIR;
  else process.env.AGENTOS_CLIENT_SITES_DIR = values.sites;
  try {
    return await run();
  } finally {
    if (previousProjects === undefined) delete process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
    else process.env.AGENTOS_CLIENT_PROJECTS_ROOT = previousProjects;
    if (previousSites === undefined) delete process.env.AGENTOS_CLIENT_SITES_DIR;
    else process.env.AGENTOS_CLIENT_SITES_DIR = previousSites;
  }
}

describe("client projects root", () => {
  it("defaults outside the AgentOS-Memory vault", () => {
    withoutClientRoot(() => {
      assert.equal(DEFAULT_CLIENT_PROJECTS_ROOT, "/Volumes/DylanSSD/projects/clients");
      assert.equal(DEFAULT_CLIENT_SITES_DIR, DEFAULT_CLIENT_PROJECTS_ROOT);
      assert.equal(clientSitesDir(), "/Volumes/DylanSSD/projects/clients");
      assert.equal(defaultClientRepoPath("bosch"), "/Volumes/DylanSSD/projects/clients/bosch");
      assert.doesNotMatch(defaultClientRepoPath("bosch"), /AgentOS-Memory|\/projects\/bosch\/site/);
    });
  });

  it("prefers AGENTOS_CLIENT_PROJECTS_ROOT, then AGENTOS_CLIENT_SITES_DIR", async () => {
    await withClientRoot({ sites: "/tmp/legacy-clients" }, () => {
      assert.equal(clientSitesDir(), "/tmp/legacy-clients");
    });
    await withClientRoot({ projects: "/tmp/client-projects", sites: "/tmp/legacy-clients" }, () => {
      assert.equal(clientSitesDir(), "/tmp/client-projects");
      assert.equal(defaultClientRepoPath("bosch"), "/tmp/client-projects/bosch");
    });
  });

  it("uses a recorded path when one is set, including an old vault site folder", () => {
    const vaultSite = path.join(os.tmpdir(), "AgentOS-Memory", "projects", "bosch", "site");
    assert.equal(usableRepoPath("_not set_"), undefined);
    assert.equal(usableRepoPath("  "), undefined);
    assert.equal(resolveClientRepoPath("bosch", vaultSite), vaultSite);
    withoutClientRoot(() => {
      assert.equal(resolveClientRepoPath("bosch"), "/Volumes/DylanSSD/projects/clients/bosch");
    });
  });
});

describe("ensureClientRepo at a recorded path", () => {
  it("reuses a recorded folder instead of creating one at the default root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-recorded-client-"));
    const recorded = path.join(root, "already-moved", "bosch");
    const defaults = path.join(root, "defaults");
    try {
      await withClientRoot({ projects: defaults }, async () => {
        const repo = await ensureClientRepo("bosch", "Bosch", recorded);
        assert.equal(repo, recorded);
        assert.ok(fs.existsSync(path.join(recorded, ".git")));
        assert.ok(!fs.existsSync(path.join(defaults, "bosch")));
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
