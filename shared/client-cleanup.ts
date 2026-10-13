import { z } from "zod";

/**
 * Cleaning up what was built for a business that never showed interest.
 *
 * Everything is previewed before anything is deleted: what exists, how big it
 * is, and whether AgentOS can show it made it. The business's record and every
 * email sent to them are always kept.
 */

/** Days a business must have been quiet before its work can be cleaned up. */
export const CLEANUP_AFTER_DAYS = 14;

export const CleanupItemIdSchema = z.enum(["github_repo", "vercel_project", "local_site", "workspace", "records"]);
export type CleanupItemId = z.infer<typeof CleanupItemIdSchema>;

/** Which of these can never be undone from your machine, and so need the company name typed. */
export const REMOTE_ITEMS: readonly CleanupItemId[] = ["github_repo", "vercel_project"];

export const CleanupItemSchema = z.object({
  id: CleanupItemIdSchema,
  label: z.string(),
  /** Where it is: a folder, a repository, a project. */
  location: z.string(),
  /** `ready`: can be deleted. `blocked`: exists but AgentOS will not delete it, and `reason` says why. `unavailable`: cannot be checked right now. `not_found`: nothing there. */
  state: z.enum(["ready", "blocked", "unavailable", "not_found"]),
  reason: z.string().optional(),
  bytes: z.number().int().optional(),
  files: z.number().int().optional(),
  /** The walk stopped early, so the size is at least this much. */
  approximate: z.boolean().optional(),
  warnings: z.array(z.string()),
  remote: z.boolean(),
  /** Remote items are never ticked for you. */
  defaultChecked: z.boolean(),
});
export type CleanupItem = z.infer<typeof CleanupItemSchema>;

export const CleanupPreviewSchema = z.object({
  prospectId: z.string(),
  company: z.string(),
  eligible: z.boolean(),
  /** Why not, in words, when it is not eligible. */
  ineligibleReasons: z.array(z.string()),
  items: z.array(CleanupItemSchema),
  /** What stays, whatever is deleted. */
  keeps: z.array(z.string()),
});
export type CleanupPreview = z.infer<typeof CleanupPreviewSchema>;

export const CleanupRequestSchema = z
  .object({
    items: z.array(CleanupItemIdSchema).min(1).max(5),
    confirm: z.literal(true),
    /** Required when a remote item is chosen: the company's name, typed. */
    confirmCompany: z.string().trim().max(200).optional(),
  })
  .strict();
export type CleanupRequest = z.infer<typeof CleanupRequestSchema>;

export const CleanupResultSchema = z.object({
  results: z.array(
    z.object({
      id: CleanupItemIdSchema,
      status: z.enum(["deleted", "failed", "skipped"]),
      detail: z.string(),
    }),
  ),
  bytesFreed: z.number().int(),
});
export type CleanupResult = z.infer<typeof CleanupResultSchema>;

/** A business whose work could be cleaned up. Cheap to compute: no sizes. */
export const CleanupCandidateSchema = z.object({
  prospectId: z.string(),
  company: z.string(),
  stage: z.string(),
  /** Why it qualifies, in words. */
  reason: z.string(),
  workspaceSlug: z.string().optional(),
});
export type CleanupCandidate = z.infer<typeof CleanupCandidateSchema>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
