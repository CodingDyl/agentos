import fs from "node:fs/promises";
import path from "node:path";
import {
  MOTION_SITE_ALLOWED_TOOLS,
  MotionLaunchInputSchema,
  assembleMotionPrompt,
  creditToolsAllowed,
  type MotionBrief,
  type MotionLaunchInput,
  type MotionReference,
  type MotionRun,
} from "../../shared/motion-design-types";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { createProject, patchProject, toSlug } from "../agentos/mutations/projects";
import { startJob, readJob, steerJob } from "../workers/job-manager";
import { bundledSkillPath } from "./skill-install";
import { commitSiteFiles, ensureMotionSiteRepo, writeApprovalFile } from "./site-repo";
import { MotionDesignError, clearDraft, createMotionRunId, saveRun } from "./store";

export const MOTION_SITE_TOOLS = [...MOTION_SITE_ALLOWED_TOOLS];

function workspaceName(input: MotionLaunchInput): string {
  const named = input.workspaceName?.trim() || input.brief.brandName?.trim();
  return named || "Motion site";
}

async function copyBundledSkillIntoRepo(repo: string): Promise<void> {
  const bundled = await fs.readFile(bundledSkillPath(), "utf8").catch(() => undefined);
  if (!bundled) return;
  await commitSiteFiles(repo, { ".claude/skills/motion-site-studio/SKILL.md": bundled }, "Add the motion-site-studio skill");
}

function briefMarkdown(brief: MotionBrief, references: MotionReference[]): string {
  return [
    "# Motion Design brief",
    "",
    `- Brand: ${brief.brandName || "(you decide)"}`,
    `- Sells: ${brief.brandSells || "(you decide)"}`,
    `- Audience: ${brief.brandAudience || "(you decide)"}`,
    `- Vibe: ${brief.vibe || "(you decide)"}`,
    `- Journey start: ${brief.journeyStart || "(you decide)"}`,
    `- Journey end: ${brief.journeyEnd || "(you decide)"}`,
    `- Intermediate states: ${brief.journeyBeats || "(you decide)"}`,
    `- Sections: ${brief.sections || "(you decide)"}`,
    `- CTA: ${brief.cta || "(you decide)"}`,
    `- Character: ${brief.extrasCharacter ? "yes" : "no"}`,
    `- Deploy: ${brief.extrasDeploy || "not set"}`,
    "",
    "## References",
    ...references.map((reference) => `- ${reference.url ?? reference.path ?? reference.filename ?? reference.id}: ${reference.note} (${reference.likes.join(", ")})`),
    "",
  ].join("\n");
}

export async function launchMotionDesign(raw: MotionLaunchInput): Promise<MotionRun> {
  const input = MotionLaunchInputSchema.parse(raw);
  const name = workspaceName(input);
  const slug = input.workspaceSlug?.trim() || toSlug(name);
  const existing = await readOptionalFile(`projects/${slug}/PROJECT.md`);
  if (!existing) {
    await createProject({
      name,
      slug,
      goal: `A cinematic motion website for ${input.brief.brandName.trim() || name}.`,
      type: "Product",
      state: "active",
      priority: "medium",
    });
  }

  const repo = await ensureMotionSiteRepo(slug, name);
  await patchProject({ slug, repoPath: repo }).catch(() => undefined);
  await copyBundledSkillIntoRepo(repo);
  const files: Record<string, string | Buffer> = {
    "motion-studio/brief.md": briefMarkdown(input.brief, input.references),
  };
  const storedReferences: MotionReference[] = [];
  for (const reference of input.references) {
    if (reference.kind !== "file" || !reference.path) {
      storedReferences.push(reference);
      continue;
    }
    const bytes = await fs.readFile(reference.path).catch(() => undefined);
    if (!bytes) {
      storedReferences.push(reference);
      continue;
    }
    const name = reference.filename || path.basename(reference.path);
    const relative = `references/${name}`;
    files[relative] = bytes;
    storedReferences.push({ ...reference, path: relative });
  }
  await commitSiteFiles(repo, files, "Add the Motion Design brief and references");

  const prompt = assembleMotionPrompt({
    brief: input.brief,
    references: storedReferences,
    budgetCeiling: input.budgetCeiling,
    codeOnly: input.codeOnly,
    interviewAnswered: true,
  });

  const started = await startJob({
    worker: "claude-code",
    requestedWorker: "claude-code",
    project: slug,
    objective: prompt,
    repoPath: repo,
    modelOverride: input.model,
    effort: input.effort,
    extraAllowedTools: MOTION_SITE_TOOLS,
    claudeSettingSources: "user,project",
    claudeMcpServers: ["playwright"],
    timeoutMs: 45 * 60 * 1000,
    constraints: [
      "Do not submit paid Higgsfield jobs until motion-studio/credits.approved.json exists.",
      "You decide answers are creative only and never authorize spend.",
    ],
    acceptanceCriteria: [
      "Two concepts with itemized credit costs are written to motion-studio/concepts.json.",
      "No Higgsfield spend before AgentOS records an approval.",
    ],
    validationCommands: ["test -s motion-studio/concepts.json"],
  });

  if (!started.job) throw new MotionDesignError(started.error ?? "Claude Code could not be started.", 409);

  const now = new Date().toISOString();
  const run = await saveRun({
    id: createMotionRunId(),
    workspaceSlug: slug,
    status: "running",
    step: "approval",
    brief: input.brief,
    references: storedReferences,
    budgetPlan: input.budgetPlan,
    budgetCeiling: input.budgetCeiling,
    codeOnly: input.codeOnly,
    model: input.model,
    effort: input.effort,
    siteRepoPath: repo,
    proposalJobId: started.job.id,
    concepts: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  });
  await clearDraft();
  return run;
}

export async function approveMotionConcept(
  run: MotionRun,
  input: { conceptId: string; ceiling: number; note?: string },
): Promise<MotionRun> {
  if (run.codeOnly) throw new MotionDesignError("This run is code-only motion — there is no Higgsfield spend to approve.", 422);
  const concept = run.concepts.find((entry) => entry.id === input.conceptId);
  if (!concept) throw new MotionDesignError("Pick one of the two concepts the skill proposed.", 422);
  if (!run.siteRepoPath) throw new MotionDesignError("The site repository is missing.", 409);

  const approval = {
    conceptId: input.conceptId,
    ceiling: input.ceiling,
    plannedCredits: concept.plannedCredits,
    approvedAt: new Date().toISOString(),
    note: input.note,
  };

  await writeApprovalFile(run.siteRepoPath, approval);

  const prompt = [
    assembleMotionPrompt({
      brief: run.brief,
      references: run.references,
      budgetCeiling: input.ceiling,
      codeOnly: false,
      interviewAnswered: true,
    }),
    "",
    `Concept ${concept.id} (${concept.title}) is approved.`,
    `Credit ceiling: ${input.ceiling}. Planned spend: ${concept.plannedCredits}. Keep about 15% of the ceiling as reserve.`,
    "Continue authorized work without asking again. Stop paid generation before exceeding the ceiling.",
    "If you need to go over the ceiling, stop and propose a revised budget — do not spend it.",
    input.note?.trim() ? `Operator note: ${input.note.trim()}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const started = await startJob({
    worker: "claude-code",
    requestedWorker: "claude-code",
    project: run.workspaceSlug,
    objective: prompt,
    repoPath: run.siteRepoPath,
    modelOverride: run.model,
    effort: run.effort,
    extraAllowedTools: [...MOTION_SITE_TOOLS, ...creditToolsAllowed(approval)],
    claudeSettingSources: "user,project",
    claudeMcpServers: ["playwright"],
    timeoutMs: 4 * 60 * 60 * 1000,
    constraints: [
      `Do not exceed ${input.ceiling} Higgsfield credits, including pending charges in motion-credit-ledger.csv.`,
      "Read web references with WebFetch and check the site in the Playwright browser tools (mcp__playwright__*), never by driving Chrome from node.",
    ],
  }, { retryOf: run.proposalJobId });

  if (!started.job) throw new MotionDesignError(started.error ?? "Claude Code could not be started for the build.", 409);

  return saveRun({
    ...run,
    status: "building",
    step: "progress",
    approval,
    budgetCeiling: input.ceiling,
    buildJobId: started.job.id,
    error: undefined,
  });
}

export async function sendMotionNotes(run: MotionRun, text: string): Promise<MotionRun> {
  const note = { at: new Date().toISOString(), text: text.trim() };
  if (run.siteRepoPath) {
    const existing = await fs.readFile(path.join(run.siteRepoPath, "motion-studio", "notes.md"), "utf8").catch(() => "# Operator notes\n");
    await commitSiteFiles(run.siteRepoPath, { "motion-studio/notes.md": `${existing.trim()}\n\n## ${note.at}\n\n${note.text}\n` }, "Add operator notes");
  }

  const jobId = run.buildJobId ?? run.proposalJobId;
  if (jobId) {
    const job = await readJob(jobId);
    if (job && (job.status === "running" || job.status === "preparing")) {
      const steered = await steerJob(jobId, `Operator notes (highest design priority):\n${note.text}`);
      if (!steered.ok && run.siteRepoPath) {
        // Claude Code cannot be steered; a follow-up job carries the notes.
      }
    } else if (run.siteRepoPath && (job?.status === "awaiting_review" || job?.status === "completed" || job?.status === "failed")) {
      const started = await startJob({
        worker: "claude-code",
        requestedWorker: "claude-code",
        project: run.workspaceSlug,
        objective: `Operator notes (highest design priority). Apply these in the next round, then continue the design loop:\n\n${note.text}`,
        repoPath: run.siteRepoPath,
        modelOverride: run.model,
        effort: run.effort,
        extraAllowedTools: [...MOTION_SITE_TOOLS, ...creditToolsAllowed(run.approval)],
        claudeSettingSources: "user,project",
        claudeMcpServers: ["playwright"],
        timeoutMs: 2 * 60 * 60 * 1000,
      }, { retryOf: jobId });
      if (started.job) {
        return saveRun({ ...run, notes: [...run.notes, note], buildJobId: started.job.id, status: "building", error: undefined });
      }
    }
  }

  return saveRun({ ...run, notes: [...run.notes, note] });
}

export function vaultProjectDir(slug: string): string {
  return path.join(agentOSRoot(), "projects", slug);
}
