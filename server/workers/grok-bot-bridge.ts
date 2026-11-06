import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GROK_BOT_RESULT_JSON_SCHEMA,
  GrokBotResultSchema,
  type GrokBotBridge,
  type GrokBotExportedNote,
  type GrokBotResult,
  type GrokBotWorktree,
} from "../../shared/grok-bot-types";
import type { WorkerJob } from "../../shared/worker-types";
import { currentBranch, headCommit } from "../agentos/git";
import { checkWorkspace } from "./grok-bot-workspace";
import { worktreeRoot } from "./worktree";

/**
 * The Grok Bot file bridge: what goes onto the SSD for a task, and how the
 * answer comes back.
 *
 * Out: the notes chosen for this job, copied whole into their own folder under
 * `memory/`, and a task file in `tasks/` naming the exact result path and shape.
 * In: one file at that path, checked against the schema and the job before a
 * word of it is believed.
 *
 * A repository job also names its worktree: the checkout AgentOS made for this
 * job on this Mac. Grok reaches the Mac from the cloud, so nothing here can
 * sandbox it the way a local worker is sandboxed. The limits are stated in the
 * instruction, and what happened is read from git afterwards rather than taken
 * from the reply: no diff fails the job, and so does a moved HEAD.
 *
 * Nothing here writes to the vault. A reply that proposes vault changes is
 * text for review, not an edit.
 */

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** Unique across jobs and retries, and readable in a folder listing. */
export function newTaskId(jobId: string): string {
  return `${jobId}-${randomBytes(3).toString("hex")}`;
}

/** Temp file then rename, so Grok never opens a half-written task. */
async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, target);
}

/** A vault path that stays inside the folder it is copied into. */
function safeRelative(source: string): string | undefined {
  const normalised = path.posix.normalize(source.replaceAll("\\", "/"));
  if (normalised.startsWith("../") || normalised === ".." || path.posix.isAbsolute(normalised)) return undefined;
  return normalised;
}

/** The notes this job was given, one entry per file. */
export function selectedNotes(job: WorkerJob): string[] {
  const sources = job.memoryContext?.status === "ok" || job.memoryContext?.status === "insufficient"
    ? job.memoryContext.sources
    : [];
  return [...new Set(sources.map((source) => source.path))];
}

/**
 * Copies the selected notes into `memory/<taskId>/`, keeping their vault paths,
 * and writes a manifest beside them.
 *
 * Only the selected notes: never the vault, never a folder. A note that has
 * gone since retrieval is reported in the manifest rather than silently dropped.
 */
export async function exportNotes(
  job: WorkerJob,
  memoryDir: string,
  exportedAt: string,
): Promise<{ notes: GrokBotExportedNote[]; skipped: Array<{ source: string; reason: string }> }> {
  const vaultRoot = job.memoryContext?.vaultRoot;
  const notes: GrokBotExportedNote[] = [];
  const skipped: Array<{ source: string; reason: string }> = [];

  await fs.mkdir(memoryDir);

  for (const source of selectedNotes(job)) {
    const relative = safeRelative(source);
    if (!vaultRoot || !relative) {
      skipped.push({ source, reason: vaultRoot ? "Path leaves the vault." : "The vault location is unknown." });
      continue;
    }

    try {
      const from = path.join(vaultRoot, relative);
      const [content, stat] = await Promise.all([fs.readFile(from), fs.stat(from)]);
      const exportedPath = path.join(memoryDir, relative);
      await fs.mkdir(path.dirname(exportedPath), { recursive: true });
      await fs.writeFile(exportedPath, content, { flag: "wx" });
      notes.push({ source, exportedPath, hash: sha256(content), modifiedAt: stat.mtime.toISOString(), exportedAt });
    } catch (error) {
      skipped.push({ source, reason: (error as Error).message });
    }
  }

  const manifest = {
    schemaVersion: 1,
    jobId: job.id,
    exportedAt,
    vaultRoot,
    notes: notes.map((note) => ({ ...note, exportedPath: path.relative(memoryDir, note.exportedPath) })),
    skipped,
  };
  await writeAtomic(path.join(memoryDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return { notes, skipped };
}

/**
 * What this job may do with its checkout, or nothing for a job without one.
 *
 * Handing Grok a path grants it write access to that path, so the path has to
 * really be one of AgentOS's own worktrees, wherever the job record says it is.
 */
export async function worktreeForExport(
  job: Pick<WorkerJob, "workerBranch" | "reportOnly">,
  worktreePath: string | undefined,
  cwd: string | undefined,
): Promise<GrokBotWorktree | undefined> {
  if (!worktreePath) return undefined;

  const [root, real, realCwd] = await Promise.all([
    fs.realpath(worktreeRoot()),
    fs.realpath(worktreePath),
    fs.realpath(cwd ?? worktreePath),
  ]);
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative !== "" ? !relative.startsWith("..") && !path.isAbsolute(relative) : false;
  };
  if (!inside(root, real) || (realCwd !== real && !inside(real, realCwd))) {
    throw new Error(`Refusing to give Grok ${worktreePath}: it is not an AgentOS worktree.`);
  }

  return {
    path: worktreePath,
    cwd: cwd ?? worktreePath,
    branch: job.workerBranch,
    access: job.reportOnly ? "read-only" : "read-write",
    headAtExport: await headCommit(worktreePath),
  };
}

/** The rules for the checkout, written once for the instruction and the task file. */
function worktreeRules(worktree: GrokBotWorktree): string[] {
  if (worktree.access === "read-only") {
    return [
      "Read it, and change nothing in it. This job is report only: your reply is the deliverable, and a job that changes files fails.",
    ];
  }
  return [
    "Make the changes yourself, in this folder on this Mac. Edit files only inside it: not the original repository, not the vault, nowhere else.",
    "Leave your work uncommitted. Do not commit, push, open a pull request, or run git fetch, pull, merge or rebase. AgentOS commits after review.",
    "Do not hand the work to a cloud agent: it cannot see this folder, and AgentOS only reviews what changed here. A job with no changes in this folder fails.",
  ];
}

/** The text the operator pastes into Grok. Exact paths, nothing to guess. */
export function grokInstruction(
  bridge: Pick<GrokBotBridge, "taskPath" | "resultPath" | "memoryDir" | "taskId" | "worktree">,
  jobId: string,
): string {
  const { worktree } = bridge;
  const editing = worktree?.access === "read-write";
  const step = worktree ? 4 : 3;

  return [
    `AgentOS task ${bridge.taskId}.`,
    ``,
    `1. Read the task: ${bridge.taskPath}`,
    `2. Use only the notes in: ${bridge.memoryDir} (listed in manifest.json there). Do not read anything else from the vault.`,
    ...(worktree
      ? [
          `3. ${editing ? "Work" : "The code is"} in this job's worktree, made for this job alone: ${worktree.cwd}`,
          ...(worktree.branch ? [`   It is on git branch ${worktree.branch}. Stay on it.`] : []),
          ...worktreeRules(worktree).map((rule) => `   ${rule}`),
        ]
      : []),
    `${step}. Write your ${editing ? "result" : "answer"} as one JSON file to exactly: ${bridge.resultPath}`,
    `   Shape: {"schemaVersion": 1, "taskId": "${bridge.taskId}", "jobId": "${jobId}", "status": "completed", "reply": "<${editing ? "what you changed, and anything that blocked you" : "your answer"}>"}`,
    `   If you cannot do it${worktree ? ", or cannot reach the worktree" : ""}, set "status": "failed" and explain in "error" (reply still required, briefly).`,
    editing
      ? `${step + 1}. Besides the worktree, that result file is the only thing you write. Do not edit the task or the notes.`
      : `${step + 1}. Write nothing else. Do not edit the task, the notes, or any other file.`,
  ].join("\n");
}

/**
 * Writes one job onto the SSD: notes, then the task file last, so a task that
 * exists always has its notes beside it.
 */
export async function exportTask(
  job: WorkerJob,
  workspace: string,
  brief: string,
  worktree?: GrokBotWorktree,
): Promise<GrokBotBridge> {
  const status = await checkWorkspace(workspace, { probe: false });
  if (status.state !== "available") {
    throw new Error(status.reason ?? "The Grok Bot workspace is unavailable.");
  }

  const taskId = newTaskId(job.id);
  const exportedAt = new Date().toISOString();
  const memoryDir = path.join(workspace, "memory", taskId);
  const taskPath = path.join(workspace, "tasks", `${taskId}.json`);
  const resultPath = path.join(workspace, "results", `${taskId}.json`);

  const { notes, skipped } = await exportNotes(job, memoryDir, exportedAt);

  const bridge: GrokBotBridge = {
    taskId,
    workspace,
    taskPath,
    resultPath,
    memoryDir,
    exportedAt,
    notes,
    worktree,
    instruction: grokInstruction({ taskId, taskPath, resultPath, memoryDir, worktree }, job.id),
  };

  const task = {
    schemaVersion: 1,
    taskId,
    jobId: job.id,
    createdAt: exportedAt,
    project: job.project,
    objective: job.objective,
    brief,
    expectedOutput: job.expectedOutput,
    memory: {
      folder: memoryDir,
      manifest: path.join(memoryDir, "manifest.json"),
      notes: notes.map((note) => ({ source: note.source, path: note.exportedPath, modifiedAt: note.modifiedAt })),
      skipped,
    },
    ...(worktree
      ? {
          worktree: {
            path: worktree.path,
            workingDirectory: worktree.cwd,
            branch: worktree.branch,
            access: worktree.access,
            rules: worktreeRules(worktree),
          },
        }
      : {}),
    result: { path: resultPath, schema: GROK_BOT_RESULT_JSON_SCHEMA },
  };
  await writeAtomic(taskPath, `${JSON.stringify(task, null, 2)}\n`);

  return bridge;
}

/**
 * Why the worktree is not where it was left, if it is not. Workers elsewhere are
 * refused `git commit` and `git checkout` outright; Grok can only be told. A
 * commit would be read as work pulled from elsewhere and vanish from the diff,
 * so it stops the job here, with the work still in the worktree.
 */
export async function worktreeDrift(worktree: GrokBotWorktree): Promise<string | undefined> {
  const [branch, head] = await Promise.all([currentBranch(worktree.path), headCommit(worktree.path)]);
  if (worktree.branch && branch && branch !== worktree.branch) {
    return `Grok left the worktree on branch ${branch} instead of ${worktree.branch}. Nothing was landed; the worktree is kept at ${worktree.path}.`;
  }
  if (worktree.headAtExport && head && head !== worktree.headAtExport) {
    return `Grok moved the worktree to commit ${head.slice(0, 8)} (it was at ${worktree.headAtExport.slice(0, 8)}), and the job asks it to leave work uncommitted. Nothing was landed; the worktree is kept at ${worktree.path}.`;
  }
  return undefined;
}

export type ResultCheck =
  | { kind: "missing" }
  | { kind: "rejected"; reason: string; fingerprint: string }
  | { kind: "accepted"; result: GrokBotResult; hash: string };

/**
 * Reads the result file, if there is one, and decides whether to believe it.
 *
 * A refusal is not final: the file may be half-written, or Grok may fix it.
 * The fingerprint lets the caller skip re-reporting the same bad file.
 */
export async function readResult(bridge: GrokBotBridge, jobId: string): Promise<ResultCheck> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(bridge.resultPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }

  const hash = sha256(raw);
  const reject = (reason: string): ResultCheck => ({ kind: "rejected", reason, fingerprint: hash });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return reject("The result file is not valid JSON (it may still be being written).");
  }

  const result = GrokBotResultSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return reject(`The result does not match the schema: ${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}.`);
  }
  if (result.data.taskId !== bridge.taskId) {
    return reject(`The result is for task ${result.data.taskId}, not ${bridge.taskId}.`);
  }
  if (result.data.jobId !== jobId) {
    return reject(`The result names job ${result.data.jobId}, not ${jobId}.`);
  }

  return { kind: "accepted", result: result.data, hash };
}
