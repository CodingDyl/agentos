import { z } from "zod";

/**
 * Ship: finish a generated project inside its workspace.
 *
 * One panel covers git, a local preview, Vercel deploys, the live site, and
 * a change list that becomes a coding-agent job. Secrets stay in process env
 * (`GITHUB_TOKEN`, `VERCEL_API_TOKEN`) or `gh auth` — never in the repo.
 */

export const SHIP_CHANGE_PRIORITIES = ["low", "medium", "high"] as const;
export const SHIP_CHANGE_STATUSES = ["open", "in_progress", "done"] as const;
export const SHIP_DEV_STATUSES = ["stopped", "installing", "starting", "running", "error"] as const;
export const SHIP_DEPLOY_TARGETS = ["preview", "production"] as const;
export const SHIP_PREVIEW_SOURCES = ["local", "live"] as const;

export const ShipChangePrioritySchema = z.enum(SHIP_CHANGE_PRIORITIES);
export const ShipChangeStatusSchema = z.enum(SHIP_CHANGE_STATUSES);
export const ShipDevStatusSchema = z.enum(SHIP_DEV_STATUSES);
export const ShipDeployTargetSchema = z.enum(SHIP_DEPLOY_TARGETS);
export const ShipPreviewSourceSchema = z.enum(SHIP_PREVIEW_SOURCES);

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
  remoteUrl: z.string().optional(),
  remote: ShipGitRemoteSchema.optional(),
  setup: z.string().optional(),
});

export const ShipDevStateSchema = z.object({
  status: ShipDevStatusSchema,
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).nullable(),
  script: z.string().nullable(),
  port: z.number().int().positive().optional(),
  url: z.string().optional(),
  logs: z.array(z.string()),
  error: z.string().optional(),
  startedAt: z.string().optional(),
});

export const ShipDeployStateSchema = z.object({
  configured: z.boolean(),
  setup: z.string().optional(),
  vercelProjectId: z.string().optional(),
  vercelProjectName: z.string().optional(),
  target: ShipDeployTargetSchema.optional(),
  id: z.string().optional(),
  state: z.string().optional(),
  url: z.string().optional(),
  logs: z.string().optional(),
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
  dev: ShipDevStateSchema,
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

export const ShipLinkRepoRequestSchema = z.object({
  repo: z.string().min(1).max(300),
});

export const ShipCreateRepoRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  private: z.boolean().optional(),
});

export const ShipLinkVercelRequestSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).optional(),
});

export const ShipDeployRequestSchema = z.object({
  target: ShipDeployTargetSchema,
});

export const ShipAddChangeRequestSchema = z.object({
  text: z.string().min(1).max(2_000),
  page: z.string().max(300).optional(),
  url: z.string().max(2_000).optional(),
  screenshot: z.string().max(6_000_000).optional(),
  priority: ShipChangePrioritySchema.optional(),
});

export const ShipPatchChangeRequestSchema = z.object({
  text: z.string().min(1).max(2_000).optional(),
  page: z.string().max(300).optional(),
  url: z.string().max(2_000).optional(),
  priority: ShipChangePrioritySchema.optional(),
  selected: z.boolean().optional(),
  status: ShipChangeStatusSchema.optional(),
});

export const ShipSendChangesRequestSchema = z.object({
  ids: z.array(z.string()).optional(),
});

export type ShipChangePriority = z.infer<typeof ShipChangePrioritySchema>;
export type ShipChangeStatus = z.infer<typeof ShipChangeStatusSchema>;
export type ShipDevStatus = z.infer<typeof ShipDevStatusSchema>;
export type ShipDeployTarget = z.infer<typeof ShipDeployTargetSchema>;
export type ShipPreviewSource = z.infer<typeof ShipPreviewSourceSchema>;
export type ShipGitRemote = z.infer<typeof ShipGitRemoteSchema>;
export type ShipGitState = z.infer<typeof ShipGitStateSchema>;
export type ShipDevState = z.infer<typeof ShipDevStateSchema>;
export type ShipDeployState = z.infer<typeof ShipDeployStateSchema>;
export type ShipLiveState = z.infer<typeof ShipLiveStateSchema>;
export type ShipChangeItem = z.infer<typeof ShipChangeItemSchema>;
export type ShipSnapshot = z.infer<typeof ShipSnapshotSchema>;
export type ShipAddChangeRequest = z.infer<typeof ShipAddChangeRequestSchema>;
export type ShipPatchChangeRequest = z.infer<typeof ShipPatchChangeRequestSchema>;
export type ShipSendChangesRequest = z.infer<typeof ShipSendChangesRequestSchema>;

export const GITHUB_SETUP_HINT =
  "Add GITHUB_TOKEN to .env (classic repo scope) or run `gh auth login`. AgentOS never writes the token into the project.";
export const VERCEL_SETUP_HINT =
  "Add VERCEL_API_TOKEN to .env (optional VERCEL_TEAM_ID). The same token the Site tab already uses. AgentOS never writes it into the project.";

const PREVIEW_PORT = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})|Local:\s+https?:\/\/[^/\s]+:(\d{2,5})|ready (?:started server )?on[^]*?:(\d{2,5})/i;

/** First listening port mentioned in a local-dev log line. */
export function detectPreviewPort(log: string): number | undefined {
  const match = PREVIEW_PORT.exec(log);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return undefined;
  const port = Number.parseInt(raw, 10);
  return port > 0 && port <= 65535 ? port : undefined;
}

const GITHUB_URL = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/)?$/i;
const GITHUB_SLUG = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/;

/** `owner/name` from a GitHub URL, SSH remote, or `owner/name`. */
export function parseGithubRepo(input: string): { owner: string; name: string; fullName: string; htmlUrl: string; cloneUrl: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed || /[;&|]/.test(trimmed)) return undefined;
  const fromUrl = GITHUB_URL.exec(trimmed);
  const fromSlug = GITHUB_SLUG.exec(trimmed);
  const owner = fromUrl?.[1] ?? fromSlug?.[1];
  const rawName = fromUrl?.[2] ?? fromSlug?.[2];
  if (!owner || !rawName) return undefined;
  const name = rawName.replace(/\.git$/i, "");
  if (!name) return undefined;
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
