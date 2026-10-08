import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import type { GitStatus, GitFileStatus, GitDiff, GitBranch } from "../../shared/coder-types";

function validateBranchName(branchName: string): boolean {
  if (!branchName || branchName.length === 0) return false;
  
  const invalidChars = /[~^:\\\s\*\?\[]/;
  if (invalidChars.test(branchName)) return false;
  
  if (branchName.startsWith("-") || branchName.endsWith(".") || branchName.includes("..")) {
    return false;
  }
  
  if (branchName.includes("@{")) return false;
  
  return true;
}

async function runGitCommand(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const git = spawn("git", args, {
      cwd,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    git.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    git.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    git.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });

    git.on("error", (error) => {
      resolve({ stdout: "", stderr: error.message, exitCode: 1 });
    });
  });
}

export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  const branchResult = await runGitCommand(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    repoPath,
  );

  if (branchResult.exitCode !== 0) {
    throw new Error("Failed to get current branch");
  }

  const branch = branchResult.stdout.trim();

  const upstreamResult = await runGitCommand(
    ["rev-parse", "--abbrev-ref", "@{u}"],
    repoPath,
  );

  let ahead = 0;
  let behind = 0;

  if (upstreamResult.exitCode === 0) {
    const countResult = await runGitCommand(
      ["rev-list", "--left-right", "--count", `HEAD...@{u}`],
      repoPath,
    );

    if (countResult.exitCode === 0) {
      const [aheadStr, behindStr] = countResult.stdout.trim().split("\t");
      ahead = Number.parseInt(aheadStr || "0", 10);
      behind = Number.parseInt(behindStr || "0", 10);
    }
  }

  const statusResult = await runGitCommand(
    ["status", "--porcelain=v1", "-uall"],
    repoPath,
  );

  const files: GitFileStatus[] = [];
  const lines = statusResult.stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    if (line.length < 4) continue;

    const x = line[0];
    const y = line[1];
    const filePath = line.substring(3);

    if (filePath.startsWith('"')) {
      continue;
    }

    if (y === "?" && x === "?") {
      files.push({ path: filePath, status: "untracked", staged: false });
    } else {
      if (x !== " " && x !== "?") {
        let status: GitFileStatus["status"] = "modified";
        if (x === "A") status = "added";
        else if (x === "D") status = "deleted";
        else if (x === "R") status = "renamed";

        files.push({ path: filePath, status, staged: true });
      }

      if (y !== " " && y !== "?") {
        let status: GitFileStatus["status"] = "modified";
        if (y === "A") status = "added";
        else if (y === "D") status = "deleted";
        else if (y === "M") status = "modified";

        const existing = files.find(
          (f) => f.path === filePath && f.staged === false,
        );
        if (!existing) {
          files.push({ path: filePath, status, staged: false });
        }
      }
    }
  }

  return {
    branch,
    ahead,
    behind,
    files,
    clean: files.length === 0,
  };
}

export async function getGitDiff(
  repoPath: string,
  filePath: string,
  staged: boolean = false,
): Promise<GitDiff> {
  const args = staged
    ? ["diff", "--cached", "--", filePath]
    : ["diff", "--", filePath];

  const diffResult = await runGitCommand(args, repoPath);

  if (diffResult.exitCode !== 0) {
    throw new Error(`Failed to get diff: ${diffResult.stderr}`);
  }

  let oldContent = "";
  let newContent = "";

  if (!staged) {
    const headResult = await runGitCommand(
      ["show", `HEAD:${filePath}`],
      repoPath,
    );
    if (headResult.exitCode === 0) {
      oldContent = headResult.stdout;
    }

    try {
      const fullPath = `${repoPath}/${filePath}`;
      newContent = await fs.readFile(fullPath, "utf-8");
    } catch {
      newContent = "";
    }
  } else {
    const headResult = await runGitCommand(
      ["show", `HEAD:${filePath}`],
      repoPath,
    );
    if (headResult.exitCode === 0) {
      oldContent = headResult.stdout;
    }

    const indexResult = await runGitCommand(
      ["show", `:${filePath}`],
      repoPath,
    );
    if (indexResult.exitCode === 0) {
      newContent = indexResult.stdout;
    }
  }

  return {
    path: filePath,
    oldContent,
    newContent,
  };
}

export async function stageFiles(
  repoPath: string,
  files?: string[],
  all: boolean = false,
): Promise<void> {
  const args = ["add"];

  if (all) {
    args.push("-A");
  } else if (files && files.length > 0) {
    args.push("--");
    args.push(...files);
  } else {
    throw new Error("Must specify files or all");
  }

  const result = await runGitCommand(args, repoPath);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to stage files: ${result.stderr}`);
  }
}

export async function unstageFiles(
  repoPath: string,
  files?: string[],
  all: boolean = false,
): Promise<void> {
  const args = ["reset", "HEAD"];

  if (!all && files && files.length > 0) {
    args.push("--");
    args.push(...files);
  }

  const result = await runGitCommand(args, repoPath);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to unstage files: ${result.stderr}`);
  }
}

export async function commitChanges(
  repoPath: string,
  message: string,
): Promise<void> {
  if (!message || message.trim().length === 0) {
    throw new Error("Commit message cannot be empty");
  }

  const result = await runGitCommand(["commit", "-m", message], repoPath);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to commit: ${result.stderr}`);
  }
}

export async function discardChanges(
  repoPath: string,
  files: string[],
): Promise<void> {
  if (!files || files.length === 0) {
    throw new Error("Must specify files to discard");
  }

  const result = await runGitCommand(
    ["checkout", "HEAD", "--", ...files],
    repoPath,
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to discard changes: ${result.stderr}`);
  }
}

export async function listBranches(repoPath: string): Promise<GitBranch[]> {
  const result = await runGitCommand(["branch", "-a"], repoPath);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list branches: ${result.stderr}`);
  }

  const branches: GitBranch[] = [];
  const lines = result.stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    const current = line.startsWith("*");
    const name = line.substring(current ? 2 : 2).trim();

    if (name.startsWith("remotes/")) {
      const remoteName = name.substring("remotes/origin/".length);
      if (remoteName !== "HEAD" && !remoteName.includes("->")) {
        branches.push({ name: remoteName, current: false, remote: true });
      }
    } else {
      branches.push({ name, current, remote: false });
    }
  }

  return branches;
}

export async function switchBranch(
  repoPath: string,
  branchName: string,
  create: boolean = false,
): Promise<void> {
  if (!validateBranchName(branchName)) {
    throw new Error("Invalid branch name");
  }

  const args = create ? ["checkout", "-b", branchName] : ["checkout", branchName];

  const result = await runGitCommand(args, repoPath);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to switch branch: ${result.stderr}`);
  }
}

export async function pullChanges(repoPath: string): Promise<{ success: boolean; message: string }> {
  const statusCheck = await runGitCommand(["status", "--porcelain"], repoPath);

  if (statusCheck.stdout.trim().length > 0) {
    return {
      success: false,
      message: "Working tree has uncommitted changes. Commit or stash them before pulling.",
    };
  }

  const result = await runGitCommand(["pull", "--ff-only"], repoPath);

  if (result.exitCode === 0) {
    return { success: true, message: "Successfully pulled latest changes" };
  }

  if (result.stderr.includes("diverged") || result.stderr.includes("non-fast-forward")) {
    return {
      success: false,
      message: "Branch has diverged from remote. Fast-forward is not possible.",
    };
  }

  return { success: false, message: `Pull failed: ${result.stderr}` };
}

export async function pushChanges(repoPath: string): Promise<{ success: boolean; message: string }> {
  const branchResult = await runGitCommand(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    repoPath,
  );

  if (branchResult.exitCode !== 0) {
    return { success: false, message: "Failed to get current branch" };
  }

  const branch = branchResult.stdout.trim();

  const upstreamResult = await runGitCommand(
    ["rev-parse", "--abbrev-ref", "@{u}"],
    repoPath,
  );

  const hasUpstream = upstreamResult.exitCode === 0;

  const args = hasUpstream
    ? ["push"]
    : ["push", "--set-upstream", "origin", branch];

  const result = await runGitCommand(args, repoPath);

  if (result.exitCode === 0) {
    return {
      success: true,
      message: hasUpstream
        ? "Successfully pushed changes"
        : `Successfully pushed and set upstream to origin/${branch}`,
    };
  }

  if (result.stderr.includes("Authentication") || result.stderr.includes("Permission denied")) {
    return {
      success: false,
      message: "Authentication failed. Please ensure your credentials are configured.",
    };
  }

  return { success: false, message: `Push failed: ${result.stderr}` };
}
