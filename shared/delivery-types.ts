import { z } from "zod";
import { RebuildStageIdSchema, RebuildStageStatusSchema, RebuildStartSchema, ReviewVerdictSchema } from "./website-rebuild-types";
import { WorkspaceTypeSchema } from "./workspace";

/**
 * Delivery: one place above the workspaces to take a client's website from
 * nothing (or from wherever it stopped) to a preview. It drives the existing
 * website rebuild, one run per workspace; it is not a second pipeline.
 */

/** Where a workspace's delivery stands. */
export const DeliveryStateSchema = z.enum(["not_started", "running", "needs_you", "blocked", "done"]);
export type DeliveryState = z.infer<typeof DeliveryStateSchema>;

export const DeliveryWorkspaceSchema = z.object({
  slug: z.string(),
  name: z.string(),
  workspaceType: WorkspaceTypeSchema.optional(),
  state: DeliveryStateSchema,
  /** The rebuild this workspace already has. Starting again resumes it. */
  runId: z.string().optional(),
  /** The first stage that is not complete, when there is a run. */
  stage: RebuildStageIdSchema.optional(),
  stageStatus: RebuildStageStatusSchema.optional(),
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  previewUrl: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type DeliveryWorkspace = z.infer<typeof DeliveryWorkspaceSchema>;

/** Something only the person can move: a revision to review, or a stage that stopped. */
export const DeliveryDecisionSchema = z.object({
  runId: z.string(),
  workspaceSlug: z.string().optional(),
  company: z.string(),
  stage: RebuildStageIdSchema,
  kind: z.enum(["review", "blocked"]),
  revision: z.number().int().nonnegative(),
  /** The revision's summary, or why the stage stopped. */
  detail: z.string(),
  review: ReviewVerdictSchema.optional(),
  since: z.string(),
});
export type DeliveryDecision = z.infer<typeof DeliveryDecisionSchema>;

export const DeliveryOverviewSchema = z.object({
  workspaces: z.array(DeliveryWorkspaceSchema),
  decisions: z.array(DeliveryDecisionSchema),
});
export type DeliveryOverview = z.infer<typeof DeliveryOverviewSchema>;

/** Starting a delivery from a workspace: the rebuild's brief, with the workspace standing in for the prospect. */
export const DeliveryStartSchema = RebuildStartSchema.omit({ prospectId: true, company: true })
  .extend({ workspaceSlug: z.string().trim().min(1).max(120) })
  .strict();
export type DeliveryStartInput = z.input<typeof DeliveryStartSchema>;
export type DeliveryStart = z.output<typeof DeliveryStartSchema>;

/** The prospect id a run started from a workspace carries, so one workspace can only ever have one run. */
export const workspaceProspectId = (slug: string) => `workspace:${slug}`;
