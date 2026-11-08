import { z } from "zod";
import { WorkerIdSchema } from "./worker-ids";

/**
 * Friction: the small annoyances of using AgentOS, written down the moment
 * they happen so they can be fixed in order of how much they cost.
 */

export const FRICTION_FREQUENCIES = ["once", "sometimes", "often"] as const;
export const FRICTION_SEVERITIES = ["low", "medium", "high"] as const;
export const FRICTION_STATUSES = ["open", "assigned", "in-progress", "needs-review", "fixed", "verified", "ignored"] as const;

export const FrictionFrequencySchema = z.enum(FRICTION_FREQUENCIES);
export const FrictionSeveritySchema = z.enum(FRICTION_SEVERITIES);
export const FrictionStatusSchema = z.enum(FRICTION_STATUSES);

export type FrictionFrequency = z.infer<typeof FrictionFrequencySchema>;
export type FrictionSeverity = z.infer<typeof FrictionSeveritySchema>;
export type FrictionStatus = z.infer<typeof FrictionStatusSchema>;

/**
 * A correction is friction with a duty attached: the owner said an agent got
 * something wrong, so a test must exist that fails on the wrong behaviour
 * before it can be called fixed.
 */
export const FRICTION_KINDS = ["friction", "correction"] as const;
export const FrictionKindSchema = z.enum(FRICTION_KINDS);
export type FrictionKind = z.infer<typeof FrictionKindSchema>;

export const CORRECTION_SOURCE_TYPES = ["manual", "job-rejected", "job-revision", "visual-revision"] as const;
export const CorrectionSourceSchema = z.object({
  type: z.enum(CORRECTION_SOURCE_TYPES),
  jobId: z.string().optional(),
  /** The job's attempt, so one job and attempt is one correction. */
  attempt: z.number().optional(),
  project: z.string().optional(),
});
export type CorrectionSource = z.infer<typeof CorrectionSourceSchema>;

export const REGRESSION_STATUSES = ["needed", "in-progress", "covered", "not-testable"] as const;
export const RegressionSchema = z.object({
  status: z.enum(REGRESSION_STATUSES),
  testPath: z.string().optional(),
  jobId: z.string().optional(),
  reason: z.string().optional(),
});
export type Regression = z.infer<typeof RegressionSchema>;

/** A test path is repo-relative: never absolute, never climbing out with `..`. */
export function isSafeTestPath(value: string): boolean {
  const path = value.trim();
  if (!path || path.length > 300) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes("..");
}

export const RepairJobSchema = z.object({
  jobId: z.string(),
  worker: WorkerIdSchema.optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(["running", "completed", "failed", "blocked"]),
  error: z.string().optional(),
  commitSha: z.string().optional(),
});

export type RepairJob = z.infer<typeof RepairJobSchema>;

export const VerificationSchema = z.object({
  verifiedAt: z.string(),
  checkCommand: z.string().optional(),
  checkResult: z.string().optional(),
  commitSha: z.string().optional(),
  ownerConfirmed: z.boolean().default(false),
});

export type Verification = z.infer<typeof VerificationSchema>;

export const FrictionItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  route: z.string().optional(),
  frequency: FrictionFrequencySchema,
  severity: FrictionSeveritySchema,
  status: FrictionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  /** Items saved before corrections existed have no kind, and load as plain friction. */
  kind: FrictionKindSchema.default("friction"),
  /** What should have happened. Required for a correction. */
  expected: z.string().max(1000).optional(),
  source: CorrectionSourceSchema.optional(),
  regression: RegressionSchema.optional(),
  /** The workspace this friction belongs to. Defaults to agentos. */
  project: z.string().default("agentos"),
  /** How to reproduce the issue. */
  reproduction: z.string().max(2000).optional(),
  /** Linked repair job history. */
  repairJobs: z.array(RepairJobSchema).default([]),
  /** Verification evidence when fixed. */
  verification: VerificationSchema.optional(),
  /** Reason for failed or blocked state. */
  failureReason: z.string().optional(),
});

export type FrictionItem = z.infer<typeof FrictionItemSchema>;

export const ReportFrictionRequestSchema = z
  .object({
    description: z.string().trim().min(3).max(1000),
    route: z.string().trim().max(300).optional(),
    frequency: FrictionFrequencySchema,
    severity: FrictionSeveritySchema,
    kind: FrictionKindSchema.optional(),
    expected: z.string().trim().max(1000).optional(),
    source: CorrectionSourceSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.kind === "correction" && (value.expected?.length ?? 0) < 3) {
      context.addIssue({ code: "custom", path: ["expected"], message: "Say what should have happened." });
    }
  });

export type ReportFrictionRequest = z.infer<typeof ReportFrictionRequestSchema>;

export const UpdateFrictionRequestSchema = z.object({
  status: FrictionStatusSchema.optional(),
  reproduction: z.string().trim().max(2000).optional(),
  project: z.string().trim().max(200).optional(),
  failureReason: z.string().trim().max(1000).optional(),
}).refine(
  (data) => data.status !== undefined || data.reproduction !== undefined || data.project !== undefined || data.failureReason !== undefined,
  { message: "At least one field must be provided" },
);

export const AssignToAgentRequestSchema = z.object({
  worker: z.union([WorkerIdSchema, z.literal("auto")]).default("auto"),
});

export type AssignToAgentRequest = z.infer<typeof AssignToAgentRequestSchema>;

export const CompleteRepairRequestSchema = z.object({
  verification: VerificationSchema.optional(),
  ownerConfirmed: z.boolean().default(false),
});

export type CompleteRepairRequest = z.infer<typeof CompleteRepairRequestSchema>;

/** Marking a correction's regression test by hand: covered by a test at a path, or not testable, with a reason. */
export const SetRegressionRequestSchema = z
  .object({
    status: z.enum(["covered", "not-testable"]),
    testPath: z.string().trim().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "covered" && !(value.testPath && isSafeTestPath(value.testPath))) {
      context.addIssue({ code: "custom", path: ["testPath"], message: "Give the test's path inside the repository, with no .. and not absolute." });
    }
    if (value.status === "not-testable" && !value.reason) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Say why it can't be tested." });
    }
  });
export type SetRegressionRequest = z.infer<typeof SetRegressionRequestSchema>;

export const StartRegressionJobRequestSchema = z.object({
  /** "auto" lets routing choose. Tests name the mock worker so nothing real runs. */
  worker: z.union([WorkerIdSchema, z.literal("auto")]).default("auto"),
});

export const FRICTION_FREQUENCY_WEIGHT: Record<FrictionFrequency, number> = { once: 1, sometimes: 2, often: 3 };
export const FRICTION_SEVERITY_WEIGHT: Record<FrictionSeverity, number> = { low: 1, medium: 2, high: 3 };

export type FrictionTier = "high" | "medium" | "low";

export interface RankedFrictionItem extends FrictionItem {
  /** frequency × severity, 1–9. */
  priority: number;
  tier: FrictionTier;
}

export interface FrictionResponse {
  /** Open items, highest priority first. */
  open: RankedFrictionItem[];
  /** Fixed and ignored items, most recently changed first. */
  closed: RankedFrictionItem[];
}

/** Turns a route into a page name a person recognises: `/memory?note=x` → `Memory`. */
export function pageNameForRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const first = route.split(/[?#]/)[0].split("/").filter(Boolean)[0];
  if (!first) return "Dashboard";
  const names: Record<string, string> = {
    workspaces: "Workspaces",
    memory: "Memory",
    knowledge: "Knowledge",
    designs: "Creative",
    operations: "Operations",
    automations: "Automations",
    connectors: "Connectors",
    activity: "Activity",
    workers: "Worker jobs",
    agents: "Agents",
    agent: "Hermes console",
    inbox: "Inbox",
    finance: "Finance",
    databases: "Databases",
  };
  return names[first] ?? first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, " ");
}
