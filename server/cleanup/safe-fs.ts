import fs from "node:fs/promises";
import path from "node:path";

/**
 * The only way client cleanup touches the disk.
 *
 * Deleting is the one thing here that cannot be undone, so it is deliberately
 * narrow: a folder is removed only when it is strictly inside a root that was
 * checked first, after symlinks are resolved on both sides, and never when the
 * target itself is a symlink. A path that fails any check is refused, not
 * "fixed up".
 */

export class UnsafePathError extends Error {}

export interface DirectorySize {
  bytes: number;
  files: number;
  /** The walk hit its limit, so the size is at least this. */
  approximate: boolean;
}

const MAX_ENTRIES = 400_000;

/** Total size of a folder, counting each file once and never following links out of it. */
export async function measureDirectory(directory: string, limit = MAX_ENTRIES): Promise<DirectorySize> {
  let bytes = 0;
  let files = 0;
  let seen = 0;
  const pending = [directory];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > limit) return { bytes, files, approximate: true };
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else {
        try {
          // lstat: a symlink counts as the link, not as what it points to.
          bytes += (await fs.lstat(full)).size;
          files += 1;
        } catch {
          // Gone while counting: it is not there to free.
        }
      }
    }
  }
  return { bytes, files, approximate: false };
}

/**
 * Resolves `target` and proves it is a real folder strictly inside `root`.
 * Returns the resolved path to delete. Throws `UnsafePathError` otherwise.
 */
export async function resolveInside(root: string, target: string): Promise<string> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    throw new UnsafePathError(`${root} is not there. If it is on an external drive, plug it in.`);
  }

  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new UnsafePathError(`${target} does not exist.`);
  }
  if (stat.isSymbolicLink()) throw new UnsafePathError(`${target} is a link, not a folder. It will not be followed or deleted.`);
  if (!stat.isDirectory()) throw new UnsafePathError(`${target} is not a folder.`);

  const realTarget = await fs.realpath(target);
  const relative = path.relative(realRoot, realTarget);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafePathError(`${target} is not inside ${realRoot}.`);
  }
  return realTarget;
}

/** Deletes a folder that `resolveInside` has proven is inside `root`. Not recoverable. */
export async function removeInside(root: string, target: string): Promise<void> {
  const proven = await resolveInside(root, target);
  await fs.rm(proven, { recursive: true, force: false, maxRetries: 2 });
}

/**
 * Files under `directory` other than the excluded paths (relative, with `/`).
 * For telling you what else is in a folder before it goes.
 */
export async function listFilesOutside(directory: string, excludeRelative: readonly string[], cap = 5000): Promise<{ total: number; examples: string[] }> {
  const excluded = excludeRelative.map((entry) => entry.replace(/^\/+|\/+$/g, ""));
  const isExcluded = (relative: string) => excluded.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
  const examples: string[] = [];
  let total = 0;
  let seen = 0;
  const pending = [""];

  while (pending.length > 0) {
    const relativeDir = pending.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(directory, relativeDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > cap) return { total, examples };
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (isExcluded(relative)) continue;
      if (entry.isDirectory()) pending.push(relative);
      else {
        total += 1;
        if (examples.length < 3) examples.push(relative);
      }
    }
  }
  return { total, examples };
}
