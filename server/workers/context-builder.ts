import fs from "node:fs/promises";
import path from "node:path";
import { agentOSRoot } from "../agentos/filesystem";
import type { WorkerJob } from "../../shared/worker-types";

/**
 * The handoff contract.
 *
 * A worker is given an objective, the few files that bear on it, what it may
 * not do, and how the work will be judged — and nothing else. It never receives
 * the vault, the portfolio, or anything about work it was not asked to do.
 *
 * Scope is the safety property here: a worker that cannot see the rest of the
 * system cannot wander into it. This builder is the one place that decides what
 * crosses that line.
 */

/** Constraints every coding job carries, whatever else it was given. */
const STANDING_CONSTRAINTS: readonly string[] = [
  "Work only inside the worktree you were given.",
  "Do not modify AgentOS vault files.",
  "Do not commit, push, or change git remotes.",
  "Do not make architectural changes beyond the objective.",
];

/**
 * How a worker hands back a document worth keeping.
 *
 * Not every reply is a document: a progress note or a closing summary is not.
 * A plan, a research write-up, a report or a proposal is, and it is kept by
 * naming it — one line per file, in a fixed shape AgentOS can read without a
 * model — so nothing has to guess what mattered.
 */
const ARTIFACT_INSTRUCTIONS = [
  "If you produce a document worth keeping (a plan, research, a report, a",
  "specification, an architecture proposal), write it as Markdown inside an",
  "`artifacts/` folder in the worktree, and end your closing summary with one",
  "line per document, exactly in this form:",
  "Artifact: artifacts/<file>.md - <Title> (<plan|research|spec|design|review|report|notes>)",
  "Do not create documents for ordinary progress updates.",
].join("\n");

function section(heading: string, body: string | undefined): string | undefined {
  return body && body.trim().length > 0 ? `${heading}\n${body.trim()}` : undefined;
}

function list(items: readonly string[] | undefined): string | undefined {
  const entries = (items ?? []).filter((item) => item.trim().length > 0);
  if (entries.length === 0) return undefined;

  return entries.map((item) => `- ${item.trim()}`).join("\n");
}

/**
 * Builds one job's context packet.
 *
 * Plain text on purpose: every worker can read it, and an operator can read it
 * too — which matters, because this is the exact brief a worker was given when
 * the time comes to judge what it did.
 */
export function buildContextPacket(job: WorkerJob): string {
  const constraints = [...(job.constraints ?? []), ...STANDING_CONSTRAINTS];

  return [
    "JOB",
    section("\nProject:", job.project),
    section("\nObjective:", job.objective),
    section("\nRelevant context:", list(job.contextFiles)),
    section("\nConstraints:", list(constraints)),
    section("\nAcceptance:", list(job.acceptanceCriteria)),
    section("\nValidation:", (job.validationCommands ?? []).join("\n")),
    section("\nDocuments:", ARTIFACT_INSTRUCTIONS),
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

/**
 * Whether a request is complete enough to hand over.
 *
 * A job with no objective is not a job. A coding job aimed at nowhere is worse
 * than one that is refused, so both are caught before a worker is started
 * rather than surfacing as a confusing failure mid-run.
 */
export function validateJobRequest(job: {
  objective?: unknown;
  project?: unknown;
  repoPath?: unknown;
}): string | undefined {
  if (typeof job.objective !== "string" || job.objective.trim().length === 0) {
    return "A job needs an objective.";
  }

  if (typeof job.project !== "string" || job.project.trim().length === 0) {
    return "A job needs a project.";
  }

  if (job.repoPath !== undefined && typeof job.repoPath !== "string") {
    return "The repository path must be a path.";
  }

  return undefined;
}

/** The vault documents Hermes is shown while scoping, and may name back. */
const VAULT_DOCUMENTS = new Set([
  "PROJECT.md",
  "STATUS.md",
  "TASKS.md",
  "DECISIONS.md",
  "MILESTONES.md",
]);

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns the paths Hermes named into paths a worker can open.
 *
 * Scoping shows Hermes the vault documents under headings like `PROJECT.md`,
 * and it tends to hand them back as if they lived in the repository —
 * `<repo>/PROJECT.md` — which sends the worker's first three reads into
 * nothing. A vault document named anywhere is pointed at the vault; a path
 * that exists is kept as it is; a path that exists nowhere is dropped rather
 * than passed on as an instruction to fail.
 */
export async function resolveContextFiles(
  files: readonly string[],
  where: { slug: string; repoPath?: string },
): Promise<string[]> {
  const vaultDir = path.join(agentOSRoot(), "projects", where.slug);
  const resolved: string[] = [];

  for (const entry of files) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const base = path.basename(trimmed);

    if (VAULT_DOCUMENTS.has(base)) {
      const inVault = path.join(vaultDir, base);
      if (await exists(inVault)) {
        resolved.push(inVault);
        continue;
      }
    }

    // Relative paths are tried as repo-relative, then project-relative, then
    // vault-relative (`projects/<slug>/docs/x.md`, as the console names them).
    const candidates = path.isAbsolute(trimmed)
      ? [trimmed]
      : [
          where.repoPath ? path.join(where.repoPath, trimmed) : undefined,
          path.join(vaultDir, trimmed),
          path.join(agentOSRoot(), trimmed),
        ].filter((candidate): candidate is string => candidate !== undefined);

    for (const candidate of candidates) {
      if (await exists(candidate)) {
        resolved.push(candidate);
        break;
      }
    }
  }

  return [...new Set(resolved)];
}
