import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { uiStateDir } from "../agentos/session-store";

/**
 * Dependencies in a job's worktree, before a worker is started.
 *
 * Worktrees do not carry `node_modules`. A Next.js job that cannot see
 * `node_modules/next` spends tokens and then quits. Preparing here — clone or
 * copy from the source checkout, reuse a lockfile cache, or install — means
 * the worker starts with a tree that builds.
 *
 * Next, Vite and other bundlers resolve packages from the workspace root and
 * will not follow a `node_modules` symlink that points outside it. Turbopack
 * fails with "Could not find the Next.js package (next/package.json)" in that
 * case, even though the same diff builds in the real checkout. Bundler
 * projects therefore get a real directory (APFS clonefile when it works, a
 * copy otherwise, `npm ci --prefer-offline` as the last resort). Other
 * projects may still symlink.
 */

export type DepsMethod = "symlink" | "clone" | "copy" | "install" | "none";

export interface DepsPreparation {
  ok: boolean;
  method: DepsMethod;
  detail: string;
}

/** Bundlers that refuse `node_modules` as a symlink out of the workspace. */
const WORKSPACE_BUNDLERS = [
  "next",
  "vite",
  "nuxt",
  "astro",
  "@sveltejs/kit",
  "react-scripts",
  "turbo",
  "webpack",
] as const;

const LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "package-lock.json"] as const;

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
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

/**
 * True when the project's bundler will not resolve packages through a
 * `node_modules` symlink that points outside the worktree.
 */
export function needsInTreeNodeModules(manifest: Record<string, unknown> | undefined): boolean {
  if (!manifest) return false;
  const deps = {
    ...((manifest.dependencies ?? {}) as object),
    ...((manifest.devDependencies ?? {}) as object),
    ...((manifest.optionalDependencies ?? {}) as object),
  };
  if (WORKSPACE_BUNDLERS.some((name) => name in deps)) return true;
  const scripts = Object.values((manifest.scripts ?? {}) as Record<string, unknown>);
  return scripts.some(
    (script) => typeof script === "string" && /\b(next|vite|nuxt|astro|webpack)\b/.test(script),
  );
}

function installCommand(manager: PackageManager, hasLockfile: boolean): { command: string; args: string[] } {
  switch (manager) {
    case "pnpm":
      return { command: "pnpm", args: ["install", "--frozen-lockfile", "--prefer-offline"] };
    case "yarn":
      return {
        command: "yarn",
        args: hasLockfile ? ["install", "--frozen-lockfile", "--prefer-offline"] : ["install", "--prefer-offline"],
      };
    case "bun":
      return { command: "bun", args: ["install"] };
    default:
      return {
        command: "npm",
        args: hasLockfile ? ["ci", "--prefer-offline"] : ["install", "--prefer-offline"],
      };
  }
}

function runCommand(command: string, args: string[], cwd?: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: cwd ? ["ignore", "pipe", "pipe"] : "ignore",
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

function runInstall(command: string, args: string[], cwd: string): Promise<{ ok: boolean; detail: string }> {
  return runCommand(command, args, cwd);
}

/**
 * Removes a `node_modules` path without following it. A symlink back to the
 * source checkout must be unlinked, never recursively deleted — that would
 * wipe the operator's real install.
 */
async function removeModules(target: string): Promise<void> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || stat.isFile()) {
      await fs.unlink(target);
      return;
    }
  } catch {
    return;
  }
  await fs.rm(target, { recursive: true, force: true });
}

async function isOutsideSymlink(modulesDir: string, worktreeDir: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(modulesDir);
    if (!stat.isSymbolicLink()) return false;
    const real = await fs.realpath(modulesDir);
    const root = path.resolve(worktreeDir);
    const relative = path.relative(root, real);
    return relative.startsWith("..") || path.isAbsolute(relative);
  } catch {
    return true;
  }
}

async function fingerprintLockfile(directory: string, names: readonly string[]): Promise<string | undefined> {
  const lock = LOCKFILES.find((name) => names.includes(name));
  const file = lock ?? (names.includes("package.json") ? "package.json" : undefined);
  if (!file) return undefined;
  try {
    const contents = await fs.readFile(path.join(directory, file));
    return createHash("sha256").update(contents).digest("hex").slice(0, 32);
  } catch {
    return undefined;
  }
}

function cacheModulesPath(fingerprint: string): string {
  return path.join(uiStateDir(), "module-cache", fingerprint, "node_modules");
}

async function lockfilesMatch(sourceDir: string, worktreeDir: string, names: readonly string[]): Promise<boolean> {
  const lock = LOCKFILES.find((name) => names.includes(name));
  if (!lock) return true;
  try {
    const [worktreeLock, sourceLock] = await Promise.all([
      fs.readFile(path.join(worktreeDir, lock)),
      fs.readFile(path.join(sourceDir, lock)),
    ]);
    return worktreeLock.equals(sourceLock);
  } catch {
    return false;
  }
}

/**
 * APFS clonefile (`cp -c`): copy-on-write, same-volume, and fast. Fails across
 * volumes and on filesystems that do not support it — callers fall back.
 */
async function tryClonefile(source: string, target: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await removeModules(target);
  const result = await runCommand("cp", ["-c", "-R", source, target]);
  if (result.ok) return true;
  await removeModules(target);
  return false;
}

async function tryCopy(source: string, target: string): Promise<boolean> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await removeModules(target);
  try {
    await fs.cp(source, target, {
      recursive: true,
      dereference: true,
      errorOnExist: false,
      mode: constants.COPYFILE_FICLONE,
    });
    return true;
  } catch {
    try {
      await fs.cp(source, target, { recursive: true, dereference: true, errorOnExist: false });
      return true;
    } catch {
      await removeModules(target);
      return false;
    }
  }
}

async function materializeDirectory(
  source: string,
  target: string,
  allowSymlink: boolean,
): Promise<DepsMethod | undefined> {
  if (allowSymlink) {
    try {
      await fs.symlink(source, target, "dir");
      return "symlink";
    } catch {
      // Across filesystems, or where symlinks are refused, clone or copy instead.
    }
  }

  if (await tryClonefile(source, target)) return "clone";
  if (await tryCopy(source, target)) return "copy";
  return undefined;
}

async function populateCache(fingerprint: string, modules: string): Promise<void> {
  const cached = cacheModulesPath(fingerprint);
  if (await exists(cached)) return;
  try {
    const stat = await fs.lstat(modules);
    if (stat.isSymbolicLink()) return;
  } catch {
    return;
  }
  const method = await materializeDirectory(modules, cached, false);
  if (!method) await removeModules(cached);
}

/**
 * Ensures `worktreeDir` has the dependencies `sourceDir` already built.
 *
 * No `package.json` means there is nothing to prepare. An existing real
 * `node_modules` in the worktree is left alone. A leftover symlink out of the
 * worktree on a bundler project is replaced: that is the tree Turbopack
 * cannot build from.
 */
export async function prepareWorktreeDependencies(
  sourceDir: string,
  worktreeDir: string,
): Promise<DepsPreparation> {
  if (!(await exists(path.join(worktreeDir, "package.json")))) {
    return { ok: true, method: "none", detail: "No package.json in the project folder." };
  }

  const manifest = await readJson(path.join(worktreeDir, "package.json"));
  const inTree = needsInTreeNodeModules(manifest);
  const worktreeModules = path.join(worktreeDir, "node_modules");

  try {
    const existing = await fs.lstat(worktreeModules);
    const outside = await isOutsideSymlink(worktreeModules, worktreeDir);
    if (inTree && outside) {
      await removeModules(worktreeModules);
    } else if (existing.isSymbolicLink() && !(await exists(worktreeModules))) {
      await removeModules(worktreeModules);
    } else {
      return { ok: true, method: "none", detail: "Dependencies are already present in the worktree." };
    }
  } catch {
    // Nothing there yet.
  }

  const names = await fs.readdir(worktreeDir).catch(() => [] as string[]);
  const fingerprint = await fingerprintLockfile(worktreeDir, names);
  const sourceModules = path.join(sourceDir, "node_modules");
  const cached = fingerprint ? cacheModulesPath(fingerprint) : undefined;
  const sourceUsable =
    path.resolve(sourceDir) !== path.resolve(worktreeDir) &&
    (await exists(sourceModules)) &&
    (await lockfilesMatch(sourceDir, worktreeDir, names));

  const candidates: Array<{ source: string; label: string }> = [];
  if (cached && (await exists(cached))) {
    const entries = await fs.readdir(cached).catch(() => [] as string[]);
    if (entries.length > 0) {
      candidates.push({ source: cached, label: "the dependency cache" });
    }
  }
  if (sourceUsable) {
    candidates.push({ source: sourceModules, label: "the source checkout" });
  }

  for (const candidate of candidates) {
    const method = await materializeDirectory(candidate.source, worktreeModules, !inTree);
    if (!method) continue;
    if (fingerprint && method !== "symlink") {
      await populateCache(fingerprint, worktreeModules).catch(() => undefined);
    }
    const verb =
      method === "symlink" ? "Linked" : method === "clone" ? "Cloned" : "Copied";
    return {
      ok: true,
      method,
      detail: `${verb} node_modules from ${candidate.label}.`,
    };
  }

  const manager = detectPackageManager(worktreeDir, names);
  const hasLockfile = LOCKFILES.some((name) => names.includes(name));
  const { command, args } = installCommand(manager, hasLockfile);
  const installed = await runInstall(command, args, worktreeDir);
  if (installed.ok && fingerprint) {
    await populateCache(fingerprint, worktreeModules).catch(() => undefined);
  }
  return {
    ok: installed.ok,
    method: "install",
    detail: installed.ok
      ? `Installed dependencies with ${command} ${args.join(" ")}.`
      : installed.detail,
  };
}
