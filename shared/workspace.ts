import { z } from "zod";

/**
 * Workspaces: the presentation layer over projects.
 *
 * A workspace is a meaningful area of work — a product, a business, a client,
 * a personal area — with goals, information, tasks and activity. It is not
 * necessarily a code repository. On disk it is still an AgentOS project: the
 * same `projects/<slug>/` directory and the same five files. Only what the
 * interface shows changes with the type.
 *
 * Nothing here imports from `agentos-types`, which imports from here.
 */

export const WorkspaceTypeSchema = z.enum([
  "product",
  "business",
  "client",
  "software",
  "personal",
  "research",
  "general",
]);

export const WorkspaceModuleSchema = z.enum([
  "tasks",
  "roadmap",
  "documents",
  "creative",
  "repository",
  "decisions",
  "activity",
  "agents",
  "clients",
  "seo",
]);

export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;
export type WorkspaceModule = z.infer<typeof WorkspaceModuleSchema>;

export const WORKSPACE_TYPES = WorkspaceTypeSchema.options;
export const WORKSPACE_MODULES = WorkspaceModuleSchema.options;

export const WORKSPACE_TYPE_LABELS: Record<WorkspaceType, string> = {
  product: "Product",
  business: "Business",
  client: "Client",
  software: "Software",
  personal: "Personal",
  research: "Research",
  general: "General",
};

export const WORKSPACE_TYPE_DESCRIPTIONS: Record<WorkspaceType, string> = {
  product: "Something being built for users, with a roadmap.",
  business: "A company or line of work: clients, delivery, revenue.",
  client: "Work delivered for one client, against milestones.",
  software: "A codebase first. Repository and agents up front.",
  personal: "Admin, health, money — life outside the work.",
  research: "Questions being investigated and what was found.",
  general: "Anything else. The full set, without assumptions.",
};

/**
 * The tabs each type starts with, in order.
 *
 * Configured modules replace this list wholesale. Anything not in it is still
 * reachable from More — a default hides a module, it never removes one.
 */
export const DEFAULT_WORKSPACE_MODULES: Record<WorkspaceType, readonly WorkspaceModule[]> = {
  product: ["tasks", "roadmap", "documents", "creative", "decisions", "activity"],
  business: ["tasks", "roadmap", "documents", "clients", "creative", "decisions", "activity"],
  client: ["tasks", "roadmap", "documents", "creative", "decisions", "activity"],
  software: ["tasks", "roadmap", "documents", "repository", "decisions", "activity", "agents"],
  personal: ["tasks", "documents", "decisions", "activity"],
  research: ["tasks", "documents", "decisions", "activity"],
  general: ["tasks", "roadmap", "documents", "creative", "decisions", "activity"],
};

export const WORKSPACE_MODULE_LABELS: Record<WorkspaceModule, string> = {
  tasks: "Tasks",
  roadmap: "Roadmap",
  documents: "Documents",
  creative: "Creative",
  repository: "Repository",
  decisions: "Decisions",
  activity: "Activity",
  agents: "Agents",
  clients: "Clients",
  seo: "SEO",
};

/** The label a module's tab carries in a workspace of this type. */
export function moduleLabel(module: WorkspaceModule, type: WorkspaceType): string {
  // A client engagement is delivered against milestones; "roadmap" is a product word.
  if (module === "roadmap" && type === "client") return "Milestones";
  return WORKSPACE_MODULE_LABELS[module];
}

/**
 * Portfolio `Type:` labels that name a workspace type exactly.
 *
 * Exact only, by decision: "Agency / Client Work" could be a business or a
 * client, and "AI SaaS" could be a product or software. Those stay `general`
 * until the operator says otherwise in Settings.
 */
const EXACT_TYPE_LABELS: Record<string, WorkspaceType> = {
  product: "product",
  business: "business",
  client: "client",
  "client work": "client",
  software: "software",
  personal: "personal",
  research: "research",
  general: "general",
};

export function deriveWorkspaceType(portfolioType: string | undefined): WorkspaceType {
  const key = portfolioType?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return EXACT_TYPE_LABELS[key] ?? "general";
}

/** The configured type when there is one, otherwise the exact-match derivation. */
export function resolveWorkspaceType(
  configured: WorkspaceType | undefined,
  portfolioType: string | undefined,
): WorkspaceType {
  return configured ?? deriveWorkspaceType(portfolioType);
}

export interface WorkspaceTabs {
  /** Shown as tabs, in order. Overview is implied and always first. */
  primary: WorkspaceModule[];
  /** Everything else, one click away under More. */
  more: WorkspaceModule[];
}

/**
 * Which modules a workspace shows as tabs and which sit under More.
 *
 * `hasRepository` lets a linked repository earn a tab in a workspace whose
 * type would not show one by default — a client site with a repo, say —
 * without the operator having to configure modules for it.
 */
export function resolveWorkspaceTabs(input: {
  type: WorkspaceType;
  configured?: readonly WorkspaceModule[];
  hasRepository?: boolean;
}): WorkspaceTabs {
  const configured = input.configured && input.configured.length > 0 ? input.configured : undefined;
  const primary = [...(configured ?? DEFAULT_WORKSPACE_MODULES[input.type])];

  if (!configured && input.hasRepository && !primary.includes("repository")) {
    const at = primary.indexOf("decisions");
    primary.splice(at === -1 ? primary.length : at, 0, "repository");
  }

  const unique = primary.filter((module, index) => primary.indexOf(module) === index);
  const more = WORKSPACE_MODULES.filter((module) => !unique.includes(module));

  return { primary: unique, more };
}

/** Tolerant parse of a `Modules:` line: unknown words are dropped, not fatal. */
export function parseModuleList(value: string | undefined): WorkspaceModule[] {
  if (!value) return [];

  const aliases: Record<string, WorkspaceModule> = { designs: "creative", milestones: "roadmap", repo: "repository" };
  const modules = value
    .split(/[,;]/)
    .map((word) => word.trim().toLowerCase())
    .map((word) => aliases[word] ?? word)
    .filter((word): word is WorkspaceModule => (WORKSPACE_MODULES as readonly string[]).includes(word));

  return modules.filter((module, index) => modules.indexOf(module) === index);
}
