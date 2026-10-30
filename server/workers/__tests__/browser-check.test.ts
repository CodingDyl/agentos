import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { pickServeScript, serveFlags } from "../../../scripts/browser-check-serve.mjs";
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

  it("serves the front end alone when dev also starts a back end", () => {
    const scripts = { dev: 'concurrently -k -n data,web "npm:dev:data" "npm:dev:web"', "dev:web": "vite", "dev:data": "tsx watch server/index.ts" };
    assert.equal(pickServeScript(scripts), "dev:web");
    assert.equal(serveFlags(scripts["dev:web"], 5173), " -- --port 5173 --host 127.0.0.1 --strictPort");
  });

  it("still serves dev or start for an ordinary project", () => {
    assert.equal(pickServeScript({ dev: "next dev", start: "next start" }), "dev");
    assert.equal(pickServeScript({ start: "node server.js" }), "start");
    assert.equal(pickServeScript({ dev: "concurrently a b" }), "dev");
    assert.equal(pickServeScript({ test: "x" }), undefined);
    assert.equal(serveFlags("next dev", 3000), " -- --port 3000 --hostname 127.0.0.1");
  });
});
