import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Access to the AgentOS vault.
 *
 * Every path is resolved against `AGENTOS_ROOT` and rejected if it escapes it,
 * so a traversal segment can never reach the wider filesystem.
 *
 * This module was read-only until project tasks became delegatable, and the
 * single exception is `writeAgentOSFile`. It exists so that a task a person
 * has approved can be ticked off in `TASKS.md` — the vault is the project's
 * canonical state, so closing a task anywhere else would leave the file
 * disagreeing with the console about what is finished.
 *
 * Nothing in this module moves or deletes, and nothing calls the write except
 * a change an operator has explicitly approved.
 */

/**
 * Where the vault is.
 *
 * Read on each call rather than captured once at import. A module-level
 * constant is resolved the instant anything imports this file, which makes the
 * root impossible to point elsewhere afterwards — including in a test, where
 * the alternative is running the vault's write path against the operator's own
 * notes.
 */
export function agentOSRoot(): string {
  return process.env.AGENTOS_ROOT ?? path.join(os.homedir(), "AgentOS");
}

/** Resolves a vault-relative path, refusing anything that escapes the root. */
function resolveWithinRoot(relativePath: string): string {
  const root = path.resolve(agentOSRoot());
  const fullPath = path.resolve(root, relativePath);

  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error(`Invalid AgentOS path: ${relativePath}`);
  }

  return fullPath;
}

/** Reads a vault file as UTF-8. Throws if it is missing — see `readOptionalFile`. */
export async function readAgentOSFile(relativePath: string): Promise<string> {
  return fs.readFile(resolveWithinRoot(relativePath), "utf8");
}

/**
 * Reads a vault file, or returns `undefined` when it does not exist.
 *
 * The vault is hand-maintained, so an absent optional file is a normal state,
 * not a failure. Genuine errors (permissions, a directory where a file was
 * expected) still surface.
 */
export async function readOptionalFile(
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readAgentOSFile(relativePath);
  } catch (error) {
    if (isMissingEntry(error)) return undefined;
    throw error;
  }
}

export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(resolveWithinRoot(relativePath));
    return stats.isFile();
  } catch (error) {
    if (isMissingEntry(error)) return false;
    throw error;
  }
}

/** Lists a directory's entry names, or `[]` when the directory is absent. */
export async function listDirectory(relativePath: string): Promise<string[]> {
  try {
    return await fs.readdir(resolveWithinRoot(relativePath));
  } catch (error) {
    if (isMissingEntry(error)) return [];
    throw error;
  }
}

/**
 * Markdown file names in a directory, newest-sorting last.
 *
 * AgentOS logs are date-stamped (`2026-09-05.md`), so lexicographic order is
 * chronological order.
 */
export async function listMarkdownFiles(
  relativePath: string,
): Promise<string[]> {
  const entries = await listDirectory(relativePath);
  return entries.filter((entry) => entry.endsWith(".md")).sort();
}

/**
 * When a vault file was last written, or `undefined` when it does not exist.
 *
 * The activity timeline is built from this: an AgentOS log records *what*
 * happened, and the filesystem records *when* it was written down.
 */
export async function fileModifiedAt(
  relativePath: string,
): Promise<Date | undefined> {
  try {
    return (await fs.stat(resolveWithinRoot(relativePath))).mtime;
  } catch (error) {
    if (isMissingEntry(error)) return undefined;
    throw error;
  }
}

/**
 * Most recent modification time across the given files, ignoring any that are
 * absent. Used as a project's last-activity signal.
 */
export async function statNewest(
  relativePaths: readonly string[],
): Promise<Date | undefined> {
  const times = await Promise.all(
    relativePaths.map(async (relativePath) => {
      try {
        return (await fs.stat(resolveWithinRoot(relativePath))).mtime;
      } catch (error) {
        if (isMissingEntry(error)) return undefined;
        throw error;
      }
    }),
  );

  const newest = times
    .filter((time): time is Date => time !== undefined)
    .sort((a, b) => b.getTime() - a.getTime())
    .at(0);

  return newest;
}

function isMissingEntry(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Replaces one vault file, atomically.
 *
 * Written through a temporary and renamed, because these are files a person
 * maintains by hand: a half-written `TASKS.md` would be a project losing its
 * own account of itself, which is a far worse outcome than a failed write.
 *
 * Callers are expected to have read the file, changed as little as possible,
 * and had that change approved. This function does not know what a task is and
 * deliberately makes no attempt to check the content it is given.
 */
export async function writeAgentOSFile(
  relativePath: string,
  contents: string,
): Promise<void> {
  const target = resolveWithinRoot(relativePath);
  const temporary = `${target}.${process.pid}.tmp`;

  // A brief may be the first thing a project puts in `design/`.
  await fs.mkdir(path.dirname(target), { recursive: true });

  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, target);
}
