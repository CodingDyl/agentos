import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { listFilesOutside, measureDirectory, removeInside, resolveInside, UnsafePathError } from "../safe-fs";

let base: string;
let root: string;
let outside: string;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "agentos-safefs-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  mkdirSync(path.join(root, "a/b"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "a/one.txt"), "x".repeat(100));
  writeFileSync(path.join(root, "a/b/two.txt"), "y".repeat(250));
  writeFileSync(path.join(outside, "precious.txt"), "z".repeat(5000));
});
after(() => rmSync(base, { recursive: true, force: true }));

describe("measuring a folder", () => {
  it("adds up every file and counts them", async () => {
    assert.deepEqual(await measureDirectory(root), { bytes: 350, files: 2, approximate: false });
  });

  it("counts a link as a link, never as what it points to", async () => {
    symlinkSync(path.join(outside, "precious.txt"), path.join(root, "a/link.txt"));
    symlinkSync(outside, path.join(root, "a/dirlink"));
    const size = await measureDirectory(root);
    assert.ok(size.bytes < 1000, `followed a link: ${size.bytes}`);
    rmSync(path.join(root, "a/link.txt"));
    rmSync(path.join(root, "a/dirlink"));
  });

  it("stops at its limit and says the size is a floor", async () => {
    const size = await measureDirectory(root, 2);
    assert.equal(size.approximate, true);
  });
});

describe("proving a folder is inside a root", () => {
  it("accepts a real folder inside", async () => {
    assert.equal(await resolveInside(root, path.join(root, "a")), path.join(await (await import("node:fs/promises")).realpath(root), "a"));
  });

  it("refuses the root itself, a folder outside, a file, a missing path and a missing root", async () => {
    await assert.rejects(resolveInside(root, root), UnsafePathError);
    await assert.rejects(resolveInside(root, outside), /not inside/);
    await assert.rejects(resolveInside(root, path.join(root, "a/one.txt")), /not a folder/);
    await assert.rejects(resolveInside(root, path.join(root, "nope")), /does not exist/);
    await assert.rejects(resolveInside(path.join(base, "no-root"), path.join(base, "no-root/x")), /is not there/);
  });

  it("refuses a way out through `..`", async () => {
    await assert.rejects(resolveInside(root, path.join(root, "a/../../outside")), /not inside/);
  });

  it("refuses a folder that is itself a link, even one pointing somewhere harmless", async () => {
    symlinkSync(path.join(root, "a"), path.join(root, "alias"));
    await assert.rejects(resolveInside(root, path.join(root, "alias")), /is a link/);
    rmSync(path.join(root, "alias"));
  });

  it("refuses a folder whose parent is a link out of the root", async () => {
    symlinkSync(outside, path.join(root, "escape"));
    mkdirSync(path.join(outside, "inner"));
    await assert.rejects(resolveInside(root, path.join(root, "escape/inner")), /not inside/);
    rmSync(path.join(root, "escape"));
  });
});

describe("deleting", () => {
  it("removes a folder inside, and nothing outside", async () => {
    mkdirSync(path.join(root, "gone/deep"), { recursive: true });
    writeFileSync(path.join(root, "gone/deep/x.txt"), "x");
    await removeInside(root, path.join(root, "gone"));
    assert.throws(() => statSync(path.join(root, "gone")));
    assert.ok(statSync(path.join(outside, "precious.txt")).size === 5000);
    assert.ok(statSync(path.join(root, "a")).isDirectory());
  });

  it("deletes nothing when the target fails any check", async () => {
    await assert.rejects(removeInside(root, outside));
    await assert.rejects(removeInside(root, root));
    assert.ok(statSync(path.join(outside, "precious.txt")).size === 5000);
    assert.ok(statSync(root).isDirectory());
  });

  it("does not follow a link inside the folder it deletes", async () => {
    mkdirSync(path.join(root, "withlink"));
    symlinkSync(outside, path.join(root, "withlink/out"));
    await removeInside(root, path.join(root, "withlink"));
    assert.ok(statSync(path.join(outside, "precious.txt")).size === 5000, "the link was removed, not what it pointed to");
  });
});

describe("listing what else is in a folder", () => {
  it("counts files outside the excluded paths and gives examples", async () => {
    mkdirSync(path.join(root, "ws/docs/website-rebuild"), { recursive: true });
    writeFileSync(path.join(root, "ws/PROJECT.md"), "p");
    writeFileSync(path.join(root, "ws/docs/website-rebuild/report.md"), "r");
    writeFileSync(path.join(root, "ws/notes.md"), "n");
    mkdirSync(path.join(root, "ws/tasks"));
    writeFileSync(path.join(root, "ws/tasks/t1.md"), "t");
    const found = await listFilesOutside(path.join(root, "ws"), ["docs/website-rebuild", "PROJECT.md"]);
    assert.equal(found.total, 2);
    assert.deepEqual(found.examples.sort(), ["notes.md", "tasks/t1.md"]);
  });
});
