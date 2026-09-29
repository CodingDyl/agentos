import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GitFileChange, ProjectGit } from "../../shared/agentos-types";

/**
 * The one place AgentOS runs git.
 *
 * Every git command in the server goes through `git()` here, which exists so
 * there is a single answer to two questions that would otherwise be answered
 * differently in each caller: how long a command may take, and how its
 * arguments are built.
 *
 * Arguments are always an array. Nothing in this file interpolates a branch
 * name, a path or a message into a shell string, so a branch called
 * `; rm -rf ~` is a branch with an unfortunate name and not an incident.
 *
 * The reads below are deliberately total: a repository that cannot be read
 * answers "unknown" rather than throwing, because they are called to *decide*
 * things — whether a job may integrate, what to show on a page — and a thrown
 * error at that point turns a question into a crash. Writes are the opposite
 * and live in `repository.ts`, where failing loudly is the point.
 */

const run = promisify(execFile);

/** Long enough for a slow status on a large repository, short enough to fail. */
export const GIT_TIMEOUT_MS = 30_000;

/**
 * Field separator for `--format` output.
 *
 * ASCII unit separator, because a commit subject is operator text and will
 * eventually contain whichever printable character seemed safe to split on.
 */
const UNIT = "";

export interface GitResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs one git command in one repository.
 *
 * Throws on a non-zero exit. Callers that want a question answered rather than
 * an error raised use the helpers below, which swallow the failure and say so
 * in their return type.
 */
export async function git(
  repoPath: string,
  args: readonly string[],
  timeout = GIT_TIMEOUT_MS,
): Promise<GitResult> {
  const { stdout, stderr } = await run("git", [...args], {
    cwd: repoPath,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });

  return { stdout, stderr };
}

/** The trimmed stdout of a command, or `undefined` if it failed at all. */
async function ask(
  repoPath: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const { stdout } = await git(repoPath, args);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether this path is a git repository we can work in. */
/** `~` and `~/x` to the home directory. Nothing else is touched: a path that is already absolute stays as written. */
export function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, os.homedir());
}

/**
 * Why a repository path can't be used, in words a person can act on.
 *
 * An external drive that isn't plugged in and a folder that was never a repo
 * look identical to `git rev-parse`, and only one of them is fixed by looking
 * at the path. `/Volumes/<name>` is where macOS mounts every external drive,
 * so a missing mount point under it means the drive, not the project.
 */
export async function repositoryProblem(repoPath: string): Promise<string> {
  const mount = /^\/Volumes\/([^/]+)/.exec(repoPath);
  if (mount && !(await isDirectory(path.join("/Volumes", mount[1])))) {
    return `The drive "${mount[1]}" isn't connected. Plug it in and reload; ${repoPath} will be read again.`;
  }
  if (!(await isDirectory(repoPath))) {
    return `${repoPath} doesn't exist. If it moved, update Local repository in the workspace's settings.`;
  }
  return `${repoPath} is not a git repository.`;
}

export async function isRepository(repoPath: string): Promise<boolean> {
  if (!repoPath || !(await isDirectory(repoPath))) return false;

  return (await ask(repoPath, ["rev-parse", "--is-inside-work-tree"])) === "true";
}

/** The commit a repository is currently on. */
export async function headCommit(repoPath: string): Promise<string | undefined> {
  return ask(repoPath, ["rev-parse", "HEAD"]);
}

/**
 * The branch a repository is on, or `undefined` on a detached HEAD.
 *
 * A detached HEAD has no branch to merge into, which is a reason to refuse an
 * integration rather than a detail to paper over.
 */
export async function currentBranch(
  repoPath: string,
): Promise<string | undefined> {
  return ask(repoPath, ["branch", "--show-current"]);
}

/** Whether a checkout has no uncommitted changes of its own. */
export async function isClean(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await git(repoPath, ["status", "--porcelain", "-uall"]);
    return stdout.trim().length === 0;
  } catch {
    // A repository that cannot be read is not known to be clean, and this
    // answer gates an integration.
    return false;
  }
}

/** One uncommitted path, and what git says happened to it. */
export interface ChangedFile {
  path: string;
  /** The two-letter porcelain code, e.g. ` M`, `??`, `R `. */
  code: string;
  staged: boolean;
  untracked: boolean;
}

/**
 * Every uncommitted path in a checkout.
 *
 * `-uall` matters: without it git collapses a new directory into a single
 * `tmp/` entry, and a job that created six files would report one. This list
 * is meant to be reviewable, so it names every file rather than the directory
 * they landed in.
 */
export async function uncommittedFiles(repoPath: string): Promise<ChangedFile[]> {
  try {
    const { stdout } = await git(repoPath, ["status", "--porcelain", "-uall"]);

    return stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 2)
      .map((line) => {
        const code = line.slice(0, 2);
        // A rename reads `R  old -> new`; the new name is the one that exists.
        const file = line.slice(2).trim().split(" -> ").at(-1) ?? "";

        return {
          path: file,
          code,
          staged: code[0] !== " " && code[0] !== "?",
          untracked: code === "??",
        };
      })
      .filter((entry) => entry.path.length > 0);
  } catch {
    return [];
  }
}

/**
 * Porcelain codes as words.
 *
 * React never sees a two-letter git code. The mapping is deliberately small:
 * the index and work-tree columns collapse to whichever one says something,
 * because a project page wants to know that a file changed, not how far along
 * the staging pipeline it is.
 */
const STATUS_WORDS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflicted",
  "?": "New",
  "!": "Ignored",
};

/**
 * Reads `git status --porcelain` into labelled changes.
 *
 * Exported separately from the command that produces it so the parsing can be
 * tested against real porcelain output without a repository on disk.
 */
export function parseGitStatus(porcelain: string): GitFileChange[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && line.length > 2)
    .map((line) => {
      // Whichever column speaks. ` M` is a work-tree change, `A ` an indexed
      // one, and `??` is untracked in both.
      const letter = line[0] !== " " ? line[0] : line[1];
      // A rename reads `R  old -> new`; the new name is the one that exists.
      const file = line.slice(2).trim().split(" -> ").at(-1) ?? "";

      return { status: STATUS_WORDS[letter] ?? "Changed", path: file };
    })
    .filter((change) => change.path.length > 0);
}

/**
 * A project's git state, for the project page.
 *
 * Total by design: a project whose `PROJECT.md` links no repository, or links
 * one that has since moved, still has a page worth rendering. Each of those
 * answers is a sentence in `unavailable` rather than a thrown error.
 */
export async function readGitStatus(
  repositoryPath: string | undefined,
): Promise<ProjectGit> {
  if (!repositoryPath) return { changedFiles: [] };

  if (!(await isRepository(repositoryPath))) {
    return {
      repositoryPath,
      changedFiles: [],
      unavailable: await repositoryProblem(repositoryPath),
    };
  }

  try {
    const { stdout } = await git(repositoryPath, ["status", "--porcelain", "-uall"]);
    const changedFiles = parseGitStatus(stdout);

    return {
      repositoryPath,
      branch: await currentBranch(repositoryPath),
      workingTree: changedFiles.length === 0 ? "clean" : "modified",
      changedFiles,
    };
  } catch (error) {
    return {
      repositoryPath,
      changedFiles: [],
      unavailable: `Git could not read that repository: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
    };
  }
}

/** One local branch, as the repository view shows it. */
export interface BranchSummary {
  name: string;
  current: boolean;
  /** Commits this branch has that its upstream does not. */
  ahead: number;
  /** Commits its upstream has that this branch does not. */
  behind: number;
  /** Absent when the branch tracks nothing. */
  upstream?: string;
  /** When its tip was committed, ISO 8601. */
  lastCommitAt?: string;
  lastCommitSubject?: string;
}

/**
 * Every local branch, newest first.
 *
 * `%(upstream:track)` is git's own ahead/behind count and reads as
 * `[ahead 2, behind 1]`, `[gone]`, or nothing at all. It is parsed rather than
 * recomputed because git already knows, and a second implementation of
 * "how far apart are these" would only be a way to disagree with it.
 *
 * Worker branches are left out: `agentos-worker/<job>` is scratch space for a
 * job, not somewhere a person switches to, and listing dozens of them would
 * bury the handful of real branches.
 */
export async function listBranches(repoPath: string): Promise<BranchSummary[]> {
  if (!(await isRepository(repoPath))) return [];

  const current = await currentBranch(repoPath);

  try {
    const { stdout } = await git(repoPath, [
      "for-each-ref",
      "--sort=-committerdate",
      `--format=%(refname:short)${UNIT}%(upstream:short)${UNIT}%(upstream:track)${UNIT}%(committerdate:iso-strict)${UNIT}%(contents:subject)`,
      "refs/heads",
    ]);

    return stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        const [name, upstream, track, date, subject] = line.split(UNIT);
        if (!name || name.startsWith("agentos-worker/")) return [];

        return [
          {
            name,
            current: name === current,
            ahead: Number(/ahead (\d+)/.exec(track ?? "")?.[1] ?? 0),
            behind: Number(/behind (\d+)/.exec(track ?? "")?.[1] ?? 0),
            upstream: upstream || undefined,
            lastCommitAt: date || undefined,
            lastCommitSubject: subject || undefined,
          },
        ];
      });
  } catch {
    return [];
  }
}

/** One commit, as the activity feed and the repository view need it. */
export interface RecentCommit {
  hash: string;
  /** ISO 8601, straight from git. */
  date: string;
  subject: string;
  author: string;
}

/**
 * The last few commits on the current branch.
 *
 * Fields are separated by a unit separator rather than a space or a pipe,
 * because a commit subject is operator text and will eventually contain
 * whichever character seemed safe.
 */
export async function readRecentCommits(
  repoPath: string,
  limit = 20,
): Promise<RecentCommit[]> {
  if (!(await isRepository(repoPath))) return [];

  try {
    const { stdout } = await git(repoPath, [
      "log",
      `-${Math.max(1, Math.min(limit, 200))}`,
      "--date=iso-strict",
      `--format=%H${UNIT}%ad${UNIT}%s${UNIT}%an`,
    ]);

    return stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        const [hash, date, subject, author] = line.split(UNIT);
        if (!hash || !date) return [];

        return [{ hash, date, subject: subject ?? "", author: author ?? "" }];
      });
  } catch {
    // No commits yet, or an unreadable repository. Either way the caller
    // simply has nothing from git to show.
    return [];
  }
}
