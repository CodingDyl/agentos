import { z } from "zod";
import { WorkerIdSchema } from "./worker-ids";

/**
 * A client website rebuild: from the prospect's current site to a Vercel
 * preview, in seven stages, with a person approving the deliverable at three
 * checkpoints.
 *
 * Approval is always of one specific revision. A newer revision of an
 * approved deliverable is unapproved until someone looks at it, and the
 * stages that depend on it wait.
 */

export const REBUILD_SKILL_ID = "agentos-website-to-preview";

export const RebuildStageIdSchema = z.enum(["workspace", "capture", "research", "hero", "build", "functions", "preview"]);
export type RebuildStageId = z.infer<typeof RebuildStageIdSchema>;

export const REBUILD_STAGES: readonly { id: RebuildStageId; title: string; detail: string; gate: boolean }[] = [
  { id: "workspace", title: "Workspace", detail: "Create or reuse the client's workspace and start tracking.", gate: false },
  { id: "capture", title: "Website capture", detail: "Read the current site's pages, content, navigation, CTAs and forms.", gate: false },
  { id: "research", title: "Research and Hermes", detail: "Five competitors, five improvements, and a Hermes analysis of the current site.", gate: false },
  { id: "hero", title: "Hero concepts", detail: "Three design systems from the DESIGN.md structure, each with a desktop and mobile hero.", gate: true },
  { id: "build", title: "Copy and structure", detail: "The chosen design, sitemap, page copy, navigation and responsive layouts.", gate: true },
  { id: "functions", title: "Functional components", detail: "Forms, blog or bookings as needed, with every journey tested.", gate: true },
  { id: "preview", title: "Vercel preview", detail: "Deploy the approved revision and check a signed-out visitor can use it.", gate: false },
];

/** Each stage waits for the one before it. A gated stage also waits for its own approval before the next starts. */
export const STAGE_ORDER: readonly RebuildStageId[] = REBUILD_STAGES.map((stage) => stage.id);
export const GATED_STAGES: ReadonlySet<RebuildStageId> = new Set(REBUILD_STAGES.filter((stage) => stage.gate).map((stage) => stage.id));

export const RebuildStageStatusSchema = z.enum(["not_started", "in_progress", "awaiting_approval", "blocked", "complete"]);
export type RebuildStageStatus = z.infer<typeof RebuildStageStatusSchema>;

export const RebuildFunctionSchema = z.enum(["contact_form", "blog", "booking", "newsletter", "ecommerce"]);
export type RebuildFunction = z.infer<typeof RebuildFunctionSchema>;
export const REBUILD_FUNCTION_LABEL: Record<RebuildFunction, string> = {
  contact_form: "Contact form",
  blog: "Blog",
  booking: "Bookings",
  newsletter: "Newsletter sign-up",
  ecommerce: "Online shop",
};

/**
 * Which worker does each stage's work, first choice first. Several workers
 * so subscriptions (Claude Code, Codex, Gemini) carry the heavy stages and
 * paid API calls are the fallback, not the default.
 */
export const RebuildWorkerPlanSchema = z.object({
  research: z.array(WorkerIdSchema).min(1),
  hero: z.array(WorkerIdSchema).min(1),
  build: z.array(WorkerIdSchema).min(1),
  functions: z.array(WorkerIdSchema).min(1),
  /** A second model reads the build before each checkpoint. Empty skips it. */
  review: z.array(WorkerIdSchema).default(["codex"]),
});
export type RebuildWorkerPlan = z.infer<typeof RebuildWorkerPlanSchema>;

export const DEFAULT_WORKER_PLAN: RebuildWorkerPlan = {
  // Grok Bot first: free, but started by hand, so research waits for you to trigger it.
  research: ["grok-bot", "hermes-worker", "claude-code", "gemini"],
  hero: ["claude-code", "codex", "claude"],
  build: ["claude-code", "codex", "claude"],
  functions: ["codex", "claude-code", "claude"],
  review: ["codex"],
};

const Text = (max: number) => z.string().trim().min(1).max(max);

export const RebuildStartSchema = z
  .object({
    prospectId: z.string().min(1).max(200),
    company: Text(120),
    websiteUrl: z.string().trim().url().max(500).regex(/^https?:\/\//, "The website must start with http:// or https://"),
    targetMarket: Text(200),
    location: Text(120),
    conversionGoal: Text(200),
    requiredFunctions: z.array(RebuildFunctionSchema).max(5).default([]),
    /** Vault- or repo-relative path to the DESIGN.md whose structure the concepts follow. */
    designTemplate: z.string().trim().min(1).max(300).default("DESIGN.md"),
    workerPlan: RebuildWorkerPlanSchema.optional(),
  })
  .strict();
export type RebuildStartInput = z.input<typeof RebuildStartSchema>;

export const RebuildArtifactSchema = z.object({
  id: z.string(),
  stage: RebuildStageIdSchema,
  /** `image` artifacts are screenshots, served by the rebuild API. */
  media: z.enum(["document", "image"]).default("document"),
  title: z.string(),
  /** Vault-relative path; the workspace's Documents tab opens it. */
  path: z.string(),
  href: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
});

export const RebuildRevisionSchema = z.object({
  stage: RebuildStageIdSchema,
  revision: z.number().int().positive(),
  summary: z.string(),
  artifactIds: z.array(z.string()),
  /** The client-repo commit this revision is, for stages that change code. */
  ref: z.string().optional(),
  /** Which worker produced it, and the job that ran. */
  worker: z.string().optional(),
  jobId: z.string().optional(),
  createdAt: z.string(),
});

export const RebuildDecisionSchema = z.object({
  id: z.string(),
  stage: RebuildStageIdSchema,
  revision: z.number().int().positive(),
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().optional(),
  /** For the hero checkpoint: the concept chosen. */
  choice: z.string().optional(),
  at: z.string(),
});

export const RebuildEventSchema = z.object({
  id: z.number().int(),
  stage: RebuildStageIdSchema.optional(),
  at: z.string(),
  level: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

export const RebuildStageSchema = z.object({
  id: RebuildStageIdSchema,
  status: RebuildStageStatusSchema,
  /** What is happening now, while in progress. */
  activity: z.string().optional(),
  /** Why it cannot continue, and what would unblock it. */
  blocker: z.string().optional(),
  attempts: z.number().int().nonnegative(),
  /** The latest revision of this stage's deliverable, once there is one. */
  revision: z.number().int().nonnegative(),
  /** The revision a person approved, for gated stages. */
  approvedRevision: z.number().int().positive().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  /** The worker job this stage is waiting on, so a retry resumes it instead of starting another. */
  jobId: z.string().optional(),
});

export const RebuildRunSchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  company: z.string(),
  companySlug: z.string(),
  websiteUrl: z.string(),
  targetMarket: z.string(),
  location: z.string(),
  conversionGoal: z.string(),
  requiredFunctions: z.array(RebuildFunctionSchema),
  designTemplate: z.string(),
  workerPlan: RebuildWorkerPlanSchema,
  skillId: z.string(),
  /** The skill version this run follows. A newer skill never changes a run already under way. */
  skillVersion: z.string(),
  workspaceSlug: z.string().optional(),
  /** Where the client's site code lives. */
  repoPath: z.string().optional(),
  /** The hero concept approved at checkpoint 1, which the build follows. */
  heroChoice: z.string().optional(),
  previewUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.array(RebuildStageSchema),
  artifacts: z.array(RebuildArtifactSchema),
  revisions: z.array(RebuildRevisionSchema),
  decisions: z.array(RebuildDecisionSchema),
  events: z.array(RebuildEventSchema),
});

export const RebuildRunSummarySchema = RebuildRunSchema.pick({
  id: true,
  prospectId: true,
  company: true,
  workspaceSlug: true,
  previewUrl: true,
  updatedAt: true,
  stages: true,
});

export const RebuildDecisionInputSchema = z
  .object({
    revision: z.number().int().positive(),
    note: z.string().trim().max(4000).optional(),
    choice: z.string().trim().max(40).optional(),
  })
  .strict();

/** The three hero concepts' folder names in the client repo. */
export const HERO_CONCEPTS = ["concept-a", "concept-b", "concept-c"] as const;

export type RebuildArtifact = z.infer<typeof RebuildArtifactSchema>;
export type RebuildRevision = z.infer<typeof RebuildRevisionSchema>;
export type RebuildDecision = z.infer<typeof RebuildDecisionSchema>;
export type RebuildEvent = z.infer<typeof RebuildEventSchema>;
export type RebuildStage = z.infer<typeof RebuildStageSchema>;
export type RebuildRun = z.infer<typeof RebuildRunSchema>;
export type RebuildRunSummary = z.infer<typeof RebuildRunSummarySchema>;

/** `"Total Electric (Pty) Ltd"` → `total_electric_pty_ltd`: safe in any filename. */
export function companyFileSlug(company: string): string {
  const slug = company
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "client";
}

/** The step the run is on: the first stage that is not complete. */
export function currentStage(stages: readonly RebuildStage[]): RebuildStage | undefined {
  return STAGE_ORDER.map((id) => stages.find((stage) => stage.id === id)).find((stage) => stage && stage.status !== "complete");
}
