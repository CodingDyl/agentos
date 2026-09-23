import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The adapter is read-only and root-confined. These tests pin both properties
 * against a throwaway vault, since a regression here would expose the wider
 * filesystem over HTTP.
 */

let vaultRoot: string;
let filesystem: typeof import("../filesystem");

before(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-test-"));
  await fs.mkdir(path.join(vaultRoot, "projects", "pantry-pilot"), {
    recursive: true,
  });
  await fs.writeFile(path.join(vaultRoot, "projects", "PORTFOLIO.md"), "# P\n");
  await fs.writeFile(
    path.join(vaultRoot, "projects", "pantry-pilot", "STATUS.md"),
    "# Status\n",
  );

  process.env.AGENTOS_ROOT = vaultRoot;
  filesystem = await import("../filesystem");
});

after(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

describe("path confinement", () => {
  it("reads a file inside the vault", async () => {
    assert.equal(await filesystem.readAgentOSFile("projects/PORTFOLIO.md"), "# P\n");
  });

  it("rejects traversal out of the vault", async () => {
    await assert.rejects(
      () => filesystem.readAgentOSFile("../../etc/passwd"),
      /Invalid AgentOS path/,
    );
  });

  it("rejects a traversal hidden mid-path", async () => {
    await assert.rejects(
      () => filesystem.readAgentOSFile("projects/../../secrets.md"),
      /Invalid AgentOS path/,
    );
  });

  it("rejects an absolute path outside the vault", async () => {
    await assert.rejects(
      () => filesystem.readAgentOSFile("/etc/passwd"),
      /Invalid AgentOS path/,
    );
  });
});

describe("graceful absence", () => {
  it("returns undefined for a missing optional file", async () => {
    assert.equal(await filesystem.readOptionalFile("me/NOTHING.md"), undefined);
  });

  it("still rejects traversal through the optional reader", async () => {
    await assert.rejects(
      () => filesystem.readOptionalFile("../../etc/passwd"),
      /Invalid AgentOS path/,
    );
  });

  it("reports existence without throwing", async () => {
    assert.equal(await filesystem.fileExists("projects/PORTFOLIO.md"), true);
    assert.equal(await filesystem.fileExists("projects/GHOST.md"), false);
  });

  it("lists a missing directory as empty", async () => {
    assert.deepEqual(await filesystem.listDirectory("logs/work-sessions"), []);
    assert.deepEqual(await filesystem.listMarkdownFiles("logs/daily"), []);
  });

  it("sorts date-stamped logs chronologically", async () => {
    const daily = path.join(vaultRoot, "logs", "daily");
    await fs.mkdir(daily, { recursive: true });
    await fs.writeFile(path.join(daily, "2026-09-05.md"), "a");
    await fs.writeFile(path.join(daily, "2026-09-12.md"), "b");
    await fs.writeFile(path.join(daily, "notes.txt"), "c");

    assert.deepEqual(await filesystem.listMarkdownFiles("logs/daily"), [
      "2026-09-05.md",
      "2026-09-12.md",
    ]);
  });
});
