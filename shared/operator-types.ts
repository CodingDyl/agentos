import { z } from "zod";

/**
 * Operator: one request in, one auditable run out.
 *
 * Every request follows the same loop — understand, gather context, plan,
 * route, execute, verify, record, report — and every pass through it is an
 * `OperatorRun` persisted on disk, so what AgentOS did (and did not do) can be
 * read back afterwards.
 *
 * Three modes, because they carry three different permissions:
 * - `ask`   read-only. Gathers context and answers. Refuses any step that writes.
 * - `plan`  produces the plan and stops. Nothing runs.
 * - `run`   plans, waits for a person to approve anything that writes, then executes.
 *
 * Nothing here carries a secret. Step results are labels and links, never a
 * key or a message body.
 */

export const OperatorModeSchema = z.enum(["ask", "plan", "run"]);

/** What kind of thing the request is. The router's first, fast decision. */
export const RequestDomainSchema = z.enum(["coding", "seo", "business", "research", "operations"]);

/**
 * The most a run could change, in increasing order. Coarser than a
 * capability's risk on purpose: this is the one word a person reads before
 * pressing Run.
 */
export const RunRiskSchema = z.enum(["read", "local-write", "external-write", "communication"]);

/** The runbook a request is planned from. */
export const WorkflowIdSchema = z.enum([
  "question",
  "new-code-project",
  "seo-audit",
  "business-venture",
  "existing-project-task",
]);

/** Which router made the decision. `jev` is reserved for when Jev is reachable. */
export const RouterIdSchema = z.enum(["rules", "hermes", "jev"]);

export const DomainScoreSchema = z.object({
  domain: RequestDomainSchema,
  /** 0–1. The scores of one decision sum to 1. */
  score: z.number().min(0).max(1),
});

export const RouteWorkspaceSchema = z.object({
  /** `use` an existing workspace, or `create` a new one. */
  action: z.enum(["use", "create"]),
  slug: z.string(),
  name: z.string(),
});

/**
 * What AgentOS decided the request is. Shown to the person as decisions,
 * not as a model's chain of thought.
 */
export const RouteDecisionSchema = z.object({
  router: RouterIdSchema,
  domain: RequestDomainSchema,
  domainScores: z.array(DomainScoreSchema),
  /** A short verb phrase: "Create project", "Audit a site", "Answer a question". */
  intent: z.string(),
  /** One line: "New software project". */
  interpretedAs: z.string(),
  risk: RunRiskSchema,
  workflow: WorkflowIdSchema,
  workspace: RouteWorkspaceSchema.optional(),
  /** Capability ids (`github.create_repository`) the plan needs. */
  requiredCapabilities: z.array(z.string()),
  /** A target URL named in the request, for audits. */
  targetUrl: z.string().optional(),
  /** Why, in a sentence or two. */
  why: z.string(),
});

export const OperatorStepStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  /** Cannot run here: no adapter, connector off, or capability disabled. */
  "blocked",
  /** Not attempted because something it depends on did not finish. */
  "skipped",
  /** Not attempted because the run was stopped. */
  "stopped",
]);

export const StepOutputSchema = z.object({
  label: z.string(),
  /** A same-origin AgentOS link (`/workspaces/…`), or an external URL. */
  href: z.string().optional(),
});

export const OperatorStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  /** The executor operation this step runs. */
  operation: z.string(),
  /** Who does it: `Hermes`, `Claude`, `AgentOS`, `GitHub`… */
  actor: z.string(),
  capabilityId: z.string().optional(),
  risk: RunRiskSchema,
  /** Changes something outside this machine. Listed under "External changes". */
  external: z.boolean(),
  dependsOn: z.array(z.string()),
  status: OperatorStepStatusSchema,
  /** Why it is blocked, failed or skipped. */
  reason: z.string().optional(),
  /** What it did, in one line. */
  result: z.string().optional(),
  outputs: z.array(StepOutputSchema),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

export const OperatorRunStatusSchema = z.enum([
  "planning",
  "awaiting_approval",
  "running",
  "blocked",
  "completed",
  "failed",
  /** A person pressed Stop. What changed before that is in `changes`. */
  "stopped",
]);

/** Something the run changed, recorded as it happened. What Stop reports. */
export const RunChangeSchema = z.object({
  at: z.string(),
  stepId: z.string(),
  kind: z.enum(["local", "external"]),
  description: z.string(),
  href: z.string().optional(),
});

/**
 * A durable interpretation the run wants remembered — an architecture
 * decision, a finding. Proposed, never written, until a person accepts it.
 * Operational facts (a workspace now exists) are recorded as changes instead.
 */
export const MemoryProposalSchema = z.object({
  id: z.string(),
  workspaceSlug: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["proposed", "accepted", "dismissed"]),
});

/** A task the run suggests but does not create until a person picks it. */
export const TaskProposalSchema = z.object({
  id: z.string(),
  workspaceSlug: z.string(),
  title: z.string(),
  section: z.enum(["now", "next", "later"]),
  why: z.string().optional(),
  /** Set once created, so it is never offered twice. */
  taskId: z.string().optional(),
});

export const RunReportSchema = z.object({
  /** A sentence or two: what happened. */
  summary: z.string(),
  /** Ask mode's answer, as Markdown. */
  answer: z.string().optional(),
  /** What the answer drew on. */
  sources: z.array(StepOutputSchema),
  /** The single most useful next thing for the person to do. */
  nextAction: z.string().optional(),
});

export const RunUsageSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  /** Tokens as far as the provider reported them. Absent means unknown, not zero. */
  tokens: z.number().int().nonnegative().optional(),
  /** Priced model spend, when the provider priced it. */
  costUsd: z.number().nonnegative().optional(),
  /** Rough, from the kind of steps planned. Not a quote. */
  estimate: z.string(),
});

export const OperatorRunSchema = z.object({
  id: z.string(),
  input: z.string(),
  mode: OperatorModeSchema,
  /** Present once the request is understood. */
  intent: RouteDecisionSchema.optional(),
  workspaceId: z.string().optional(),
  objective: z.string().optional(),
  plan: z.array(OperatorStepSchema),
  risks: z.array(z.string()),
  agents: z.array(z.string()),
  connectors: z.array(z.string()),
  status: OperatorRunStatusSchema,
  /** Why it is blocked or failed, in one line. */
  statusDetail: z.string().optional(),
  changes: z.array(RunChangeSchema),
  memoryProposals: z.array(MemoryProposalSchema),
  taskProposals: z.array(TaskProposalSchema),
  /** Worker jobs this run started, so Stop can stop them too. */
  jobIds: z.array(z.string()),
  errors: z.array(z.string()),
  report: RunReportSchema.optional(),
  usage: RunUsageSchema,
  startedAt: z.string(),
  approvedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

/** One row of the recent-runs list. */
export const OperatorRunSummarySchema = OperatorRunSchema.pick({
  id: true,
  input: true,
  mode: true,
  status: true,
  startedAt: true,
  completedAt: true,
  workspaceId: true,
}).extend({
  title: z.string(),
  intent: z.string().optional(),
});

export const OperatorRunsResponseSchema = z.object({
  runs: z.array(OperatorRunSummarySchema),
});

export const RunbookSummarySchema = z.object({
  id: WorkflowIdSchema,
  name: z.string(),
  description: z.string(),
  /** A prompt that starts it, for the quick-start list. */
  example: z.string(),
  mode: OperatorModeSchema,
  steps: z.array(z.object({ title: z.string(), actor: z.string(), implemented: z.boolean() })),
});

export const RunbooksResponseSchema = z.object({ runbooks: z.array(RunbookSummarySchema) });

export const MAX_OPERATOR_INPUT = 4_000;

export const CreateOperatorRunSchema = z
  .object({
    input: z.string().trim().min(1, "Say what you want done.").max(MAX_OPERATOR_INPUT),
    mode: OperatorModeSchema,
  })
  .strict();

export const MemoryProposalDecisionSchema = z.object({ decision: z.enum(["accept", "dismiss"]) }).strict();

export const CreateProposedTasksSchema = z.object({ ids: z.array(z.string()).min(1).max(20) }).strict();

export type OperatorMode = z.infer<typeof OperatorModeSchema>;
export type RequestDomain = z.infer<typeof RequestDomainSchema>;
export type RunRisk = z.infer<typeof RunRiskSchema>;
export type WorkflowId = z.infer<typeof WorkflowIdSchema>;
export type RouterId = z.infer<typeof RouterIdSchema>;
export type DomainScore = z.infer<typeof DomainScoreSchema>;
export type RouteWorkspace = z.infer<typeof RouteWorkspaceSchema>;
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;
export type OperatorStepStatus = z.infer<typeof OperatorStepStatusSchema>;
export type StepOutput = z.infer<typeof StepOutputSchema>;
export type OperatorStep = z.infer<typeof OperatorStepSchema>;
export type OperatorRunStatus = z.infer<typeof OperatorRunStatusSchema>;
export type RunChange = z.infer<typeof RunChangeSchema>;
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
export type TaskProposal = z.infer<typeof TaskProposalSchema>;
export type RunReport = z.infer<typeof RunReportSchema>;
export type OperatorRun = z.infer<typeof OperatorRunSchema>;
export type OperatorRunSummary = z.infer<typeof OperatorRunSummarySchema>;
export type OperatorRunsResponse = z.infer<typeof OperatorRunsResponseSchema>;
export type RunbookSummary = z.infer<typeof RunbookSummarySchema>;
export type RunbooksResponse = z.infer<typeof RunbooksResponseSchema>;
export type CreateOperatorRun = z.infer<typeof CreateOperatorRunSchema>;

/** Terminal: nothing more will happen to the run on its own. */
export function isRunSettled(status: OperatorRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "blocked";
}

const RISK_ORDER: readonly RunRisk[] = ["read", "local-write", "external-write", "communication"];

export function maxRisk(risks: readonly RunRisk[]): RunRisk {
  return risks.reduce<RunRisk>((highest, risk) => (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(highest) ? risk : highest), "read");
}
