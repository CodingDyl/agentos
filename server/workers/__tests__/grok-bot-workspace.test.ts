import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { checkWorkspace, workspacePathProblem } from "../grok-bot-workspace";
import { buildRoutingContext } from "../router";

/**
 * The Grok Bot workspace check only looks. A missing SSD must read as missing,
 * and nothing it does may leave a folder or file behind.
 */

function workspace(folders = ["memory", "tasks", "results"]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-bot-"));
  for (const folder of folders) fs.mkdirSync(path.join(root, folder));
  return root;
}

describe("grok bot workspace", () => {
  it("is available when memory is readable and tasks/results are writable", async () => {
    const root = workspace();
    const status = await checkWorkspace(root, { probe: true });
    assert.equal(status.state, "available");
    assert.ok(status.checks.every((check) => check.ok));
  });

  it("removes its probe files", async () => {
    const root = workspace();
    await checkWorkspace(root, { probe: true });
    assert.deepEqual(fs.readdirSync(path.join(root, "tasks")), []);
    assert.deepEqual(fs.readdirSync(path.join(root, "results")), []);
  });

  it("reports an unmounted SSD and creates nothing", async () => {
    const missing = "/Volumes/agentos-test-not-mounted-ssd/grok-bot";
    const status = await checkWorkspace(missing, { probe: true });
    assert.equal(status.state, "unavailable");
    assert.match(status.reason ?? "", /SSD is not connected/);
    assert.equal(fs.existsSync("/Volumes/agentos-test-not-mounted-ssd"), false);
  });

  it("reports a missing workspace folder without creating it", async () => {
    const missing = path.join(os.tmpdir(), `grok-bot-missing-${Date.now()}`);
    const status = await checkWorkspace(missing, { probe: true });
    assert.equal(status.state, "unavailable");
    assert.equal(fs.existsSync(missing), false);
  });

  it("names a missing subfolder and does not create it", async () => {
    const root = workspace(["memory", "tasks"]);
    const status = await checkWorkspace(root, { probe: true });
    assert.equal(status.state, "unavailable");
    assert.match(status.reason ?? "", /results\/ is missing/);
    assert.equal(fs.existsSync(path.join(root, "results")), false);
  });

  it("is unconfigured without a path, and refuses relative paths", async () => {
    assert.equal((await checkWorkspace(undefined, { probe: false })).state, "unconfigured");
    assert.ok(workspacePathProblem("grok-bot"));
    assert.equal(workspacePathProblem("/Volumes/X/grok-bot"), undefined);
  });

  it("is never a candidate for automatic routing", async () => {
    const context = await buildRoutingContext("Research the market for local AI tools");
    assert.ok(!context.candidates.some((candidate) => candidate.worker.id === "grok-bot"));
  });
});
