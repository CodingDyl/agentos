import { z } from "zod";
import { DevServerStateSchema } from "./dev-server-types";

/**
 * Ship: finish a generated project inside its workspace.
 *
 * One panel covers git, the local dev server (the Dev tab's, shared), Vercel
 * deploys, the live site, and a change list that becomes one coding-agent
 * job. Secrets stay in the server's environment (`GITHUB_TOKEN`,
 * `VERCEL_API_TOKEN`) or `gh auth` — never in the repo, a remote URL, a log
 * line or a response.
 *
 * Production is never a side effect. A production deploy, and a push that
 * Vercel would build as production, each need the Vercel project's name typed
 * back as confirmation, checked on the server.
 */

export const SHIP_CHANGE_PRIORITIES = ["low", "medium", "high"] as const;
export const SHIP_CHANGE_STATUSES = ["open", "in_progress", "done"] as const;
export const SHIP_DEPLOY_TARGETS = ["preview", "production"] as const;
export const SHIP_PREVIEW_SOURCES = ["local", "live"] as const;

export const ShipChangePrioritySchema = z.enum(SHIP_CHANGE_PRIORITIES);
export const ShipChangeStatusSchema = z.enum(SHIP_CHANGE_STATUSES);
export const ShipDeployTargetSchema = z.enum(SHIP_DEPLOY_TARGETS);
export const ShipPreviewSourceSchema = z.enum(SHIP_PREVIEW_SOURCES);

/** Change ids are minted by the server; anything else is refused before it reaches a path. */
export const SHIP_CHANGE_ID = /^chg_[0-9a-f]{16}$/;

export const ShipGitRemoteSchema = z.object({
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  htmlUrl: z.string(),
});

export const ShipGitStateSchema = z.object({
  folder: z.string().optional(),
  isRepo: z.boolean(),
  branch: z.string().optional(),
  head: z.string().optional(),
  subject: z.string().optional(),
  dirty: z.boolean(),
  changedFiles: z.array(z.string()),
  ahead: z.number().optional(),
  behind: z.number().optional(),
  remote: ShipGitRemoteSchema.optional(),
  /** Pushing this branch makes Vercel build production, so a push needs the confirmation too. */
  pushDeploysProduction: z.boolean().optional(),
  setup: z.string().optional(),
});

export const ShipDeployStateSchema = z.object({
  configured: z.boolean(),
  setup: z.string().optional(),
  vercelProjectId: z.string().optional(),
  vercelProjectName: z.string().optional(),
  target: ShipDeployTargetSchema.optional(),
  id: z.string().optional(),
  commit: z.string().optional(),
  state: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const ShipLiveStateSchema = z.object({
  url: z.string().optional(),
  health: z.string().optional(),
  embedAllowed: z.boolean().optional(),
  embedReason: z.string().optional(),
});

export const ShipChangeItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  page: z.string().optional(),
  url: z.string().optional(),
  screenshotId: z.string().optional(),
  priority: ShipChangePrioritySchema,
  status: ShipChangeStatusSchema,
  selected: z.boolean(),
  jobId: z.string().optional(),
  jobHref: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
});

export const ShipSnapshotSchema = z.object({
  slug: z.string(),
  git: ShipGitStateSchema,
  dev: DevServerStateSchema,
  deploy: ShipDeployStateSchema,
  live: ShipLiveStateSchema,
  changes: z.array(ShipChangeItemSchema),
  auth: z.object({
    github: z.boolean(),
    vercel: z.boolean(),
    githubHint: z.string(),
    vercelHint: z.string(),
  }),
});

const confirmation = z.string().trim().min(1).max(200);

export const ShipLinkRepoRequestSchema = z.object({
  repo: z.string().trim().min(1).max(300),
});

export const ShipCreateRepoRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  confirmProduction: confirmation.optional(),
});

export const ShipPushRequestSchema = z.object({
  confirmProduction: confirmation.optional(),
});

export const ShipLinkVercelRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  projectName: z.string().trim().min(1).max(200).optional(),
});

/** Production carries the typed confirmation; a preview never needs one. */
export const ShipDeployRequestSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("preview") }),
  z.object({ target: z.literal("production"), confirm: confirmation }),
]);

export const ShipAddChangeRequestSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  page: z.string().max(300).optional(),
  url: z.string().max(2_000).optional(),
  screenshot: z.string().max(6_000_000).optional(),
  priority: ShipChangePrioritySchema.optional(),
});

export const ShipPatchChangeRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(2_000).optional(),
    page: z.string().max(300).optional(),
    url: z.string().max(2_000).optional(),
    priority: ShipChangePrioritySchema.optional(),
    selected: z.boolean().optional(),
    status: ShipChangeStatusSchema.optional(),
  })
  .strict();

export const ShipSendChangesRequestSchema = z.object({
  ids: z.array(z.string().regex(SHIP_CHANGE_ID)).max(100).optional(),
});

export type ShipChangePriority = z.infer<typeof ShipChangePrioritySchema>;
export type ShipChangeStatus = z.infer<typeof ShipChangeStatusSchema>;
export type ShipDeployTarget = z.infer<typeof ShipDeployTargetSchema>;
export type ShipPreviewSource = z.infer<typeof ShipPreviewSourceSchema>;
export type ShipGitRemote = z.infer<typeof ShipGitRemoteSchema>;
export type ShipGitState = z.infer<typeof ShipGitStateSchema>;
export type ShipDeployState = z.infer<typeof ShipDeployStateSchema>;
export type ShipLiveState = z.infer<typeof ShipLiveStateSchema>;
export type ShipChangeItem = z.infer<typeof ShipChangeItemSchema>;
export type ShipSnapshot = z.infer<typeof ShipSnapshotSchema>;
export type ShipDeployRequest = z.infer<typeof ShipDeployRequestSchema>;
export type ShipAddChangeRequest = z.infer<typeof ShipAddChangeRequestSchema>;
export type ShipPatchChangeRequest = z.infer<typeof ShipPatchChangeRequestSchema>;

export const GITHUB_SETUP_HINT =
  "Add GITHUB_TOKEN to .env (classic repo scope) or run `gh auth login`. AgentOS never writes the token into the project.";
export const VERCEL_SETUP_HINT =
  "Add VERCEL_API_TOKEN to .env (optional VERCEL_TEAM_ID): the same token the Site tab uses, which Ship also uses to deploy. AgentOS never writes it into the project.";

const GITHUB_URL = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i;
const GITHUB_SLUG = /^([^/]+)\/([^/]+)$/;
const GITHUB_PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** `owner/name` from a GitHub URL, SSH remote, or `owner/name`. Anything with characters GitHub does not allow is refused. */
export function parseGithubRepo(input: string): { owner: string; name: string; fullName: string; htmlUrl: string; cloneUrl: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const match = GITHUB_URL.exec(trimmed) ?? GITHUB_SLUG.exec(trimmed);
  const owner = match?.[1];
  const name = match?.[2]?.replace(/\.git$/i, "");
  if (!owner || !name || !GITHUB_PART.test(owner) || !GITHUB_PART.test(name) || name === "." || name === "..") return undefined;
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    htmlUrl: `https://github.com/${owner}/${name}`,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
  };
}

/** One coding-agent objective from the selected change items. */
export function assembleChangeObjective(items: readonly { text: string; page?: string; url?: string; priority: string }[]): string {
  const lines = items.map((item, index) => {
    const where = [item.page, item.url].filter(Boolean).join(" · ");
    return `${index + 1}. (${item.priority}) ${item.text}${where ? ` — ${where}` : ""}`;
  });
  return [
    "Apply the following visual and copy changes to this project. Keep the existing design system. Do not invent extra scope.",
    "",
    ...lines,
    "",
    "When you finish, the local preview should show each change. Leave a short summary of what you edited.",
  ].join("\n");
}
