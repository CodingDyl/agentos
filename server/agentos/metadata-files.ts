import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./git";

/**
 * macOS `._*` sidecar files.
 *
 * On an exFAT, FAT or network drive macOS can't store a file's extended
 * attributes in the file itself, so it writes them to a second file named
 * `._<name>` beside it. Git sees them as untracked files, and ESLint, Vitest
 * and TypeScript read `._playwright.config.ts` as source and fail on its
 * binary contents. They carry nothing a project needs.
 *
 * Only untracked `._*` files are ever touched: a tracked one is somebody's
 * content, and is left alone.
 */

const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo"]);
const MAX_FILES = 5_000;
const MAX_DEPTH = 12;

/** Every `._*` file under the repository, relative to it, outside folders nobody lints. */
async function walk(root: string, dir = "", depth = 0, found: string[] = []): Promise<string[]> {
  if (depth > MAX_DEPTH || found.length >= MAX_FILES) return found;
  let entries;
  try {
    entries = await fs.readdir(path.join(root, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !entry.name.startsWith("._")) await walk(root, relative, depth + 1, found);
    } else if (entry.name.startsWith("._") && found.length < MAX_FILES) {
      found.push(relative);
    }
  }
  return found;
}

async function trackedSet(repoPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await git(repoPath, ["ls-files", "-z"]);
    return new Set(stdout.split("\0").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** The untracked sidecar files in a repository. */
export async function findMetadataFiles(repoPath: string): Promise<string[]> {
  const [files, tracked] = await Promise.all([walk(repoPath), trackedSet(repoPath)]);
  return files.filter((file) => !tracked.has(file));
}

/**
 * Keeps git from listing them again, without touching `.gitignore`: the
 * repository's own ignore rules are the project's, this one is the machine's.
 */
async function ignoreLocally(repoPath: string): Promise<void> {
  try {
    const { stdout } = await git(repoPath, ["rev-parse", "--git-path", "info/exclude"]);
    const file = path.resolve(repoPath, stdout.trim());
    const current = await fs.readFile(file, "utf8").catch(() => "");
    const wanted = ["._*", ".DS_Store"].filter((pattern) => !current.split("\n").includes(pattern));
    if (wanted.length === 0) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}# macOS sidecar files (added by AgentOS)\n${wanted.join("\n")}\n`);
  } catch {
    // Not fatal: the files are still removed.
  }
}

/** Deletes the untracked sidecar files and makes git ignore them. Returns how many were removed. */
export async function removeMetadataFiles(repoPath: string): Promise<number> {
  const files = await findMetadataFiles(repoPath);
  let removed = 0;
  for (const file of files) {
    try {
      await fs.rm(path.join(repoPath, file), { force: true });
      removed += 1;
    } catch {
      // Left in place; the count says what actually went.
    }
  }
  await ignoreLocally(repoPath);
  return removed;
}
