import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runValidation } from "../validation";

/**
 * `node_modules` is gitignored, so a checkout that did not run the install (the
 * real repository a job lands in, a fresh retry) has none, and `npm run build`
 * fails at once. Validation installs first.
 */
describe("validation in a checkout without dependencies", () => {
  let directory: string;
  const emit = () => undefined;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-validate-install-"));
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function project(name: string): Promise<string> {
    const dir = path.join(directory, name);
    await fs.mkdir(path.join(dir, "dep"), { recursive: true });
    await fs.writeFile(path.join(dir, "dep/package.json"), JSON.stringify({ name: "dep", version: "1.0.0" }));
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: name, version: "1.0.0", dependencies: { dep: "file:./dep" }, scripts: { build: "test -e node_modules/dep/package.json" } }),
    );
    return dir;
  }

  it("installs dependencies, then runs the command", async () => {
    const dir = await project("fresh");

    const outcome = await runValidation(["npm run build"], dir, emit, new AbortController().signal);

    assert.equal(outcome.passed, true, JSON.stringify(outcome.results));
    assert.deepEqual(outcome.results.map((result) => result.command), ["npm run build"]);
  });

  it("does not touch a checkout that is already installed", async () => {
    const dir = await project("installed");
    await fs.mkdir(path.join(dir, "node_modules/dep"), { recursive: true });
    await fs.writeFile(path.join(dir, "node_modules/dep/package.json"), "{}");
    await fs.writeFile(path.join(dir, "marker"), "");

    const outcome = await runValidation(["npm run build"], dir, emit, new AbortController().signal);

    assert.equal(outcome.passed, true);
    await assert.rejects(fs.access(path.join(dir, "package-lock.json")), "no install ran, so no lockfile was written");
  });

  it("says so plainly when the install itself fails", async () => {
    const dir = await project("broken");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "broken", version: "1.0.0", dependencies: { dep: "not a valid spec!!" }, scripts: { build: "true" } }),
    );

    const outcome = await runValidation(["npm run build"], dir, emit, new AbortController().signal);

    assert.equal(outcome.passed, false);
    assert.equal(outcome.results[0].command, "npm install");
  });

  it("ignores commands that are not npm", async () => {
    const dir = await project("plain");

    const outcome = await runValidation(["true"], dir, emit, new AbortController().signal);

    assert.equal(outcome.passed, true);
    await assert.rejects(fs.access(path.join(dir, "node_modules")));
  });
});
