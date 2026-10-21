import fs from "node:fs/promises";
import path from "node:path";
import { gitCommonDir, gitDir } from "../agentos/git";

/**
 * Git metadata a sandboxed worker must be allowed to write.
 *
 * A git worktree's `.git` is a pointer file. The real gitdir lives under the
 * source repository (`<repo>/.git/worktrees/<id>`), and the common dir is
 * `<repo>/.git`. Codex's workspace-write sandbox, limited to the worktree,
 * refuses every git command with "Git metadata is outside the writable
 * sandbox" unless those two directories are extra writable roots.
 */

export interface GitWritableRoots {
  gitDir: string;
  commonDir: string;
  extraRoots: string[];
}

function uniqueAbsolute(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

/**
 * The gitdir and common dir a worktree uses, both of which sit outside it.
 *
 * Returns `undefined` when the path is not a repository — preflight then
 * reports that rather than inventing roots.
 */
export async function gitWritableRoots(worktreePath: string): Promise<GitWritableRoots | undefined> {
  const dir = await gitDir(worktreePath);
  const common = await gitCommonDir(worktreePath);
  if (!dir || !common) return undefined;

  return {
    gitDir: dir,
    commonDir: common,
    extraRoots: uniqueAbsolute([dir, common]),
  };
}

async function canWrite(target: string): Promise<boolean> {
  try {
    await fs.access(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why git is not writable for a sandboxed worker, in words a person can act on.
 */
export async function gitWritableProblem(
  worktreePath: string,
  roots: GitWritableRoots | undefined = undefined,
): Promise<string | undefined> {
  const resolved = roots ?? (await gitWritableRoots(worktreePath));
  if (!resolved) {
    return `${worktreePath} is not a git checkout AgentOS can write.`;
  }

  for (const target of resolved.extraRoots) {
    if (!(await canWrite(target))) {
      return `Git metadata at ${target} is not writable. The worker sandbox cannot run git status, diff or commit until that folder is writable.`;
    }
  }

  return undefined;
}

/**
 * Codex flags that add git metadata to the writable sandbox.
 *
 * `--add-dir` lets the agent see the folder; `writable_roots` lets the
 * workspace-write sandbox actually write index locks inside it.
 */
export function codexSandboxFlags(cwd: string, extraRoots: readonly string[]): string[] {
  const flags: string[] = [];
  const roots = uniqueAbsolute(extraRoots.filter((root) => path.resolve(root) !== path.resolve(cwd)));

  for (const root of roots) {
    flags.push("--add-dir", root);
  }

  if (roots.length > 0) {
    const encoded = roots.map((root) => JSON.stringify(root)).join(", ");
    flags.push("-c", `sandbox_workspace_write.writable_roots=[${encoded}]`);
  }

  return flags;
}

/** Gemini CLI: extra directories the run may read. */
export function geminiIncludeFlags(extraRoots: readonly string[]): string[] {
  if (extraRoots.length === 0) return [];
  return ["--include-directories", extraRoots.join(",")];
}
