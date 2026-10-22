import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BROWSER_CHECK_LABEL, defaultValidationFor, isWebProject } from "../browser-check";

describe("AgentOS's own browser check", () => {
  let directory: string;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-browser-check-"));
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("is labelled as AgentOS Chromium, not a worker command", () => {
    assert.match(BROWSER_CHECK_LABEL, /AgentOS browser check/);
    assert.match(BROWSER_CHECK_LABEL, /Chromium/);
    assert.doesNotMatch(BROWSER_CHECK_LABEL, /Codex|worker sandbox/i);
  });

  it("treats a Next.js app with a dev script as a web project", async () => {
    const dir = path.join(directory, "next");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev", build: "next build" }, dependencies: { next: "15.5.4" } }),
    );

    assert.equal(await isWebProject(dir), true);
    assert.deepEqual(await defaultValidationFor(dir), ["npm run build"]);
  });

  it("does not treat a CLI package as a web project", async () => {
    const dir = path.join(directory, "cli");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ bin: { tool: "cli.js" }, scripts: { test: "node --test" } }),
    );

    assert.equal(await isWebProject(dir), false);
    assert.deepEqual(await defaultValidationFor(dir), []);
  });
});
