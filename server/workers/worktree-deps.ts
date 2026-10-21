import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Dependencies in a job's worktree, before a worker is started.
 *
 * Worktrees do not carry `node_modules`. A Next.js job that cannot see
 * `node_modules/next/dist/docs/` spends tokens and then quits. Preparing
 * here — symlink from the source checkout, copy if a symlink cannot cross
 * filesystems, or install — means the worker starts with a tree that builds.
 */

export type DepsMethod = "symlink" | "copy" | "install" | "none";

export interface DepsPreparation {
  ok: boolean;
  method: DepsMethod;
  detail: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(_directory: string, names: readonly string[]): PackageManager {
  if (names.includes("pnpm-lock.yaml")) return "pnpm";
  if (names.includes("yarn.lock")) return "yarn";
  if (names.includes("bun.lockb") || names.includes("bun.lock")) return "bun";
  if (names.includes("package-lock.json")) return "npm";
  return "npm";
}

function installCommand(manager: PackageManager, hasLockfile: boolean): { command: string; args: string[] } {
  switch (manager) {
    case "pnpm":
      return { command: "pnpm", args: ["install", "--frozen-lockfile"] };
    case "yarn":
      return { command: "yarn", args: hasLockfile ? ["install", "--frozen-lockfile"] : ["install"] };
    case "bun":
      return { command: "bun", args: ["install"] };
    default:
      return { command: "npm", args: hasLockfile ? ["ci"] : ["install"] };
  }
}

function runInstall(command: string, args: string[], cwd: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const capture = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-4_000);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
    }, 10 * 60 * 1000);

    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: `Could not run ${command}: ${error.message}` });
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, detail: `${command} ${args.join(" ")} finished.` });
        return;
      }
      const tail = output.trim().split("\n").filter(Boolean).slice(-6).join(" ");
      resolve({
        ok: false,
        detail: `${command} ${args.join(" ")} exited ${code ?? "unknown"}.${tail ? ` ${tail}` : ""}`,
      });
    });
  });
}

async function linkOrCopyModules(source: string, target: string): Promise<DepsMethod> {
  try {
    await fs.symlink(source, target, "dir");
    return "symlink";
  } catch {
    // Across filesystems, or where symlinks are refused, copy instead.
    await fs.cp(source, target, { recursive: true, dereference: true, errorOnExist: false });
    return "copy";
  }
}

/**
 * Ensures `worktreeDir` has the dependencies `sourceDir` already built.
 *
 * No `package.json` means there is nothing to prepare. An existing
 * `node_modules` in the worktree is left alone.
 */
export async function prepareWorktreeDependencies(
  sourceDir: string,
  worktreeDir: string,
): Promise<DepsPreparation> {
  if (!(await exists(path.join(worktreeDir, "package.json")))) {
    return { ok: true, method: "none", detail: "No package.json in the project folder." };
  }

  const worktreeModules = path.join(worktreeDir, "node_modules");
  if (await exists(worktreeModules)) {
    return { ok: true, method: "none", detail: "Dependencies are already present in the worktree." };
  }

  const sourceModules = path.join(sourceDir, "node_modules");
  if (await exists(sourceModules)) {
    try {
      const method = await linkOrCopyModules(sourceModules, worktreeModules);
      return {
        ok: true,
        method,
        detail:
          method === "symlink"
            ? "Linked node_modules from the source checkout."
            : "Copied node_modules from the source checkout.",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, method: "copy", detail: `Could not reuse node_modules from the source checkout: ${detail}` };
    }
  }

  const names = await fs.readdir(worktreeDir).catch(() => [] as string[]);
  const manager = detectPackageManager(worktreeDir, names);
  const hasLockfile =
    names.includes("package-lock.json") ||
    names.includes("pnpm-lock.yaml") ||
    names.includes("yarn.lock") ||
    names.includes("bun.lockb") ||
    names.includes("bun.lock");
  const { command, args } = installCommand(manager, hasLockfile);
  const installed = await runInstall(command, args, worktreeDir);
  return {
    ok: installed.ok,
    method: "install",
    detail: installed.ok
      ? `Installed dependencies with ${command} ${args.join(" ")}.`
      : installed.detail,
  };
}
