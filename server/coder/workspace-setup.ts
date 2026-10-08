import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const WORKSPACE_SLUG_REGEX = /^[a-z0-9][a-z0-9-_]*$/;

const CODER_ROOT = path.join(os.homedir(), "AgentOS", "coder");

export function getWorkspaceClonePath(workspaceSlug: string): string {
  if (!WORKSPACE_SLUG_REGEX.test(workspaceSlug)) {
    throw new Error(`Invalid workspace slug: ${workspaceSlug}`);
  }
  return path.join(CODER_ROOT, workspaceSlug);
}

function validateRepoUrl(repoUrl: string): boolean {
  const gitUrlPattern = /^(https:\/\/|git@|ssh:\/\/)/;
  return gitUrlPattern.test(repoUrl) && !repoUrl.includes(";") && !repoUrl.includes("&") && !repoUrl.includes("|");
}

export async function cloneRepository(repoUrl: string, targetPath: string): Promise<void> {
  if (!validateRepoUrl(repoUrl)) {
    throw new Error("Invalid repository URL");
  }

  await fs.mkdir(CODER_ROOT, { recursive: true });

  const realTarget = await fs.realpath(path.dirname(targetPath));
  const expectedParent = await fs.realpath(CODER_ROOT);
  const relPath = path.relative(expectedParent, realTarget);

  if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
    throw new Error("Clone target must be within managed coder directory");
  }

  try {
    await fs.access(targetPath);
    throw new Error("Directory already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return new Promise((resolve, reject) => {
    const existingGitSsh = process.env.GIT_SSH_COMMAND || "ssh";
    const gitSshWithBatch = existingGitSsh.includes("-o BatchMode")
      ? existingGitSsh
      : `${existingGitSsh} -o BatchMode=yes`;

    const git = spawn("git", ["clone", "--", repoUrl, targetPath], {
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: gitSshWithBatch,
      },
    });

    let stderr = "";

    const timeout = setTimeout(() => {
      git.kill("SIGTERM");
      reject(new Error("Clone timed out after 5 minutes"));
    }, 300000);

    git.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    git.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        if (stderr.includes("Authentication failed") || stderr.includes("Permission denied") || stderr.includes("could not read")) {
          reject(new Error("Authentication failed. Please configure SSH keys or use a personal access token. Details: " + stderr));
        } else if (stderr.includes("Repository not found")) {
          reject(new Error("Repository not found. Check the URL and access permissions."));
        } else {
          reject(new Error(`Git clone failed: ${stderr}`));
        }
      }
    });

    git.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start git: ${error.message}`));
    });
  });
}

export async function pullRepository(repoPath: string): Promise<{ success: boolean; message: string }> {
  const realPath = await fs.realpath(repoPath);

  return new Promise((resolve) => {
    const gitStatus = spawn("git", ["status", "--porcelain"], {
      cwd: realPath,
      stdio: "pipe",
    });

    let statusOutput = "";

    gitStatus.stdout?.on("data", (data) => {
      statusOutput += data.toString();
    });

    gitStatus.on("close", (code) => {
      if (code !== 0) {
        resolve({ success: false, message: "Failed to check git status" });
        return;
      }

      if (statusOutput.trim().length > 0) {
        resolve({
          success: false,
          message: "Working tree has uncommitted changes. Commit or stash them before pulling.",
        });
        return;
      }

      const existingGitSsh = process.env.GIT_SSH_COMMAND || "ssh";
      const gitSshWithBatch = existingGitSsh.includes("-o BatchMode")
        ? existingGitSsh
        : `${existingGitSsh} -o BatchMode=yes`;

      const gitPull = spawn("git", ["pull", "--ff-only"], {
        cwd: realPath,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: gitSshWithBatch,
        },
      });

      let pullStderr = "";

      const timeout = setTimeout(() => {
        gitPull.kill("SIGTERM");
        resolve({ success: false, message: "Pull timed out after 2 minutes" });
      }, 120000);

      gitPull.stderr?.on("data", (data) => {
        pullStderr += data.toString();
      });

      gitPull.on("close", (pullCode) => {
        clearTimeout(timeout);
        if (pullCode === 0) {
          resolve({ success: true, message: "Successfully pulled latest changes" });
        } else {
          if (pullStderr.includes("diverged") || pullStderr.includes("non-fast-forward")) {
            resolve({
              success: false,
              message: "Branch has diverged from remote. Fast-forward is not possible.",
            });
          } else if (pullStderr.includes("Authentication failed") || pullStderr.includes("Permission denied") || pullStderr.includes("could not read")) {
            resolve({
              success: false,
              message: "Authentication failed. Please configure SSH keys or use a personal access token.",
            });
          } else {
            resolve({ success: false, message: `Pull failed: ${pullStderr}` });
          }
        }
      });
    });
  });
}

export async function detectPackageManager(repoPath: string): Promise<"npm" | "pnpm" | "yarn" | "bun" | null> {
  try {
    const files = await fs.readdir(repoPath);

    if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
    if (files.includes("pnpm-lock.yaml")) return "pnpm";
    if (files.includes("yarn.lock")) return "yarn";
    if (files.includes("package-lock.json")) return "npm";

    if (files.includes("package.json")) {
      return "npm";
    }

    return null;
  } catch {
    return null;
  }
}

export async function detectDevCommand(repoPath: string): Promise<string | null> {
  try {
    const packageJsonPath = path.join(repoPath, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    const scripts = packageJson.scripts || {};

    if (scripts.dev) return "dev";
    if (scripts.develop) return "develop";
    if (scripts.start) return "start";

    return null;
  } catch {
    return null;
  }
}

export async function setupEnvFile(repoPath: string): Promise<{ created: boolean; missingKeys: string[] }> {
  const envExamplePath = path.join(repoPath, ".env.example");
  const envTemplatePath = path.join(repoPath, ".env.template");
  const envLocalPath = path.join(repoPath, ".env.local");
  const envPath = path.join(repoPath, ".env");

  try {
    await fs.access(envPath);
    return { created: false, missingKeys: [] };
  } catch {
    // .env doesn't exist, continue
  }

  try {
    await fs.access(envLocalPath);
    return { created: false, missingKeys: [] };
  } catch {
    // .env.local doesn't exist, continue
  }

  let examplePath: string;

  try {
    await fs.access(envExamplePath);
    examplePath = envExamplePath;
  } catch {
    try {
      await fs.access(envTemplatePath);
      examplePath = envTemplatePath;
    } catch {
      return { created: false, missingKeys: [] };
    }
  }

  const exampleContent = await fs.readFile(examplePath, "utf-8");
  await fs.writeFile(envLocalPath, exampleContent, "utf-8");

  const missingKeys: string[] = [];
  const lines = exampleContent.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const match = /^([A-Z_][A-Z0-9_]*)=/.exec(trimmed);
      if (match) {
        const key = match[1];
        const value = trimmed.substring(key.length + 1);
        if (!value || value.startsWith("your_") || value.startsWith("TODO") || value === '""' || value === "''") {
          missingKeys.push(key);
        }
      }
    }
  }

  return { created: true, missingKeys };
}
