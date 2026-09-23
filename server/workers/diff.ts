import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkerDiff, WorkerDiffFile } from "../../shared/worker-types";

/**
 * What the worker actually changed, as a diff.
 *
 * This is the evidence everything downstream rests on: it is what Hermes
 * reviews and what the operator approves. It is read from git in the worktree
 * rather than assembled from anything a worker reported, so a worker cannot
 * influence what its own review sees.
 *
 * The work is deliberately still uncommitted at this point — workers are denied
 * `git commit`, and the commit is made by AgentOS only after approval. So the
 * diff has to cover untracked files too, which is what the intent-to-add pass
 * below is for.
 */

const run = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;

/** Enough to review by, bounded so one runaway job cannot fill a response. */
const MAX_TOTAL_PATCH_CHARS = 400_000;
const MAX_FILE_PATCH_CHARS = 60_000;

/** `git diff` output can be large; the buffer has to allow for it. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Git's status letter, spelled out for a person reading the list. */
const STATUS_LABEL: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
};

export function statusLabel(letter: string): string {
  return STATUS_LABEL[letter.charAt(0)] ?? letter;
}

async function git(
  worktreePath: string,
  args: string[],
): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: worktreePath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });

  return stdout;
}

/**
 * Splits one `git diff` into per-file patches.
 *
 * Keyed by the b-side path, which is the file as it now stands — the name a
 * reviewer is looking for, including after a rename.
 */
function splitPatches(diff: string): Map<string, string> {
  const patches = new Map<string, string>();

  for (const chunk of diff.split(/^diff --git /m)) {
    if (chunk.trim().length === 0) continue;

    const header = chunk.slice(0, chunk.indexOf("\n"));
    // `a/src/x.ts b/src/x.ts` — the b-side is everything after ` b/`.
    const match = /\sb\/(.+)$/.exec(header);
    if (!match) continue;

    patches.set(match[1].trim(), `diff --git ${chunk}`.trimEnd());
  }

  return patches;
}

/** `12  3  src/x.ts` — additions, deletions, path. `-` means binary. */
function readNumstat(output: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>();

  for (const line of output.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const path = parts.slice(2).join("\t").trim();
    if (path.length === 0) continue;

    counts.set(path, {
      added: Number.parseInt(parts[0], 10) || 0,
      removed: Number.parseInt(parts[1], 10) || 0,
    });
  }

  return counts;
}

/** `M\tsrc/x.ts`, or `R100\told\tnew` for a rename. */
function readNameStatus(output: string): { path: string; status: string }[] {
  const files: { path: string; status: string }[] = [];

  for (const line of output.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;

    // A rename carries both names; the new one is what the file is now.
    const path = (parts.length >= 3 ? parts[2] : parts[1]).trim();
    if (path.length === 0) continue;

    files.push({ path, status: statusLabel(parts[0]) });
  }

  return files;
}

/**
 * Reads the worktree's changes against the commit it branched from.
 *
 * Untracked files are registered with `--intent-to-add` first, which is what
 * makes them appear in `git diff` at all. It records their names in the index
 * and nothing else — no content is staged and no commit is made, so the
 * worktree is left as the worker left it.
 */
export async function readDiff(
  jobId: string,
  worktreePath: string,
  baseCommit: string | undefined,
): Promise<WorkerDiff> {
  const base = baseCommit ?? "HEAD";

  try {
    await git(worktreePath, ["add", "-A", "--intent-to-add"]);
  } catch {
    // Nothing to add, or an index that will not take it. The diff below is
    // still worth reading for whatever it can see.
  }

  let nameStatus: string;
  let numstat: string;
  let patch: string;

  try {
    nameStatus = await git(worktreePath, ["diff", "--name-status", base]);
    numstat = await git(worktreePath, ["diff", "--numstat", base]);
    patch = await git(worktreePath, ["diff", base]);
  } catch {
    // A diff that cannot be read is reported as no diff rather than as an
    // error: the caller still has a job to show, and an empty file list is
    // visibly wrong in a way an exception in the console is not.
    return { jobId, baseCommit, files: [], truncated: false };
  }

  const counts = readNumstat(numstat);
  const patches = splitPatches(patch);

  let budget = MAX_TOTAL_PATCH_CHARS;
  let truncated = false;

  const files: WorkerDiffFile[] = readNameStatus(nameStatus).map((entry) => {
    const count = counts.get(entry.path) ?? { added: 0, removed: 0 };
    const body = patches.get(entry.path);

    // A diff that will not fit is reported as a file with no patch rather than
    // as a shortened patch: half a hunk is worse than an honest omission.
    let included: string | undefined;

    if (body && body.length <= MAX_FILE_PATCH_CHARS && body.length <= budget) {
      included = body;
      budget -= body.length;
    } else if (body) {
      truncated = true;
    }

    return {
      path: entry.path,
      status: entry.status,
      additions: count.added,
      deletions: count.removed,
      patch: included,
    };
  });

  return { jobId, baseCommit, files, truncated };
}
