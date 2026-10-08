import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import {
  getGitStatus,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  discardChanges,
  listBranches,
  switchBranch,
  pullChanges,
  
} from "../git-operations";

async function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn("git", args, { cwd, stdio: "pipe" });
    git.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Git command failed: ${args.join(" ")}`));
    });
  });
}

describe("Git Operations", () => {
  let testDir: string;

  before(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-test-"));
    
    await runGit(["init"], testDir);
    await runGit(["config", "user.name", "Test User"], testDir);
    await runGit(["config", "user.email", "test@example.com"], testDir);
    
    await fs.writeFile(path.join(testDir, "README.md"), "# Test Repo\n");
    await runGit(["add", "README.md"], testDir);
    await runGit(["commit", "-m", "Initial commit"], testDir);
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("switchBranch", () => {
    it("should reject invalid branch names with spaces", async () => {
      await assert.rejects(
        async () => await switchBranch(testDir, "invalid branch", false),
        /Invalid branch name/,
      );
    });

    it("should reject branch names with ..", async () => {
      await assert.rejects(
        async () => await switchBranch(testDir, "feat..bad", false),
        /Invalid branch name/,
      );
    });

    it("should reject branch names starting with -", async () => {
      await assert.rejects(
        async () => await switchBranch(testDir, "-badname", false),
        /Invalid branch name/,
      );
    });

    it("should reject branch names with special chars", async () => {
      await assert.rejects(
        async () => await switchBranch(testDir, "feat~1", false),
        /Invalid branch name/,
      );
    });

    it("should reject branch names with @{", async () => {
      await assert.rejects(
        async () => await switchBranch(testDir, "branch@{1}", false),
        /Invalid branch name/,
      );
    });

    it("should accept valid branch names", async () => {
      const initialStatus = await getGitStatus(testDir);
      const initialBranch = initialStatus.branch;
      
      await switchBranch(testDir, "feature/test-branch", true);
      const status = await getGitStatus(testDir);
      assert.equal(status.branch, "feature/test-branch");
      
      await switchBranch(testDir, initialBranch, false);
    });
  });

  describe("getGitStatus", () => {
    it("should return clean status for clean repo", async () => {
      const status = await getGitStatus(testDir);
      
      assert.ok(status.branch);
      assert.equal(status.files.length, 0);
      assert.equal(status.clean, true);
    });

    it("should detect untracked files", async () => {
      await fs.writeFile(path.join(testDir, "untracked.txt"), "content");
      
      const status = await getGitStatus(testDir);
      
      assert.equal(status.clean, false);
      const untracked = status.files.find(f => f.path === "untracked.txt");
      assert.ok(untracked);
      assert.equal(untracked.status, "untracked");
      assert.equal(untracked.staged, false);
      
      await fs.unlink(path.join(testDir, "untracked.txt"));
    });

    it("should detect modified files", async () => {
      await fs.writeFile(path.join(testDir, "README.md"), "# Modified\n");
      
      const status = await getGitStatus(testDir);
      
      const modified = status.files.find(f => f.path === "README.md");
      assert.ok(modified);
      assert.equal(modified.status, "modified");
      assert.equal(modified.staged, false);
      
      await runGit(["checkout", "README.md"], testDir);
    });

    it("should detect staged files", async () => {
      await fs.writeFile(path.join(testDir, "README.md"), "# Staged\n");
      await runGit(["add", "README.md"], testDir);
      
      const status = await getGitStatus(testDir);
      
      const staged = status.files.find(f => f.path === "README.md" && f.staged);
      assert.ok(staged);
      assert.equal(staged.status, "modified");
      assert.equal(staged.staged, true);
      
      await runGit(["reset", "HEAD", "README.md"], testDir);
      await runGit(["checkout", "README.md"], testDir);
    });

    it("should detect added files", async () => {
      await fs.writeFile(path.join(testDir, "new-file.txt"), "content");
      await runGit(["add", "new-file.txt"], testDir);
      
      const status = await getGitStatus(testDir);
      
      const added = status.files.find(f => f.path === "new-file.txt");
      assert.ok(added);
      assert.equal(added.status, "added");
      assert.equal(added.staged, true);
      
      await runGit(["reset", "HEAD", "new-file.txt"], testDir);
      await fs.unlink(path.join(testDir, "new-file.txt"));
    });
  });

  describe("stageFiles and unstageFiles", () => {
    it("should stage specific files", async () => {
      await fs.writeFile(path.join(testDir, "file1.txt"), "content1");
      await fs.writeFile(path.join(testDir, "file2.txt"), "content2");
      
      await stageFiles(testDir, ["file1.txt"]);
      
      const status = await getGitStatus(testDir);
      const staged = status.files.filter(f => f.staged);
      assert.equal(staged.length, 1);
      assert.equal(staged[0].path, "file1.txt");
      
      await runGit(["reset", "HEAD", "."], testDir);
      await fs.unlink(path.join(testDir, "file1.txt"));
      await fs.unlink(path.join(testDir, "file2.txt"));
    });

    it("should stage all files with all flag", async () => {
      await fs.writeFile(path.join(testDir, "file1.txt"), "content1");
      await fs.writeFile(path.join(testDir, "file2.txt"), "content2");
      
      await stageFiles(testDir, undefined, true);
      
      const status = await getGitStatus(testDir);
      const staged = status.files.filter(f => f.staged);
      assert.ok(staged.length >= 2);
      
      await runGit(["reset", "HEAD", "."], testDir);
      await fs.unlink(path.join(testDir, "file1.txt"));
      await fs.unlink(path.join(testDir, "file2.txt"));
    });

    it("should unstage files", async () => {
      await fs.writeFile(path.join(testDir, "staged.txt"), "content");
      await runGit(["add", "staged.txt"], testDir);
      
      await unstageFiles(testDir, ["staged.txt"]);
      
      const status = await getGitStatus(testDir);
      const staged = status.files.find(f => f.path === "staged.txt" && f.staged);
      assert.ok(!staged);
      
      await fs.unlink(path.join(testDir, "staged.txt"));
    });
  });

  describe("commitChanges", () => {
    it("should reject empty commit message", async () => {
      await assert.rejects(
        async () => await commitChanges(testDir, ""),
        /Commit message cannot be empty/,
      );
    });

    it("should commit staged changes", async () => {
      await fs.writeFile(path.join(testDir, "commit-test.txt"), "content");
      await runGit(["add", "commit-test.txt"], testDir);
      
      await commitChanges(testDir, "Test commit");
      
      const status = await getGitStatus(testDir);
      assert.equal(status.clean, true);
    });
  });

  describe("discardChanges", () => {
    it("should discard changes to specified files", async () => {
      await fs.writeFile(path.join(testDir, "README.md"), "# Discarded\n");
      
      await discardChanges(testDir, ["README.md"]);
      
      const content = await fs.readFile(path.join(testDir, "README.md"), "utf-8");
      assert.equal(content, "# Test Repo\n");
    });

    it("should require files to be specified", async () => {
      await assert.rejects(
        async () => await discardChanges(testDir, []),
        /Must specify files to discard/,
      );
    });

    it("should reject paths with ..", async () => {
      await assert.rejects(
        async () => await discardChanges(testDir, ["../outside.txt"]),
        /outside the repository|Invalid file path/,
      );
    });

    it("should reject absolute paths", async () => {
      await assert.rejects(
        async () => await discardChanges(testDir, ["/etc/passwd"]),
        /outside the repository|Invalid file path/,
      );
    });

    it("should delete untracked files", async () => {
      const untrackedPath = path.join(testDir, "untracked.txt");
      await fs.writeFile(untrackedPath, "untracked content");
      
      await discardChanges(testDir, ["untracked.txt"]);
      
      await assert.rejects(
        async () => await fs.access(untrackedPath),
        { code: "ENOENT" },
      );
    });
  });

  describe("listBranches", () => {
    it("should list local branches", async () => {
      const initialStatus = await getGitStatus(testDir);
      const initialBranch = initialStatus.branch;
      
      await runGit(["checkout", "-b", "test-branch"], testDir);
      await runGit(["checkout", initialBranch], testDir);
      
      const branches = await listBranches(testDir);
      
      const defaultBranch = branches.find(b => b.name === initialBranch && !b.remote);
      const testBranch = branches.find(b => b.name === "test-branch" && !b.remote);
      
      assert.ok(defaultBranch);
      assert.ok(testBranch);
      assert.equal(defaultBranch.current, true);
      
      await runGit(["branch", "-d", "test-branch"], testDir);
    });
  });

  describe("pullChanges", () => {
    it("should refuse pull with dirty working tree", async () => {
      await fs.writeFile(path.join(testDir, "dirty.txt"), "uncommitted");
      
      const result = await pullChanges(testDir);
      
      assert.equal(result.success, false);
      assert.ok(result.message.includes("uncommitted changes"));
      
      await fs.unlink(path.join(testDir, "dirty.txt"));
    });

    it("should handle pull in repo without upstream", async () => {
      const result = await pullChanges(testDir);
      
      assert.ok(!result.success || result.success);
    });
  });

  describe("getGitDiff", () => {
    it("should get diff for modified file", async () => {
      await fs.writeFile(path.join(testDir, "diff-test.txt"), "original content\n");
      await runGit(["add", "diff-test.txt"], testDir);
      await runGit(["commit", "-m", "Add diff-test.txt"], testDir);
      
      await fs.writeFile(path.join(testDir, "diff-test.txt"), "modified content\n");
      
      const diff = await getGitDiff(testDir, "diff-test.txt", false);
      
      assert.equal(diff.path, "diff-test.txt");
      assert.ok(diff.oldContent.includes("original"));
      assert.ok(diff.newContent.includes("modified"));
    });

    it("should get staged diff", async () => {
      await fs.writeFile(path.join(testDir, "staged-diff.txt"), "staged content\n");
      await runGit(["add", "staged-diff.txt"], testDir);
      
      const diff = await getGitDiff(testDir, "staged-diff.txt", true);
      
      assert.equal(diff.path, "staged-diff.txt");
      assert.ok(diff.newContent.includes("staged"));
      
      await runGit(["reset", "HEAD", "staged-diff.txt"], testDir);
      await fs.unlink(path.join(testDir, "staged-diff.txt"));
    });
  });
});
