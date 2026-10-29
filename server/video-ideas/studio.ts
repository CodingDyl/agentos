import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentOSRoot } from "../agentos/filesystem";
import { git, isRepository } from "../agentos/git";
import { uiStateDir } from "../agentos/session-store";
import { readJob, saveJob } from "../workers/job-store";

/**
 * The video-ideas studio: the folder assessment and plan workers write in.
 *
 * Workers read the AgentOS repo and the vault but never change them; they
 * write only `ideas/<id>/` here. AgentOS files what they wrote into the vault
 * itself, then closes the job, so a filed run never waits in the review queue.
 */

/** This checkout: the code an assessment reads and build tasks change. */
export const AGENTOS_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const AUTHOR = ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost"];

/** What an assessment or plan worker may do, on top of the worker default. */
export const READ_TOOLS = ["Read", "Grep", "Glob", "Write", "Bash(ls:*)", "Bash(mkdir:*)"];

export function videoStudioDir(): string {
  return path.join(uiStateDir(), "video-studio");
}

export async function ensureVideoStudio(): Promise<string> {
  const dir = videoStudioDir();
  await fs.mkdir(dir, { recursive: true });
  if (!(await isRepository(dir)) || !(await git(dir, ["rev-parse", "--verify", "HEAD"]).catch(() => undefined))) {
    if (!(await isRepository(dir))) await git(dir, ["init", "-b", "main"]).catch(() => git(dir, ["init"]));
    await fs.writeFile(path.join(dir, "README.md"), "# Video ideas studio\n\nWorking folder for assessment and plan runs. Output is filed in the vault by AgentOS.\n", { flag: "wx" }).catch(() => undefined);
    await git(dir, ["add", "-A"]);
    await git(dir, [...AUTHOR, "commit", "--no-verify", "-m", "Start the video ideas studio"]);
  }
  return dir;
}

/** Folders a worker may read, never change. */
export function readOnlyRoots(): string[] {
  return [AGENTOS_REPO, path.resolve(agentOSRoot())];
}

/** Where a job's output can be: its worktree first, then the studio itself. */
export async function rootsOfJob(jobId: string): Promise<string[]> {
  const job = await readJob(jobId);
  return [job?.worktreePath, job?.sourceRepoPath].filter((root): root is string => Boolean(root));
}

/** The first root holding `ideas/<id>/<file>`. */
export function outputDir(roots: readonly string[], ideaId: string, file: string): string | undefined {
  for (const root of roots) {
    const dir = path.join(root, "ideas", ideaId);
    if (existsSync(path.join(dir, file))) return dir;
  }
  return undefined;
}

/** Closes a studio job whose output has been filed: there is nothing to merge. */
export async function closeFiledJob(jobId: string | undefined): Promise<void> {
  if (!jobId) return;
  const job = await readJob(jobId);
  if (!job || job.status !== "awaiting_review") return;
  await saveJob({ ...job, status: "completed", completedAt: new Date().toISOString() });
}
