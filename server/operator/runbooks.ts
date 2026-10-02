import type { OperatorMode, RouteWorkspace, RunRisk, WorkflowId } from "../../shared/operator-types";

/**
 * Runbooks: the normal flow for each kind of request, written down once.
 *
 * Hermes is not paid to reinvent "how do you start a SaaS" on every request.
 * The runbook already knows the steps; the router picks the runbook, Hermes
 * fills in what is specific to this request (a name, an objective, the first
 * tasks), and the engine works out which steps can actually run here.
 *
 * A step is listed whether or not AgentOS can do it yet. That is deliberate:
 * a plan that silently leaves out "create the GitHub repository" because
 * there is no adapter is a plan that lies about what is left to do. The
 * engine marks those steps blocked and says why.
 */

export interface StepTemplate {
  id: string;
  title: string;
  detail?: string;
  /** The executor operation. Unknown operations are blocked, never guessed at. */
  operation: string;
  actor: string;
  capabilityId?: string;
  risk: RunRisk;
  external: boolean;
  dependsOn: string[];
}

export interface RunbookContext {
  workspace?: RouteWorkspace;
  targetUrl?: string;
  /** Where new code projects go, e.g. `/Volumes/SSD/Developer`. Display only in V1. */
  projectsRoot?: string;
  /** Stack words the request named (`Next.js`, `Supabase`), for step detail. */
  stack: string[];
}

export interface Runbook {
  id: WorkflowId;
  name: string;
  description: string;
  example: string;
  /** The mode the example is meant for. */
  mode: OperatorMode;
  intent: string;
  interpretedAs: string;
  steps: (context: RunbookContext) => StepTemplate[];
}

function step(template: Omit<StepTemplate, "dependsOn" | "external"> & { dependsOn?: string[]; external?: boolean }): StepTemplate {
  return { dependsOn: [], external: false, ...template };
}

function folderFor(context: RunbookContext): string {
  const slug = context.workspace?.slug ?? "new-project";
  return context.projectsRoot ? `${context.projectsRoot.replace(/\/+$/, "")}/${slug}` : `<projects folder>/${slug}`;
}

function workspaceSteps(context: RunbookContext, id = "workspace"): StepTemplate[] {
  if (context.workspace?.action === "use") return [];
  return [
    step({
      id,
      title: "Create AgentOS workspace",
      detail: context.workspace?.name,
      operation: "agentos.create_workspace",
      actor: "AgentOS",
      capabilityId: "filesystem.write_project_files",
      risk: "local-write",
    }),
  ];
}

/** Where the workspace a step depends on comes from: created in this run, or already there. */
function workspaceDependency(context: RunbookContext, id = "workspace"): string[] {
  return context.workspace?.action === "use" ? [] : [id];
}

const recordStep = (dependsOn: string[]): StepTemplate =>
  step({
    id: "record",
    title: "Update memory",
    detail: "Record what changed; propose durable decisions for you to accept",
    operation: "agentos.record",
    actor: "AgentOS",
    capabilityId: "filesystem.write_project_files",
    risk: "local-write",
    dependsOn,
  });

export const RUNBOOKS: Record<WorkflowId, Runbook> = {
  question: {
    id: "question",
    name: "Ask",
    description: "Read the vault and the workspace, then answer. Changes nothing.",
    example: "What are the biggest SEO problems with Virtara?",
    mode: "ask",
    intent: "Answer a question",
    interpretedAs: "Question",
    steps: (context) => [
      step({
        id: "memory",
        title: "Search memory",
        detail: "The vault's notes, decisions and project files",
        operation: "memory.search",
        actor: "AgentOS",
        capabilityId: "filesystem.read_vault",
        risk: "read",
      }),
      ...(context.workspace?.action === "use"
        ? [
            step({
              id: "workspace-read",
              title: `Read ${context.workspace.name}`,
              detail: "Status, open tasks, decisions and the last SEO audit",
              operation: "workspace.read",
              actor: "AgentOS",
              capabilityId: "filesystem.read_vault",
              risk: "read",
            }),
          ]
        : []),
      step({
        id: "answer",
        title: "Answer",
        operation: "hermes.answer",
        actor: "Hermes",
        capabilityId: "hermes.run_agent",
        risk: "read",
        dependsOn: ["memory"],
      }),
    ],
  },

  "new-code-project": {
    id: "new-code-project",
    name: "New SaaS",
    description: "Folder, workspace, repository, first build, validation, GitHub and Vercel.",
    example: "Build me a new SEO monitoring SaaS called RankPulse on my SSD, use Next.js and Supabase, create the GitHub repo and deploy it to Vercel.",
    mode: "run",
    intent: "Create project",
    interpretedAs: "New software project",
    steps: (context) => [
      step({
        id: "plan",
        title: "Plan the project",
        detail: "Name, objective, first tasks and risks",
        operation: "hermes.plan",
        actor: "Hermes",
        capabilityId: "hermes.run_agent",
        risk: "read",
      }),
      step({
        id: "folder",
        title: "Create project folder",
        detail: folderFor(context),
        operation: "filesystem.create_directory",
        actor: "AgentOS",
        capabilityId: "filesystem.create_directory",
        risk: "local-write",
      }),
      step({
        id: "scaffold",
        title: `Initialise ${context.stack.find((name) => /next/i.test(name)) ?? "the app"}`,
        operation: "code.scaffold",
        actor: "AgentOS",
        risk: "local-write",
        dependsOn: ["folder"],
      }),
      ...workspaceSteps(context),
      step({
        id: "tasks",
        title: "Add the first tasks",
        operation: "agentos.seed_tasks",
        actor: "AgentOS",
        capabilityId: "filesystem.write_project_files",
        risk: "local-write",
        dependsOn: ["plan", ...workspaceDependency(context)],
      }),
      step({ id: "git", title: "Initialise Git", operation: "git.init", actor: "Git", capabilityId: "git.init", risk: "local-write", dependsOn: ["scaffold"] }),
      step({
        id: "repo",
        title: "Create GitHub repository",
        operation: "github.create_repository",
        actor: "GitHub",
        capabilityId: "github.create_repository",
        risk: "external-write",
        external: true,
        dependsOn: ["git"],
      }),
      step({
        id: "build",
        title: "Build initial application",
        detail: context.stack.length > 0 ? context.stack.join(" · ") : undefined,
        operation: "worker.implement",
        actor: "Claude",
        capabilityId: "claude.run_job",
        risk: "local-write",
        dependsOn: ["git", "tasks"],
      }),
      step({ id: "validate", title: "Validate", detail: "lint · test · build", operation: "worker.validate", actor: "AgentOS", risk: "read", dependsOn: ["build"] }),
      step({
        id: "push",
        title: "Push main",
        operation: "git.push",
        actor: "Git",
        capabilityId: "git.push",
        risk: "external-write",
        external: true,
        dependsOn: ["validate", "repo"],
      }),
      step({
        id: "vercel-project",
        title: "Create Vercel project",
        operation: "vercel.create_project",
        actor: "Vercel",
        capabilityId: "vercel.create_project",
        risk: "external-write",
        external: true,
        dependsOn: ["repo"],
      }),
      step({
        id: "deploy",
        title: "Deploy production",
        operation: "vercel.deploy_production",
        actor: "Vercel",
        capabilityId: "vercel.deploy_production",
        risk: "external-write",
        external: true,
        dependsOn: ["vercel-project", "push"],
      }),
      step({
        id: "verify",
        title: "Verify deployment",
        operation: "vercel.verify",
        actor: "Vercel",
        capabilityId: "vercel.read_deployments",
        risk: "read",
        dependsOn: ["deploy"],
      }),
      recordStep(workspaceDependency(context)),
    ],
  },

  "seo-audit": {
    id: "seo-audit",
    name: "SEO Audit",
    description: "Search data, a crawl of the live site, findings, and proposed tasks.",
    example: "Audit Virtara SEO and create the highest priority work for next week.",
    mode: "run",
    intent: "Audit a site",
    interpretedAs: "SEO audit",
    steps: (context) => [
      step({
        id: "search-console",
        title: "Read Search Console",
        detail: "Queries, impressions and clicks",
        operation: "search-console.read_performance",
        actor: "Search Console",
        capabilityId: "search-console.read_performance",
        risk: "read",
      }),
      step({ id: "ga4", title: "Read GA4", detail: "Landing-page traffic", operation: "ga4.read_traffic", actor: "GA4", capabilityId: "ga4.read_traffic", risk: "read" }),
      step({
        id: "crawl",
        title: "Crawl the live site",
        detail: context.targetUrl ?? "The workspace's linked Vercel domain",
        operation: "seo.crawl",
        actor: "AgentOS",
        // Stored locally: the audit becomes part of the workspace's SEO tab.
        capabilityId: "filesystem.write_project_files",
        risk: "local-write",
      }),
      step({
        id: "findings",
        title: "Prioritise findings",
        detail: "Critical first, then opportunities; tasks proposed, not created",
        operation: "hermes.seo_findings",
        actor: "Hermes",
        capabilityId: "hermes.run_agent",
        risk: "read",
        dependsOn: ["crawl"],
      }),
      recordStep(["crawl"]),
    ],
  },

  "business-venture": {
    id: "business-venture",
    name: "New Business Venture",
    description: "Idea analysis, research, workspace, ICP and experiment, prototype, repository and preview.",
    example: "I want to test a SaaS for South African estate agents that automatically creates listing content.",
    mode: "run",
    intent: "Test a business idea",
    interpretedAs: "New business venture",
    steps: (context) => [
      step({
        id: "analysis",
        title: "Analyse the idea",
        detail: "Who it is for, what must be true, first experiment",
        operation: "hermes.analysis",
        actor: "Hermes",
        capabilityId: "hermes.run_agent",
        risk: "read",
      }),
      step({ id: "research", title: "Research the market", operation: "web.research", actor: "Web research", risk: "read" }),
      ...workspaceSteps(context),
      step({
        id: "document",
        title: "Save the analysis",
        detail: "Idea analysis.md in the workspace",
        operation: "agentos.write_document",
        actor: "AgentOS",
        capabilityId: "filesystem.write_project_files",
        risk: "local-write",
        dependsOn: ["analysis", ...workspaceDependency(context)],
      }),
      step({
        id: "tasks",
        title: "Add the first tasks",
        operation: "agentos.seed_tasks",
        actor: "AgentOS",
        capabilityId: "filesystem.write_project_files",
        risk: "local-write",
        dependsOn: ["analysis", ...workspaceDependency(context)],
      }),
      step({ id: "experiment", title: "Set up the traction experiment", detail: "ICP and outreach target", operation: "traction.experiment", actor: "Traction", risk: "local-write", dependsOn: ["analysis"] }),
      step({ id: "concepts", title: "Landing page concepts", operation: "creative.concepts", actor: "Creative", capabilityId: "higgsfield.generate", risk: "external-write", external: true, dependsOn: ["analysis"] }),
      step({ id: "folder", title: "Create project folder", detail: folderFor(context), operation: "filesystem.create_directory", actor: "AgentOS", capabilityId: "filesystem.create_directory", risk: "local-write" }),
      step({ id: "prototype", title: "Build a prototype", operation: "worker.implement", actor: "Claude", capabilityId: "claude.run_job", risk: "local-write", dependsOn: ["folder", "tasks"] }),
      step({ id: "repo", title: "Create GitHub repository", operation: "github.create_repository", actor: "GitHub", capabilityId: "github.create_repository", risk: "external-write", external: true, dependsOn: ["prototype"] }),
      step({ id: "preview", title: "Deploy a preview", operation: "vercel.create_preview", actor: "Vercel", capabilityId: "vercel.create_preview", risk: "external-write", external: true, dependsOn: ["repo"] }),
      recordStep(workspaceDependency(context)),
    ],
  },

  "existing-project-task": {
    id: "existing-project-task",
    name: "Workspace task",
    description: "File the task in its workspace and delegate it to a worker. Review stays in the workspace.",
    example: "Add a pricing page to Pantry Pilot.",
    mode: "run",
    intent: "Change an existing project",
    interpretedAs: "Work on an existing project",
    steps: (context) => [
      step({
        id: "task",
        title: `File the task in ${context.workspace?.name ?? "its workspace"}`,
        operation: "agentos.create_task",
        actor: "AgentOS",
        capabilityId: "filesystem.write_project_files",
        risk: "local-write",
      }),
      step({
        id: "delegate",
        title: "Delegate to a worker",
        detail: "Hermes scopes it, the route policy picks the worker, the job runs in an isolated checkout",
        operation: "worker.delegate",
        actor: "Worker",
        capabilityId: "claude.run_job",
        risk: "local-write",
        dependsOn: ["task"],
      }),
      recordStep(["task"]),
    ],
  },
};

export function runbookFor(workflow: WorkflowId): Runbook {
  return RUNBOOKS[workflow];
}
