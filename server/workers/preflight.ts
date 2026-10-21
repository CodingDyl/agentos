import fs from "node:fs/promises";
import path from "node:path";
import { gitWritableProblem, gitWritableRoots } from "./git-sandbox";
import type { ProjectRepo } from "./project-repo";

/**
 * Checks that must pass before a worker is started.
 *
 * A job that launches into a worktree whose gitdir is outside the sandbox,
 * or whose `node_modules` is missing, spends tokens and then quits. Failing
 * here puts a fixable sentence on the job instead of a cancelled run that
 * still claimed to pass.
 */

export type PreflightCode =
  | "git_not_writable"
  | "deps_missing"
  | "required_tool"
  | "not_a_repo"
  | "project_missing";

export interface PreflightIssue {
  code: PreflightCode;
  message: string;
}

export interface PreflightInput {
  worktreePath: string;
  /** Project folder inside the worktree — where package.json lives. */
  cwd: string;
  projectRepo?: ProjectRepo;
  /** Tools this job actually needs. Missing optional tools are not issues. */
  requiredTools?: readonly string[];
  /** Tools the worker is known to have pre-approved. */
  approvedTools?: readonly string[];
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function missingRequiredTools(
  required: readonly string[] | undefined,
  approved: readonly string[] | undefined,
): string[] {
  if (!required || required.length === 0) return [];
  const have = new Set((approved ?? []).map((tool) => tool.toLowerCase()));
  return required.filter((tool) => !have.has(tool.toLowerCase()));
}

/**
 * One sentence an operator can act on, covering every issue found.
 */
export function preflightMessage(issues: readonly PreflightIssue[]): string {
  if (issues.length === 0) return "The worktree is ready.";
  return issues.map((issue) => issue.message).join(" ");
}

export async function preflightWorkerLaunch(input: PreflightInput): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  if (!(await exists(input.worktreePath))) {
    issues.push({
      code: "project_missing",
      message: `The isolated checkout at ${input.worktreePath} is missing. Retry the job so AgentOS can create it again.`,
    });
    return { ok: false, issues };
  }

  const roots = await gitWritableRoots(input.worktreePath);
  if (!roots) {
    issues.push({
      code: "not_a_repo",
      message: `${input.worktreePath} is not a git checkout. Link a repository on the workspace's Ship tab, or let AgentOS run git init in the project folder.`,
    });
  } else {
    const gitProblem = await gitWritableProblem(input.worktreePath, roots);
    if (gitProblem) {
      issues.push({ code: "git_not_writable", message: gitProblem });
    }
  }

  if (await exists(path.join(input.cwd, "package.json"))) {
    const modules = path.join(input.cwd, "node_modules");
    if (!(await exists(modules))) {
      issues.push({
        code: "deps_missing",
        message: `Dependencies are not installed in the worktree (${modules} is missing). AgentOS should have linked or installed them before launch; retry the job, or run the project's install in ${input.projectRepo?.projectPath ?? "the source checkout"} first.`,
      });
    }
  }

  const missing = missingRequiredTools(input.requiredTools, input.approvedTools);
  if (missing.length > 0) {
    issues.push({
      code: "required_tool",
      message: `Required tools are not pre-approved: ${missing.join(", ")}. Add them on the agent or the job, then retry.`,
    });
  }

  return { ok: issues.length === 0, issues };
}
