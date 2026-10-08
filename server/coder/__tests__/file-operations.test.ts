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

  it("should set and get project root", async () => {
    await setProjectRoot(testDir);
    assert.equal(getProjectRoot(), testDir);
  });

  it("should clear project root", async () => {
    await setProjectRoot(testDir);
    clearProjectRoot();
    assert.equal(getProjectRoot(), null);
  });

  it("should reject non-directory as project root", async () => {
    const filePath = path.join(testDir, "test.txt");
    await assert.rejects(
      async () => await setProjectRoot(filePath),
      /not a directory/i
    );
  });

  it("should reject non-existent path as project root", async () => {
    await assert.rejects(
      async () => await setProjectRoot("/nonexistent/path"),
      /Invalid project root/
    );
  });

  it("should read a file", async () => {
    await setProjectRoot(testDir);
    const content = await readFile("test.txt");
    assert.equal(content, "Hello, World!");
  });

  it("should write a file", async () => {
    await setProjectRoot(testDir);
    await writeFile("newfile.txt", "New content");
    const content = await fs.readFile(path.join(testDir, "newfile.txt"), "utf-8");
    assert.equal(content, "New content");
  });

  it("should list directory contents", async () => {
    await setProjectRoot(testDir);
    const nodes = await listDirectory("");
    
    const names = nodes.map((n) => n.name);
    assert.ok(names.includes("test.txt"));
    assert.ok(names.includes("src"));
    assert.ok(!names.includes("node_modules"));
  });

  it("should reject path traversal with ..", async () => {
    await setProjectRoot(testDir);
    
    await assert.rejects(
      async () => await readFile("../etc/passwd"),
      /Path traversal detected/
    );
  });

  it("should reject absolute path outside project", async () => {
    await setProjectRoot(testDir);
    
    await assert.rejects(
      async () => await readFile("/etc/passwd"),
      /Path traversal detected/
    );
  });

  it("should reject symlink escape", async () => {
    await setProjectRoot(testDir);
    
    const symlinkPath = path.join(testDir, "evil-link");
    try {
      await fs.symlink("/etc", symlinkPath);
      
      await assert.rejects(
        async () => await readFile("evil-link/passwd"),
        /Path traversal detected/
      );
      
      await fs.unlink(symlinkPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        console.log("Skipping symlink test on Windows without admin");
        return;
      }
      throw error;
    }
  });

  it("should reject sibling directory with matching prefix", async () => {
    await setProjectRoot(testDir);
    
    const parentDir = path.dirname(testDir);
    const baseName = path.basename(testDir);
    const siblingDir = path.join(parentDir, `${baseName}-evil`);
    
    await fs.mkdir(siblingDir, { recursive: true });
    await fs.writeFile(path.join(siblingDir, "secret.txt"), "secret data");
    
    try {
      const relativeSibling = path.relative(testDir, siblingDir);
      
      await assert.rejects(
        async () => await readFile(`${relativeSibling}/secret.txt`),
        /Path traversal detected/
      );
    } finally {
      await fs.rm(siblingDir, { recursive: true, force: true });
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
    await setProjectRoot(testDir);
    await writeFile("deep/nested/file.txt", "Deep content");
    
    const content = await fs.readFile(path.join(testDir, "deep", "nested", "file.txt"), "utf-8");
    assert.equal(content, "Deep content");
  });

  it("should return null for git branch in non-git directory", async () => {
    await setProjectRoot(testDir);
    const branch = await getGitBranch();
    assert.equal(branch, null);
  });
});
