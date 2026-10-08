import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  setProjectRoot,
  getProjectRoot,
  clearProjectRoot,
  readFile,
  writeFile,
  listDirectory,
  getGitBranch,
} from "../file-operations";

describe("Coder File Operations", () => {
  let testDir: string;

  before(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "coder-test-"));
    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(testDir, "test.txt"), "Hello, World!");
    await fs.writeFile(path.join(testDir, "src", "index.ts"), "console.log('hello');");
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should set and get project root", () => {
    setProjectRoot(testDir);
    assert.equal(getProjectRoot(), testDir);
  });

  it("should clear project root", () => {
    setProjectRoot(testDir);
    clearProjectRoot();
    assert.equal(getProjectRoot(), null);
  });

  it("should read a file", async () => {
    setProjectRoot(testDir);
    const content = await readFile("test.txt");
    assert.equal(content, "Hello, World!");
  });

  it("should write a file", async () => {
    setProjectRoot(testDir);
    await writeFile("newfile.txt", "New content");
    const content = await fs.readFile(path.join(testDir, "newfile.txt"), "utf-8");
    assert.equal(content, "New content");
  });

  it("should list directory contents", async () => {
    setProjectRoot(testDir);
    const nodes = await listDirectory("");
    
    const names = nodes.map((n) => n.name);
    assert.ok(names.includes("test.txt"));
    assert.ok(names.includes("src"));
    assert.ok(!names.includes("node_modules"));
  });

  it("should reject path traversal with ..", async () => {
    setProjectRoot(testDir);
    
    await assert.rejects(
      async () => await readFile("../etc/passwd"),
      /Path traversal detected/
    );
  });

  it("should reject absolute path outside project", async () => {
    setProjectRoot(testDir);
    
    await assert.rejects(
      async () => await readFile("/etc/passwd"),
      /Path traversal detected/
    );
  });

  it("should reject symlink escape", async () => {
    setProjectRoot(testDir);
    
    const symlinkPath = path.join(testDir, "evil-link");
    try {
      await fs.symlink("/etc", symlinkPath);
      
      await assert.rejects(
        async () => await readFile("evil-link/passwd"),
        /Path traversal detected/
      );
    } catch (error) {
      // Skip test if symlink creation fails (Windows without admin)
      if ((error as NodeJS.ErrnoException).code !== "EPERM") {
        throw error;
      }
    }
  });

  it("should reject operations when no project is open", async () => {
    clearProjectRoot();
    
    await assert.rejects(
      async () => await readFile("test.txt"),
      /No project is currently open/
    );
  });

  it("should handle nested directory creation", async () => {
    setProjectRoot(testDir);
    await writeFile("deep/nested/file.txt", "Deep content");
    
    const content = await fs.readFile(path.join(testDir, "deep", "nested", "file.txt"), "utf-8");
    assert.equal(content, "Deep content");
  });

  it("should return null for git branch in non-git directory", async () => {
    setProjectRoot(testDir);
    const branch = await getGitBranch();
    assert.equal(branch, null);
  });
});
