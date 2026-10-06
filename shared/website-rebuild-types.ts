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
  // Claude Code is not on this list: its jobs are denied WebFetch and WebSearch, so it cannot cite live pages.
  research: ["grok-bot", "hermes-worker", "gemini"],
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
    /** Empty when they have no website: the capture stage is then skipped. */
    websiteUrl: z.union([z.literal(""), z.string().trim().url().max(500).regex(/^https?:\/\//, "The website must start with http:// or https://")]).default(""),
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
  /** A worker the person picked for this stage, used instead of the plan's order until they pick again. */
  workerOverride: WorkerIdSchema.optional(),
});

/**
 * The prospect's own branding, read from their current site at capture:
 * logos, photos, colours and fonts. The concepts and the build use it so the
 * new site looks like *their* business, not a template.
 *
 * Images are stored in the workspace as image artifacts. Every asset can be
 * left out (`include: false`) before the hero stage seeds `brand/` into the
 * client repo. SVG and ICO files never get this far: capture rasterises them
 * to PNG, so no client-supplied markup reaches a worker, a page or Vercel.
 */
export const BrandAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["logo", "photo"]),
  /** The image artifact that holds the file. */
  artifactId: z.string(),
  /** Vault-relative path of the stored file. */
  path: z.string(),
  /** Where it was found on the client's site. */
  sourceUrl: z.string(),
  alt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  include: z.boolean().default(true),
});

export const BrandColorRoleSchema = z.enum(["background", "text", "heading", "header", "accent", "link"]);
export const BrandColorSchema = z.object({
  hex: z.string().regex(/^#[0-9a-f]{6}$/),
  role: BrandColorRoleSchema,
  /** How many sampled elements used it: a rough measure of how much it matters. */
  weight: z.number().int().positive(),
});

export const BrandFontSchema = z.object({
  /** A family name only: it is written into a worker's brief, so nothing that reads as markup or an instruction. */
  family: z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} _.-]+$/u, "A font name may use letters, numbers, spaces, dots, dashes and underscores."),
  role: z.enum(["body", "heading"]),
});

export const BrandKitSchema = z.object({
  capturedAt: z.string(),
  /** `capture` until a person changes it. */
  source: z.enum(["capture", "edited"]).default("capture"),
  assets: z.array(BrandAssetSchema),
  colors: z.array(BrandColorSchema),
  fonts: z.array(BrandFontSchema),
});

/** What a person may change on the kit: which images are used, in what order, and the colours and fonts. */
export const BrandKitEditSchema = z
  .object({
    /** Every asset's id in the order wanted; the first included logo is the primary one. */
    assets: z.array(z.object({ id: z.string().min(1).max(80), include: z.boolean() }).strict()).max(60),
    colors: z.array(BrandColorSchema.omit({ weight: true }).strict()).max(12),
    fonts: z.array(BrandFontSchema.strict()).max(6),
  })
  .strict();
export type BrandKitEdit = z.infer<typeof BrandKitEditSchema>;

export const MAX_BRAND_ASSETS = 40;
export const BrandUploadKindSchema = z.enum(["logo", "photo"]);

export type BrandAsset = z.infer<typeof BrandAssetSchema>;
export type BrandColor = z.infer<typeof BrandColorSchema>;
export type BrandFont = z.infer<typeof BrandFontSchema>;
export type BrandKit = z.infer<typeof BrandKitSchema>;

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
  /** Why there is no captured site to work from (no website, a social page, blocked by robots.txt), when capture was skipped. */
  siteNote: z.string().optional(),
  /** The hero concept approved at checkpoint 1, which the build follows. */
  heroChoice: z.string().optional(),
  /** The client's branding from their current site, once capture has run. */
  brandKit: BrandKitSchema.optional(),
  /** `owner/name` of the client's private GitHub repo, once stage 7 made it. */
  githubRepo: z.string().optional(),
  vercelProject: z.string().optional(),
  /** The Vercel deployment being built or checked, so a retry waits on it instead of requesting another. */
  deploymentId: z.string().optional(),
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

/** Hosts that are a profile on someone else's platform, not a website of the business's own. */
const SOCIAL_PROFILE_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "fb.me": "Facebook",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "twitter.com": "X",
  "x.com": "X",
  "tiktok.com": "TikTok",
  "youtube.com": "YouTube",
  "linktr.ee": "Linktree",
  "wa.me": "WhatsApp",
  "g.page": "Google Business",
  "yelp.com": "Yelp",
};

/** `"Facebook"` for a Facebook page address, undefined for a real website (or not an address at all). */
export function socialProfilePlatform(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile|web|business)\./, "");
  } catch {
    return undefined;
  }
  if (host === "google.com" && /^\/maps\b/.test(new URL(url).pathname)) return "Google Maps";
  if (host === "maps.google.com" || host === "maps.app.goo.gl") return "Google Maps";
  return SOCIAL_PROFILE_HOSTS[host] ?? Object.entries(SOCIAL_PROFILE_HOSTS).find(([domain]) => host.endsWith(`.${domain}`))?.[1];
}

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

/** Stages that hand their work to a worker, and what the worker must be able to do. */
export const WORKER_STAGES: Partial<Record<RebuildStageId, "research" | "code">> = {
  research: "research",
  hero: "code",
  build: "code",
  functions: "code",
};

export const StageWorkerOptionSchema = z.object({
  id: WorkerIdSchema,
  name: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
  /** On this stage's usual list. */
  inPlan: z.boolean(),
});
export const StageWorkerOptionsSchema = z.object({ workers: z.array(StageWorkerOptionSchema) });
export const RebuildRetryInputSchema = z.object({ worker: z.union([WorkerIdSchema, z.literal("plan")]).optional() }).strict();
export type StageWorkerOption = z.infer<typeof StageWorkerOptionSchema>;
