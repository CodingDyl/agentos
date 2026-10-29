import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { SizeSchema, VerdictSchema, type Verdict, type VideoIdea } from "../../shared/video-ideas-types";
import { agentOSRoot, readOptionalFile, writeAgentOSFile } from "../agentos/filesystem";
import { slugify } from "../reengineer/library";
import { startJob } from "../workers/job-manager";
import { pastDecisions, updateIdea, type PastDecision } from "./store";
import { AGENTOS_REPO, closeFiledJob, ensureVideoStudio, outputDir, READ_TOOLS, readOnlyRoots } from "./studio";

/**
 * The assessment: should AgentOS adopt what this video shows?
 *
 * A Claude Code worker reads the note, the AgentOS code and the vault, and
 * writes `ideas/<id>/assessment.md` and `verdict.json` in the studio. The lens
 * is Dylan's: does it make him money, or keep him ahead of the AI curve.
 */

export const ASSESSMENT_SECTIONS = [
  "What it proposes",
  "What AgentOS already does",
  "The gap",
  "How it plugs in",
  "Money and edge",
  "Cost and risk",
  "Verdict",
] as const;

export function assessmentPrompt(idea: VideoIdea, noteMarkdown: string, decisions: readonly PastDecision[]): string {
  const out = `ideas/${idea.id}`;
  return [
    "Assess whether AgentOS should adopt what this video shows. AgentOS is Dylan's own operating system for running his work with AI agents.",
    "",
    "Dylan's goal for AgentOS: make Dylan money, and keep him ahead of the AI curve. Judge everything by that. Something clever that does neither is a Skip.",
    "",
    "Where things are (read freely, change nothing):",
    `- The AgentOS code: ${AGENTOS_REPO}. Start from CLAUDE.md, docs/superpowers/specs/ and the server/ and src/features/ folders.`,
    `- Dylan's vault (notes, workspaces, memory): ${path.resolve(agentOSRoot())}. The video's note is at ${idea.notePath ?? "(below)"}.`,
    "Look at the real code before you claim AgentOS does or doesn't do something, and cite files or pages for each claim.",
    "",
    decisions.length
      ? `What Dylan decided about earlier ideas (learn his taste from it):\n${decisions.map((d) => `- ${d.title} — verdict ${d.verdict ?? "none"}, ${d.decision}${d.reason ? `: ${d.reason}` : ""}`).join("\n")}`
      : undefined,
    "",
    `Write ${out}/assessment.md in plain language Dylan can decide from without opening the code, with exactly these sections:`,
    `## ${ASSESSMENT_SECTIONS[0]}\nOne paragraph.`,
    `## ${ASSESSMENT_SECTIONS[1]}\nWhat AgentOS already has in this area, with file or page references.`,
    `## ${ASSESSMENT_SECTIONS[2]}\nWhat is missing.`,
    `## ${ASSESSMENT_SECTIONS[3]}\nWhich features, files and flows it would touch, and how it fits what exists. Never propose rebuilding something AgentOS already has.`,
    `## ${ASSESSMENT_SECTIONS[4]}\nHow it helps Dylan earn, or keeps AgentOS ahead. Be concrete.`,
    `## ${ASSESSMENT_SECTIONS[5]}\nRough size (small, medium or large), what could break, and any ongoing cost (API spend, credits).`,
    `## ${ASSESSMENT_SECTIONS[6]}\nAdopt, Adapt (take part of it — say which part) or Skip, and why.`,
    "",
    `Then write ${out}/verdict.json: {"verdict":"adopt|adapt|skip","why":"one sentence","size":"small|medium|large"}.`,
    "",
    `Do not write anywhere except ${out}/. Stop when both files are written.`,
    "",
    "The video's note:",
    noteMarkdown,
  ]
    .filter((part) => part !== undefined)
    .join("\n");
}

export function parseVerdict(text: string): { verdict: Verdict; why: string; size?: "small" | "medium" | "large" } | undefined {
  try {
    const raw = JSON.parse(text) as { verdict?: unknown; why?: unknown; size?: unknown };
    const verdict = VerdictSchema.safeParse(String(raw.verdict ?? "").toLowerCase());
    if (!verdict.success) return undefined;
    const size = SizeSchema.safeParse(String(raw.size ?? "").toLowerCase());
    return { verdict: verdict.data, why: String(raw.why ?? "").trim().slice(0, 500), ...(size.success ? { size: size.data } : {}) };
  } catch {
    return undefined;
  }
}

export async function launchAssessment(idea: VideoIdea): Promise<VideoIdea> {
  const studio = await ensureVideoStudio();
  const note = idea.notePath ? await readOptionalFile(idea.notePath) : undefined;
  const started = await startJob({
    worker: "claude-code",
    requestedWorker: "claude-code",
    project: "video-ideas",
    objective: assessmentPrompt(idea, note ?? "(The note could not be read.)", pastDecisions()),
    repoPath: studio,
    extraAllowedTools: READ_TOOLS,
    claudeReadOnlyRoots: readOnlyRoots(),
    timeoutMs: 30 * 60 * 1000,
    agentId: "ai-teacher",
    constraints: [`Do not edit anything outside ideas/${idea.id}/.`],
    acceptanceCriteria: [`ideas/${idea.id}/assessment.md and verdict.json are written.`],
    validationCommands: [`test -s ideas/${idea.id}/assessment.md`, `test -s ideas/${idea.id}/verdict.json`],
  });
  if (!started.job) {
    return updateIdea(idea.id, { stage: "failed", failedAt: "assessing", error: started.error ?? "Claude Code could not be started." });
  }
  return updateIdea(idea.id, {
    stage: "assessing",
    error: undefined,
    failedAt: undefined,
    jobId: started.job.id,
    runs: [...idea.runs, { step: "assessment", worker: "Claude Code (Max plan)", jobId: started.job.id, startedAt: new Date().toISOString() }],
  });
}

function endRun(idea: VideoIdea, status: string): VideoIdea["runs"] {
  return idea.runs.map((run) => (run.jobId && run.jobId === idea.jobId && !run.endedAt ? { ...run, endedAt: new Date().toISOString(), status } : run));
}

export async function fileAssessment(idea: VideoIdea, roots: readonly string[]): Promise<VideoIdea> {
  const dir = outputDir(roots, idea.id, "assessment.md");
  const verdict = dir ? parseVerdict(await fs.readFile(path.join(dir, "verdict.json"), "utf8").catch(() => "")) : undefined;
  if (!dir || !verdict) {
    return updateIdea(idea.id, {
      stage: "failed",
      failedAt: "assessing",
      error: dir ? "The assessment has no readable verdict." : "The assessment was not written.",
      runs: endRun(idea, "failed"),
    });
  }

  const assessment = (await fs.readFile(path.join(dir, "assessment.md"), "utf8")).trim();
  const assessmentPath = `knowledge/assessments/${idea.createdAt.slice(0, 10)}-${slugify(idea.title, idea.videoId)}.md`;
  await writeAgentOSFile(
    assessmentPath,
    matter.stringify(`# Should AgentOS adopt: ${idea.title}\n\n${assessment}\n`, {
      tags: ["learning", "assessment"],
      verdict: verdict.verdict,
      size: verdict.size ?? null,
      videoId: idea.videoId,
      note: idea.notePath ?? null,
      created: new Date().toISOString().slice(0, 10),
    }),
  );
  await closeFiledJob(idea.jobId);

  return updateIdea(idea.id, {
    stage: "awaiting_decision",
    error: undefined,
    failedAt: undefined,
    assessmentPath,
    verdict: verdict.verdict,
    verdictWhy: verdict.why,
    size: verdict.size,
    runs: endRun(idea, "completed"),
  });
}
