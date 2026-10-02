import { randomUUID } from "node:crypto";
import type { OperatorRun, TaskProposal } from "../../shared/operator-types";
import type { SeoAuditRun } from "../../shared/seo-types";
import { readOptionalFile } from "../agentos/filesystem";
import { parseRepositoryPath } from "../agentos/projects";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { createDocument } from "../agentos/mutations/documents";
import { createProject, patchProject } from "../agentos/mutations/projects";
import { createTask, InvalidRequestError } from "../agentos/mutations/tasks";
import { delegateTask, prepareDelegation } from "../agentos/task-delegation";
import { sendToHermes } from "../hermes/client";
import { extractJson } from "../hermes/worker-review";
import { memoryService } from "../memory/service";
import { searchIndex } from "../memory/search";
import { runSeoAudit } from "../seo/audit";
import { readProjectSeo } from "../seo/store";
import { getProjectVercelInfo } from "../vercel/client";
import type { Operation, OperationContext, OperationRegistry } from "./engine";
import { detectStack } from "./intent-router";
import { createProjectFolder, plannedFolder, ProjectFolderError } from "./project-folder";

/**
 * What Operator can actually do today, each one an existing AgentOS operation.
 *
 * Nothing here is new capability: creating a workspace is `createProject`,
 * filing a task is `createTask`, delegating is the same `prepareDelegation` →
 * `delegateTask` path the task panel uses, an audit is `runSeoAudit`. Operator
 * sequences them; it does not get a second, private way of writing the vault.
 *
 * An operation that writes verifies its own write before it reports done.
 */

const PROJECTS_DIR = "projects";
const FILE_CHARS = 2_500;

function clip(text: string | undefined, max = FILE_CHARS): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function workspaceOf(context: Pick<OperationContext, "run" | "scratch">): { slug: string; name: string } {
  const slug = context.scratch.workspaceSlug ?? context.run.intent?.workspace?.slug;
  if (!slug) throw new Error("This run has no workspace.");
  return { slug, name: context.run.intent?.workspace?.name ?? slug };
}

/** For prechecks: the workspace must already exist. */
function existingWorkspace(run: OperatorRun): { slug: string; name: string } | undefined {
  const workspace = run.intent?.workspace;
  return workspace?.action === "use" ? { slug: workspace.slug, name: workspace.name } : undefined;
}

function firstSentence(input: string, max = 140): string {
  const line = (input.trim().split(/\r?\n/)[0] ?? "").replace(/\s+/g, " ");
  const sentence = /^(.+?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

// ------------------------------------------------------------------ read

const memorySearch: Operation = {
  async run({ run, scratch }) {
    const service = memoryService();
    if (!service.isAvailable()) {
      return { result: `Vault memory isn't available: ${service.status().reason ?? "the vault is not connected"}.` };
    }

    const hits = searchIndex(service.index, run.input, 6);
    scratch.memoryText = hits
      .map((hit) => `### ${hit.title} (${hit.id})${hit.heading ? ` › ${hit.heading}` : ""}\n${hit.snippet ?? ""}`)
      .join("\n\n");
    const outputs = hits.map((hit) => ({ label: hit.title, href: `/memory?view=notes&note=${encodeURIComponent(hit.id)}` }));
    scratch.sources.push(...outputs);

    return { result: hits.length > 0 ? `${hits.length} note${hits.length === 1 ? "" : "s"} matched.` : "Nothing in the vault matched.", outputs };
  },
};

function describeAudit(audit: SeoAuditRun | undefined): string {
  if (!audit) return "No SEO audit recorded.";
  const counts = ["critical", "warning", "info"].map((severity) => `${audit.findings.filter((finding) => finding.severity === severity).length} ${severity}`);
  return [
    `Last SEO audit of ${audit.targetUrl} on ${audit.startedAt.slice(0, 10)} (${audit.status}): ${counts.join(", ")}.`,
    ...audit.findings.slice(0, 12).map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.description}`),
  ].join("\n");
}

const workspaceRead: Operation = {
  async run(context) {
    const { slug, name } = workspaceOf(context);
    const directory = `${PROJECTS_DIR}/${slug}`;
    const [project, status, tasks, decisions] = await Promise.all(
      ["PROJECT.md", "STATUS.md", "TASKS.md", "DECISIONS.md"].map((file) => readOptionalFile(`${directory}/${file}`)),
    );

    let seo: string;
    try {
      seo = describeAudit(readProjectSeo(slug).latest);
    } catch {
      seo = "SEO audits couldn't be read.";
    }

    context.scratch.workspaceText = [
      `## ${name}: PROJECT.md\n${clip(project)}`,
      `## STATUS.md\n${clip(status)}`,
      `## TASKS.md\n${clip(tasks)}`,
      `## DECISIONS.md\n${clip(decisions)}`,
      `## SEO\n${seo}`,
    ].join("\n\n");

    const output = { label: name, href: `/workspaces/${encodeURIComponent(slug)}` };
    context.scratch.sources.push(output);
    return { result: `Read ${name}'s status, tasks, decisions and SEO.`, outputs: [output] };
  },
};

const hermesAnswer: Operation = {
  async run(context) {
    const { run, scratch, signal } = context;
    context.modelCall();
    const reply = await sendToHermes(
      [
        "--- QUESTION ---",
        run.input,
        "",
        "--- FROM THE VAULT ---",
        scratch.memoryText || "(nothing matched)",
        ...(scratch.workspaceText ? ["", "--- WORKSPACE ---", scratch.workspaceText] : []),
      ].join("\n"),
      {
        operation: "chat",
        project: run.intent?.workspace?.action === "use" ? run.intent.workspace.slug : undefined,
        runId: run.id,
        signal,
        system: [
          "Answer the question from the material given. Be direct and concrete.",
          "Use short Markdown: a sentence of answer first, then a list if one helps.",
          "Where the material does not say, say you don't know rather than guessing.",
          "This is read-only: do not offer to make changes, and do not claim to have made any.",
        ].join("\n"),
      },
    );
    scratch.answer = reply.trim();
    return { result: "Answered." };
  },
};

// ------------------------------------------------------------------ write, local

async function linkedFolder(slug: string): Promise<string | undefined> {
  const project = await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`);
  return project ? parseRepositoryPath(project) : undefined;
}

/**
 * The project's folder under the projects root, named by the workspace slug.
 * A path is never read from the request: only the slug, which the router
 * derived and `project-folder.ts` validates again.
 */
const createFolder: Operation = {
  fix: { label: "Set the projects folder", href: "/connectors/filesystem" },
  async precheck(run) {
    const workspace = run.intent?.workspace;
    if (!workspace) return "Name the project, e.g. “a SaaS called RankPulse”, so the folder has a name.";
    if (workspace.action === "use") {
      const existing = await linkedFolder(workspace.slug);
      if (existing) return `${workspace.name} already has a folder: ${existing}.`;
    }
    try {
      await plannedFolder(workspace.slug);
      return undefined;
    } catch (error) {
      return error instanceof ProjectFolderError ? error.message : "The projects folder couldn't be checked.";
    }
  },
  async run(context) {
    const workspace = context.run.intent?.workspace;
    if (!workspace) throw new Error("There is no project name for the folder.");

    const folder = await createProjectFolder(workspace.slug);
    context.scratch.folderPath = folder;
    context.change("local", `Folder created: ${folder}`);

    // An existing workspace gets linked here; a new one is linked as it is created.
    if (workspace.action === "use" && !(await linkedFolder(workspace.slug))) {
      await patchProject({ slug: workspace.slug, repoPath: folder });
      context.change("local", `${workspace.name} linked to ${folder}`, `/workspaces/${encodeURIComponent(workspace.slug)}`);
    }

    return { result: `Created ${folder}.`, outputs: [{ label: folder }] };
  },
};

const createWorkspace: Operation = {
  async run(context) {
    const { run, scratch } = context;
    const workspace = run.intent?.workspace;
    if (!workspace || workspace.action !== "create") throw new Error("No new workspace was planned.");

    const created = await createProject({
      name: workspace.name,
      slug: workspace.slug,
      goal: run.objective,
      // The folder this run just made, so the workspace knows where its code lives.
      repoPath: scratch.folderPath,
      type: run.intent?.workflow === "business-venture" ? "Venture" : "Product",
      state: "incubating",
      priority: "medium",
    });

    // Verify: the workspace is only "created" if its file is there to read.
    if (!(await readOptionalFile(`${PROJECTS_DIR}/${created.slug}/PROJECT.md`))) {
      throw new Error(`${created.name} was written but can't be read back.`);
    }

    scratch.workspaceSlug = created.slug;
    const href = `/workspaces/${encodeURIComponent(created.slug)}`;
    context.change("local", `Workspace ${created.name} created`, href);
    return { result: `${created.name} created.`, outputs: [{ label: created.name, href }] };
  },
};

async function createTasks(context: OperationContext, proposals: TaskProposal[]): Promise<string[]> {
  const created: string[] = [];
  for (const proposal of proposals) {
    if (proposal.taskId) continue;
    const { taskId } = await createTask({ slug: proposal.workspaceSlug, title: proposal.title, section: proposal.section });
    proposal.taskId = taskId;
    created.push(taskId);
  }
  if (created.length > 0) {
    context.change("local", `${created.length} task${created.length === 1 ? "" : "s"} added: ${created.join(", ")}`, `/workspaces/${encodeURIComponent(proposals[0].workspaceSlug)}?tab=tasks`);
  }
  return created;
}

const seedTasks: Operation = {
  async run(context) {
    const { slug } = workspaceOf(context);
    const proposals = context.run.taskProposals.filter((proposal) => proposal.workspaceSlug === slug);
    if (proposals.length === 0) return { result: "No first tasks were planned." };

    const created = await createTasks(context, proposals);
    return {
      result: `${created.length} task${created.length === 1 ? "" : "s"} added.`,
      outputs: [{ label: "Tasks", href: `/workspaces/${encodeURIComponent(slug)}?tab=tasks` }],
    };
  },
};

const createOneTask: Operation = {
  async precheck(run) {
    return existingWorkspace(run) ? undefined : "Name the workspace this is for, e.g. “Add a pricing page to Pantry Pilot”.";
  },
  async run(context) {
    const { slug } = workspaceOf(context);
    const { taskId } = await createTask({ slug, title: firstSentence(context.run.input), section: "now" });
    context.scratch.taskId = taskId;
    const href = `/workspaces/${encodeURIComponent(slug)}?tab=tasks&task=${encodeURIComponent(taskId)}`;
    context.change("local", `Task ${taskId} added`, href);
    return { result: `${taskId} filed under Now.`, outputs: [{ label: taskId, href }] };
  },
};

const delegate: Operation = {
  async precheck(run) {
    const workspace = existingWorkspace(run);
    if (!workspace) return "Name the workspace this is for.";
    const project = await readOptionalFile(`${PROJECTS_DIR}/${workspace.slug}/PROJECT.md`);
    return project && parseRepositoryPath(project) ? undefined : `Link a local repository to ${workspace.name} first (workspace Settings).`;
  },
  async run(context) {
    const { slug } = workspaceOf(context);
    const taskId = context.scratch.taskId;
    if (!taskId) throw new Error("There is no task to delegate.");

    context.modelCall();
    const { preview, error } = await prepareDelegation(slug, taskId, "auto", { routingMode: "auto" });
    if (!preview) throw new Error(error ?? "The task couldn't be scoped.");
    if (preview.policy?.status === "blocked") throw new Error(preview.policy.blockedReason ?? preview.policy.reason);
    if (context.signal.aborted) throw new Error("Stopped before the job started.");

    const { job, error: startError } = await delegateTask(slug, taskId, {
      plan: preview.plan,
      worker: "auto",
      routing: preview.routing,
      routingMode: "auto",
    });
    if (!job) throw new Error(startError ?? "The worker job didn't start.");

    context.run.jobIds.push(job.id);
    const worker = job.resolvedWorker ?? job.worker;
    const href = `/workers/jobs/${encodeURIComponent(job.id)}`;
    context.change("local", `Worker job started (${worker}) in an isolated checkout`, href);
    return { result: `${worker} is working on ${taskId}. Review it when it's done.`, outputs: [{ label: `Job ${job.id.slice(0, 8)}`, href }] };
  },
};

async function resolveTargetUrl(run: OperatorRun, slug: string): Promise<string | undefined> {
  if (run.intent?.targetUrl) return run.intent.targetUrl;
  const configuration = parseConfiguration(await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`));
  if (!configuration.vercelProjectId) return undefined;
  const info = await getProjectVercelInfo(configuration.vercelProjectId, configuration.vercelProjectName ?? configuration.vercelProjectId);
  return info.liveUrl;
}

const seoCrawl: Operation = {
  async precheck(run) {
    const workspace = existingWorkspace(run);
    if (!workspace) return "Name the workspace this site belongs to, e.g. “Audit Virtara SEO”.";
    if (run.intent?.targetUrl) return undefined;
    const configuration = parseConfiguration(await readOptionalFile(`${PROJECTS_DIR}/${workspace.slug}/PROJECT.md`));
    return configuration.vercelProjectId ? undefined : `No site to crawl: name its URL, or link a Vercel project to ${workspace.name}.`;
  },
  async run(context) {
    const { slug } = workspaceOf(context);
    const url = await resolveTargetUrl(context.run, slug);
    if (!url) throw new Error("No live URL was found for this workspace.");

    const audit = await runSeoAudit(slug, url);
    if (audit.status === "failed") throw new Error(audit.error ?? "The audit could not be completed.");

    context.scratch.audit = audit;
    const href = `/workspaces/${encodeURIComponent(slug)}?tab=seo`;
    context.change("local", `SEO audit of ${url} stored (${audit.findings.length} findings)`, href);
    return { result: `${audit.findings.length} findings on ${url}.`, outputs: [{ label: "SEO tab", href }] };
  },
};

const SECTIONS = new Set(["now", "next", "later"]);

const seoFindings: Operation = {
  async run(context) {
    const { slug } = workspaceOf(context);
    const audit = context.scratch.audit as SeoAuditRun | undefined;
    const open = (audit?.findings ?? []).filter((finding) => !finding.taskId && finding.severity !== "info");
    if (open.length === 0) return { result: "Nothing worth a task." };

    let proposals: TaskProposal[] | undefined;
    try {
      context.modelCall();
      const reply = await sendToHermes(
        ["Findings from a mechanical SEO audit:", ...open.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.description}`)].join("\n"),
        {
          operation: "planning",
          project: slug,
          runId: context.run.id,
          signal: context.signal,
          system: [
            "Turn these findings into at most five tasks for next week, highest impact first.",
            'Reply with one JSON object and nothing else: { "tasks": [{ "title": "imperative, under 80 characters", "section": "now" | "next", "why": "one line" }] }',
          ].join("\n"),
        },
      );
      const payload = extractJson(reply) as { tasks?: unknown } | undefined;
      if (Array.isArray(payload?.tasks)) {
        proposals = payload.tasks.slice(0, 5).flatMap((entry): TaskProposal[] => {
          const task = entry as Record<string, unknown>;
          if (typeof task.title !== "string" || !task.title.trim()) return [];
          return [
            {
              id: randomUUID(),
              workspaceSlug: slug,
              title: task.title.trim().slice(0, 120),
              section: typeof task.section === "string" && SECTIONS.has(task.section) ? (task.section as TaskProposal["section"]) : "next",
              why: typeof task.why === "string" ? task.why.slice(0, 200) : undefined,
            },
          ];
        });
      }
    } catch {
      // Falls through to the findings as they are: they are already concrete.
    }

    const prioritisedBy = proposals && proposals.length > 0 ? "Hermes" : "severity";
    if (!proposals || proposals.length === 0) {
      proposals = [...open]
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))
        .slice(0, 5)
        .map((finding) => ({
          id: randomUUID(),
          workspaceSlug: slug,
          title: finding.title.slice(0, 120),
          section: finding.severity === "critical" ? ("now" as const) : ("next" as const),
          why: finding.description.slice(0, 200),
        }));
    }

    context.run.taskProposals.push(...proposals);
    return { result: `${proposals.length} task${proposals.length === 1 ? "" : "s"} proposed, prioritised by ${prioritisedBy}. None created yet.` };
  },
};

const hermesAnalysis: Operation = {
  async run(context) {
    context.modelCall();
    const reply = await sendToHermes(`--- IDEA ---\n${context.run.input}`, {
      operation: "planning",
      runId: context.run.id,
      signal: context.signal,
      system: [
        "Analyse this business idea as a sceptical operator would, in Markdown with these headings:",
        "## Who it's for (the narrowest ICP worth starting with)",
        "## What must be true (the assumptions, riskiest first)",
        "## First experiment (cheapest test of the riskiest assumption, with a pass mark)",
        "## Next action (one thing to do this week)",
        "Do not invent market numbers. Where something needs research, say what to find out.",
      ].join("\n"),
    });
    context.scratch.analysis = reply.trim();
    return { result: "Idea analysed." };
  },
};

const writeAnalysis: Operation = {
  async run(context) {
    const { slug } = workspaceOf(context);
    const content = context.scratch.analysis;
    if (!content) throw new Error("There is no analysis to save.");

    const { artifact } = await createDocument(slug, {
      title: "Idea analysis",
      type: "research",
      content,
      source: "hermes",
    });
    const href = `/workspaces/${encodeURIComponent(slug)}?tab=documents`;
    context.change("local", `Document “${artifact.title}” saved`, href);
    return { result: "Saved to the workspace's documents.", outputs: [{ label: artifact.title, href }] };
  },
};

/**
 * The memory step. Operational facts are already recorded deterministically,
 * in the run's changes and the activity log. What is proposed here is
 * interpretation: a stack choice, a venture hypothesis. Those wait for a
 * person, and become decisions only when accepted.
 */
const record: Operation = {
  async run(context) {
    const { run } = context;
    const slug = context.scratch.workspaceSlug ?? run.intent?.workspace?.slug;
    const proposals: { title: string; body: string }[] = [];
    const date = new Date().toISOString().slice(0, 10);
    const request = firstSentence(run.input, 240);

    if (slug && run.intent?.workflow === "new-code-project") {
      const stack = detectStack(run.input);
      if (stack.length > 0) proposals.push({ title: "Stack", body: `${stack.join(", ")}, as asked on ${date}: “${request}”` });
    }
    if (slug && run.intent?.workflow === "business-venture" && run.objective) {
      proposals.push({ title: "Venture hypothesis", body: `${run.objective}\n\nFrom the request on ${date}: “${request}”` });
    }

    for (const proposal of proposals) {
      if (!slug) break;
      run.memoryProposals.push({ id: randomUUID(), workspaceSlug: slug, ...proposal, status: "proposed" });
    }

    const facts = run.changes.length;
    return {
      result: `${facts} change${facts === 1 ? "" : "s"} recorded in the run log${proposals.length > 0 ? `; ${proposals.length} decision${proposals.length === 1 ? "" : "s"} proposed for memory` : ""}.`,
    };
  },
};

/**
 * The registry. An operation missing here is a step Operator can't do yet;
 * the engine blocks it and says so rather than attempting it.
 */
export const OPERATIONS: OperationRegistry = {
  "memory.search": memorySearch,
  "workspace.read": workspaceRead,
  "hermes.answer": hermesAnswer,
  "hermes.analysis": hermesAnalysis,
  "hermes.seo_findings": seoFindings,
  "filesystem.create_directory": createFolder,
  "agentos.create_workspace": createWorkspace,
  "agentos.seed_tasks": seedTasks,
  "agentos.create_task": createOneTask,
  "agentos.write_document": writeAnalysis,
  "agentos.record": record,
  "worker.delegate": delegate,
  "seo.crawl": seoCrawl,
};

/** Creates tasks a person picked from a run's proposals. */
export async function createProposedTasks(run: OperatorRun, ids: readonly string[]): Promise<string[]> {
  if (run.mode !== "run") throw new InvalidRequestError("Only a run can add tasks. Run the plan first.");
  const picked = run.taskProposals.filter((proposal) => ids.includes(proposal.id) && !proposal.taskId);
  // Never into a workspace that doesn't exist: that would leave a stray folder
  // with a TASKS.md and no project around it.
  for (const slug of new Set(picked.map((proposal) => proposal.workspaceSlug))) {
    if (!(await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`))) {
      throw new InvalidRequestError(`The workspace ${slug} doesn't exist.`);
    }
  }
  const created: string[] = [];
  const at = new Date().toISOString();
  for (const proposal of picked) {
    const { taskId } = await createTask({ slug: proposal.workspaceSlug, title: proposal.title, section: proposal.section });
    proposal.taskId = taskId;
    created.push(taskId);
  }
  if (created.length > 0) {
    run.changes.push({
      at,
      stepId: "proposals",
      kind: "local",
      description: `${created.length} proposed task${created.length === 1 ? "" : "s"} added: ${created.join(", ")}`,
      href: `/workspaces/${encodeURIComponent(picked[0].workspaceSlug)}?tab=tasks`,
    });
  }
  return created;
}
