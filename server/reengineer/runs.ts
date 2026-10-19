import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import { z } from "zod";
import {
  ReengineerRunSchema,
  ReengineerRunViewSchema,
  type ReengineerReadiness,
  type ReengineerRequest,
  type ReengineerRun,
  type ReengineerRunView,
} from "../../shared/reengineer-types";
import { agentOSRoot } from "../agentos/filesystem";
import { uiStateDir } from "../agentos/session-store";
import { findOnPath } from "../ai-stack/detect";
import { git, isRepository } from "../agentos/git";
import { readJob, startJob } from "../workers/job-manager";
import { addEntry, normaliseKind, slugify, teardownRoot, TEARDOWN_DIR, listLibrary } from "./library";

/**
 * Reengineer runs: Claude Code with the REA skill, against one target.
 *
 * The worker writes `reengineer/<run>/teardown.md`, `library.json` and any
 * screenshots in its own checkout. AgentOS then files them in the vault itself
 * — the worker never writes to the vault — so nothing reaches Knowledge or the
 * library without passing through the checks here.
 */

export class ReengineerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const idPattern = /^rev_[a-f0-9]{16}$/;
export const isRunId = (id: string) => idPattern.test(id);

const runsDir = () => path.join(uiStateDir(), "reengineer-runs");
const studioDir = () => path.join(uiStateDir(), "reengineer-studio");
const AUTHOR = ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost"];

/** What the REA skill is allowed to do in a worker run. */
export const REENGINEER_TOOLS = [
  "Write",
  "Edit",
  "WebFetch",
  "mcp__rea",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "Bash(cat:*)",
  "Bash(ls:*)",
  "Bash(head:*)",
  "Bash(file:*)",
  "Bash(node:*)",
];

export function targetKind(target: string): ReengineerRun["kind"] {
  if (/^https?:\/\//i.test(target) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(target)) return "website";
  if (/^(\/|~\/|[a-z]:\\)/i.test(target) || /github\.com\//i.test(target)) return "source";
  return "app";
}

export function normaliseTarget(target: string): string {
  const trimmed = target.trim();
  return targetKind(trimmed) === "website" && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

async function saveRun(run: ReengineerRun): Promise<ReengineerRun> {
  await fs.mkdir(runsDir(), { recursive: true });
  const target = path.join(runsDir(), `${run.id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
  return run;
}

export async function readRun(id: string): Promise<ReengineerRun | undefined> {
  if (!isRunId(id)) return undefined;
  try {
    const parsed = ReengineerRunSchema.safeParse(JSON.parse(await fs.readFile(path.join(runsDir(), `${id}.json`), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readRuns(): Promise<ReengineerRun[]> {
  let names: string[];
  try {
    names = await fs.readdir(runsDir());
  } catch {
    return [];
  }
  const runs = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readRun(name.replace(/\.json$/, ""))));
  return runs.filter((run): run is ReengineerRun => Boolean(run)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

async function cdpAnswers(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:9222/json/version", { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function readiness(): Promise<ReengineerReadiness> {
  const claudeConfig = path.join(os.homedir(), ".claude.json");
  const rea = await fs
    .readFile(claudeConfig, "utf8")
    .then((text) => Boolean((JSON.parse(text) as { mcpServers?: Record<string, unknown> }).mcpServers?.rea))
    .catch(() => false);
  const skill = existsSync(path.join(os.homedir(), ".claude", "skills", "reverse-engineer-anything", "SKILL.md"));
  const claude = Boolean(await findOnPath("claude"));
  const browser = await cdpAnswers();
  const missing: string[] = [];
  if (!claude) missing.push("Claude Code (`claude`) is not installed.");
  if (!rea) missing.push("REA isn't registered with Claude Code. Run `npx -y rea-agents@latest setup --client claude_code`, then restart.");
  if (!skill) missing.push("The REA skill isn't installed. The same setup command installs it.");
  return { rea, skill, claude, browser, missing };
}

// ---------------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------------

async function ensureStudio(): Promise<string> {
  const dir = studioDir();
  await fs.mkdir(dir, { recursive: true });
  if (!(await isRepository(dir)) || !(await git(dir, ["rev-parse", "--verify", "HEAD"]).catch(() => undefined))) {
    if (!(await isRepository(dir))) await git(dir, ["init", "-b", "main"]).catch(() => git(dir, ["init"]));
    await fs.writeFile(path.join(dir, "README.md"), "# Reengineer studio\n\nWorking folder for teardown runs. Output is filed in the vault by AgentOS.\n", { flag: "wx" }).catch(() => undefined);
    await git(dir, ["add", "-A"]);
    await git(dir, [...AUTHOR, "commit", "--no-verify", "-m", "Start the reengineer studio"]);
  }
  return dir;
}

function promptFor(run: { id: string; target: string; kind: string }, request: ReengineerRequest, known: string[]): string {
  const out = `reengineer/${run.id}`;
  return [
    "Use the reverse-engineer-anything skill (REA) to take apart this target and report what is worth learning.",
    "",
    `Target: ${run.target}  (${run.kind})`,
    `Question: ${request.question?.trim() || "How is it built, and what makes it good? Find the components, patterns, layout and motion worth remembering."}`,
    request.focus.length ? `Look especially at: ${request.focus.join(", ")}.` : undefined,
    "",
    "How to work:",
    "- Prefer REA's evidence (page structure, scripts, bundle analysis, network) over guesses. A Chrome with remote debugging may be listening on http://127.0.0.1:9222; use it if it answers, otherwise fetch the page and its assets with WebFetch and say that is what you did.",
    "- Label anything inferred as an inference. Never claim you saw what you could not reach.",
    "- Describe, measure and explain. Do NOT copy the target's source code, text, images or brand assets into the output: record how it works and why, so we can build our own.",
    "",
    `Write these files in this folder (create ${out}/):`,
    `1. ${out}/teardown.md: the teardown. Start with a one-paragraph verdict, then structure, stack, design rules you can observe, motion, and what to take from it. Cite the evidence for each claim.`,
    `2. ${out}/library.json: {"entries":[{"title":"…","kind":"component|pattern|layout|motion|style|function","summary":"what it is, in two sentences","whyItWorks":"the reason it works, specific and checkable","tags":["navigation"],"screenshot":"optional filename in ${out}/screenshots/"}]}. 3 to 8 entries: only things worth reusing, each a distinct idea.`,
    `3. Optional: ${out}/screenshots/*.png for evidence.`,
    known.length ? `\nThe library already has these, so do not repeat them: ${known.slice(0, 60).join("; ")}.` : undefined,
    "Do not write anywhere else. Stop when the files are written.",
  ]
    .filter((part) => part !== undefined)
    .join("\n");
}

export async function launchReengineer(request: ReengineerRequest): Promise<ReengineerRun> {
  const status = await readiness();
  if (status.missing.length > 0) throw new ReengineerError(status.missing.join(" "), 409);

  const target = normaliseTarget(request.target);
  const id = `rev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const kind = targetKind(target);
  const studio = await ensureStudio();
  const known = (await listLibrary()).map((entry) => entry.title);

  const started = await startJob({
    worker: "claude-code",
    requestedWorker: "claude-code",
    project: request.workspace?.trim() || "reengineer",
    objective: promptFor({ id, target, kind }, request, known),
    repoPath: studio,
    extraAllowedTools: REENGINEER_TOOLS,
    claudeSettingSources: "user,project",
    timeoutMs: 45 * 60 * 1000,
    agentId: "site-audit",
    constraints: ["Do not copy the target's source, text, images or brand assets.", "Write only under reengineer/."],
    acceptanceCriteria: [`reengineer/${id}/teardown.md and library.json are written.`],
    validationCommands: [`test -s reengineer/${id}/teardown.md`, `test -s reengineer/${id}/library.json`],
  });
  if (!started.job) throw new ReengineerError(started.error ?? "Claude Code could not be started.", 409);

  return saveRun({
    id,
    target,
    kind,
    question: request.question?.trim() || undefined,
    focus: request.focus,
    workspace: request.workspace?.trim() || undefined,
    jobId: started.job.id,
    createdAt: new Date().toISOString(),
    entryIds: [],
  });
}

// ---------------------------------------------------------------------------
// Filing what came back
// ---------------------------------------------------------------------------

const SHOT = /^[A-Za-z0-9][\w.-]{0,80}\.(png|jpe?g|webp)$/;

const RawEntrySchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  type: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  whyItWorks: z.string().optional(),
  why_it_works: z.string().optional(),
  why: z.string().optional(),
  tags: z.array(z.string()).optional(),
  screenshot: z.string().optional(),
});

/** The entries a run wrote, tolerant of the field names the skill might choose. */
export function parseLibraryJson(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries) ? (parsed as { entries: unknown[] }).entries : [];
    return list.flatMap((raw) => {
      const result = RawEntrySchema.safeParse(raw);
      if (!result.success) return [];
      const entry = result.data;
      const title = (entry.title ?? entry.name)?.trim();
      const summary = (entry.summary ?? entry.description)?.trim();
      if (!title || !summary) return [];
      return [
        {
          title,
          kind: normaliseKind(entry.kind ?? entry.type),
          summary: summary.slice(0, 1200),
          whyItWorks: (entry.whyItWorks ?? entry.why_it_works ?? entry.why ?? "").trim().slice(0, 1200),
          tags: entry.tags ?? [],
          screenshot: entry.screenshot,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function ingest(run: ReengineerRun, roots: string[]): Promise<ReengineerRun> {
  let root: string | undefined;
  for (const candidate of roots) {
    if (existsSync(path.join(candidate, "reengineer", run.id, "teardown.md"))) {
      root = candidate;
      break;
    }
  }
  if (!root) return run;

  const out = path.join(root, "reengineer", run.id);
  const teardown = (await fs.readFile(path.join(out, "teardown.md"), "utf8")).trim();
  const entries = parseLibraryJson(await fs.readFile(path.join(out, "library.json"), "utf8").catch(() => ""));

  const host = /^https?:\/\//.test(run.target) ? new URL(run.target).hostname : run.target;
  const slug = `${slugify(host, "target")}-${run.id.slice(4, 10)}`;
  const assets = path.join(teardownRoot(), "assets", run.id);
  const copied = new Map<string, string>();
  for (const name of await fs.readdir(path.join(out, "screenshots")).catch(() => [] as string[])) {
    if (!SHOT.test(name)) continue;
    await fs.mkdir(assets, { recursive: true });
    await fs.copyFile(path.join(out, "screenshots", name), path.join(assets, name));
    copied.set(name, path.posix.join(TEARDOWN_DIR, "assets", run.id, name));
  }

  const entryIds: string[] = [];
  for (const entry of entries) {
    const shot = entry.screenshot ? copied.get(path.basename(entry.screenshot)) : undefined;
    const added = await addEntry({
      title: entry.title,
      kind: entry.kind,
      summary: entry.summary,
      whyItWorks: entry.whyItWorks,
      tags: [...entry.tags, ...run.focus, ...(run.workspace ? [`for-${run.workspace}`] : [])],
      source: { target: run.target, runId: run.id },
      screenshot: shot,
    });
    entryIds.push(added.id);
  }

  const shots = [...copied.values()];
  const note = matter.stringify(
    [
      `# Teardown: ${run.target}`,
      "",
      run.question ? `> ${run.question}\n` : "",
      teardown,
      "",
      shots.length ? `## Evidence\n\n${shots.map((shot) => `![[${shot.replace(`${TEARDOWN_DIR}/`, "")}]]`).join("\n")}\n` : "",
      entryIds.length ? `## Library entries\n\n${entryIds.map((id) => `- [[library/${id}]]`).join("\n")}\n` : "",
    ].join("\n"),
    { type: "teardown", target: run.target, kind: run.kind, run: run.id, tags: ["teardown", ...run.focus], created: new Date().toISOString() },
  );
  await fs.mkdir(teardownRoot(), { recursive: true });
  const notePath = path.posix.join(TEARDOWN_DIR, `${slug}.md`);
  await fs.writeFile(path.join(agentOSRoot(), notePath), note, "utf8");

  return saveRun({ ...run, ingestedAt: new Date().toISOString(), notePath, entryIds, error: undefined });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function view(run: ReengineerRun): Promise<ReengineerRunView> {
  const job = await readJob(run.jobId);
  let current = run;

  const finished = job && (job.status === "awaiting_review" || job.status === "completed");
  if (finished && !run.ingestedAt) {
    try {
      current = await ingest(run, [job.worktreePath, job.sourceRepoPath].filter((root): root is string => Boolean(root)));
    } catch (error) {
      console.error("[agentos] reengineer ingest failed:", error instanceof Error ? error.message : error);
    }
  }

  const status: ReengineerRunView["status"] =
    job?.status === "failed" ? "failed" : job?.status === "cancelled" ? "cancelled" : current.ingestedAt ? "completed" : finished ? "awaiting_review" : "running";

  return ReengineerRunViewSchema.parse({
    ...current,
    status,
    error: job?.error ?? current.error,
    summary: job?.result?.summary,
    jobHref: `/workers/jobs/${run.jobId}`,
  });
}

export async function listRunViews(): Promise<ReengineerRunView[]> {
  return Promise.all((await readRuns()).map(view));
}

export async function runView(id: string): Promise<ReengineerRunView | undefined> {
  const run = await readRun(id);
  return run ? view(run) : undefined;
}
