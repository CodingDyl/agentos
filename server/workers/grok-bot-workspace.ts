import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * The Grok Bot workspace: a folder on an SSD with `memory/`, `tasks/` and
 * `results/` in it.
 *
 * Everything here only looks. Nothing creates a directory — a missing SSD must
 * read as missing, never be papered over by an empty folder of the same name
 * on the internal disk, which Grok would never see.
 *
 * Folder access says the bridge is in place. It does not say Grok is running or
 * signed in; nothing here can know that.
 */

export type WorkspaceState = "unconfigured" | "available" | "unavailable";

export interface WorkspaceCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface WorkspaceStatus {
  state: WorkspaceState;
  path?: string;
  reason?: string;
  checks: WorkspaceCheck[];
}

/** Why a path cannot be used as a workspace, before touching the disk. */
export function workspacePathProblem(value: string): string | undefined {
  if (!value.trim()) return "Enter the workspace path.";
  if (!path.isAbsolute(value)) return "The workspace path must be absolute, e.g. /Volumes/<SSD>/grok-bot.";
  return undefined;
}

/** `/Volumes/<name>` for a path on an external volume, else undefined. */
function volumeRoot(workspace: string): string | undefined {
  const parts = path.resolve(workspace).split(path.sep);
  return parts[1] === "Volumes" && parts[2] ? path.join("/", "Volumes", parts[2]) : undefined;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function accessible(target: string, mode: number): Promise<boolean> {
  try {
    await fs.access(target, mode);
    return true;
  } catch {
    return false;
  }
}

/** A write that is removed straight after, proving the folder takes files. */
async function probeWrite(folder: string): Promise<string | undefined> {
  const probe = path.join(folder, `.agentos-probe-${process.pid}-${Date.now()}`);
  try {
    // `wx`: never overwrite anything that happens to be there.
    await fs.writeFile(probe, "agentos connection test\n", { flag: "wx" });
    await fs.readFile(probe, "utf8");
    return undefined;
  } catch (error) {
    return (error as Error).message;
  } finally {
    await fs.rm(probe, { force: true }).catch(() => undefined);
  }
}

/**
 * Checks the workspace.
 *
 * `probe: false` is the cheap form used by health checks on every page load:
 * existence and permissions only. `probe: true` is the connection test, which
 * also writes and removes a file in `tasks/` and `results/`.
 */
export async function checkWorkspace(
  workspace: string | undefined,
  { probe }: { probe: boolean },
): Promise<WorkspaceStatus> {
  if (!workspace) {
    return { state: "unconfigured", reason: "No workspace path is set.", checks: [] };
  }

  const problem = workspacePathProblem(workspace);
  if (problem) return { state: "unavailable", path: workspace, reason: problem, checks: [] };

  const volume = volumeRoot(workspace);
  if (volume && !(await isDirectory(volume))) {
    return {
      state: "unavailable",
      path: workspace,
      reason: `The SSD is not connected: ${volume} is not mounted. Connect it and test again.`,
      checks: [{ name: "SSD mounted", ok: false, detail: volume }],
    };
  }

  if (!(await isDirectory(workspace))) {
    return {
      state: "unavailable",
      path: workspace,
      reason: `The workspace folder does not exist: ${workspace}`,
      checks: [{ name: "Workspace folder", ok: false, detail: workspace }],
    };
  }

  const checks: WorkspaceCheck[] = [];
  if (volume) checks.push({ name: "SSD mounted", ok: true, detail: volume });
  checks.push({ name: "Workspace folder", ok: true, detail: workspace });

  const memory = path.join(workspace, "memory");
  checks.push(
    !(await isDirectory(memory))
      ? { name: "memory/ readable", ok: false, detail: "memory/ is missing." }
      : (await accessible(memory, constants.R_OK | constants.X_OK))
        ? { name: "memory/ readable", ok: true }
        : { name: "memory/ readable", ok: false, detail: "memory/ cannot be read." },
  );

  for (const folder of ["tasks", "results"]) {
    const full = path.join(workspace, folder);
    const name = `${folder}/ writable`;
    if (!(await isDirectory(full))) {
      checks.push({ name, ok: false, detail: `${folder}/ is missing.` });
      continue;
    }
    if (!(await accessible(full, constants.W_OK | constants.X_OK))) {
      checks.push({ name, ok: false, detail: `${folder}/ cannot be written to.` });
      continue;
    }
    const failure = probe ? await probeWrite(full) : undefined;
    checks.push(failure ? { name, ok: false, detail: `Test file could not be written: ${failure}` } : { name, ok: true });
  }

  const failed = checks.filter((check) => !check.ok);
  return failed.length === 0
    ? { state: "available", path: workspace, checks }
    : {
        state: "unavailable",
        path: workspace,
        reason: failed.map((check) => check.detail ?? check.name).join(" "),
        checks,
      };
}
