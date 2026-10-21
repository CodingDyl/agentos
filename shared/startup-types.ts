import { z } from "zod";

/**
 * Startups: an idea walked from first thought to live users, one gated stage
 * at a time, with everything filed under `saas/` in the vault so later
 * ventures can learn from earlier ones. See docs/startups/README.md.
 *
 * Phase 1 builds the first four stages. The rest are listed so the venture
 * page can show the whole road, and so later phases slot in without reshaping
 * what is stored.
 */

export const STARTUP_STAGES = [
  { id: "idea", label: "Idea", phase: 1, gate: "A problem, who has it, and how the product would help, written down." },
  { id: "value", label: "Value", phase: 1, gate: "Who pays, why, and what they do today instead." },
  { id: "validate", label: "Validate", phase: 1, gate: "Persona reviews and a validity score of 8 or more out of 10." },
  { id: "mvp", label: "MVP", phase: 1, gate: "One user, one problem, one core workflow, a success metric and kill criteria." },
  { id: "design", label: "Design", phase: 2, gate: "A design brief and DESIGN.md." },
  { id: "tech", label: "Tech", phase: 2, gate: "Stack, structure and the POPIA checklist." },
  { id: "build", label: "Build", phase: 3, gate: "The MVP works end to end." },
  { id: "test", label: "Test", phase: 3, gate: "External users have used it, with feedback and metrics recorded." },
  { id: "refine", label: "Refine", phase: 3, gate: "Feedback and bugs worked through." },
  { id: "launch", label: "Launch", phase: 3, gate: "Marketing and live users." },
] as const;

export type StartupStageId = (typeof STARTUP_STAGES)[number]["id"];
export const StartupStageIdSchema = z.enum(STARTUP_STAGES.map((stage) => stage.id) as [StartupStageId, ...StartupStageId[]]);

/** The stages this version can edit. */
export const EDITABLE_STAGES = ["idea", "value", "validate", "mvp"] as const;
export type EditableStage = (typeof EDITABLE_STAGES)[number];
export const EditableStageSchema = z.enum(EDITABLE_STAGES);

export const VentureStatusSchema = z.enum(["exploring", "validating", "building", "testing", "live", "paused", "stopped"]);
export type VentureStatus = z.infer<typeof VentureStatusSchema>;

const text = (max: number) => z.string().trim().max(max).catch("").default("");
const list = (max: number, items = 20) =>
  z
    .array(z.string())
    .catch([])
    .default([])
    .transform((values) => values.map((value) => value.trim().slice(0, max)).filter(Boolean).slice(0, items));

// ---------------------------------------------------------------------------
// Stage content
// ---------------------------------------------------------------------------

export const IdeaSchema = z.object({
  title: text(120),
  oneLiner: text(240),
  problem: text(1500),
  who: text(600),
  howItWorks: text(1500),
  whyNow: text(800),
  assumptions: list(300),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const ValueSchema = z.object({
  customer: text(600),
  jobToBeDone: text(800),
  painToday: text(1200),
  alternatives: list(300),
  valueProposition: text(800),
  whoPays: text(400),
  pricingIdea: text(400),
  advantage: text(800),
});
export type Value = z.infer<typeof ValueSchema>;

export const CompetitorSchema = z.object({
  name: text(120),
  url: text(300),
  notes: text(600),
  gap: text(600),
});

export const WouldPaySchema = z.enum(["yes", "maybe", "no"]).catch("maybe");

export const ConversationSchema = z.object({
  who: text(120),
  role: text(120),
  date: text(20),
  quotes: list(400, 10),
  pain: z.number().int().min(1).max(5).catch(3),
  wouldPay: WouldPaySchema,
  notes: text(1200),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ValidationSchema = z.object({
  competitors: z.array(CompetitorSchema).catch([]).default([]),
  competitorSummary: text(1500),
  /** Persona slugs chosen for this venture. */
  personas: list(80, 8),
  /** Real conversations. Optional: persona reviews alone may carry the score. */
  conversations: z.array(ConversationSchema).catch([]).default([]),
});
export type Validation = z.infer<typeof ValidationSchema>;

export const MvpSchema = z.object({
  targetUser: text(400),
  problem: text(800),
  coreWorkflow: list(300, 12),
  inScope: list(200, 15),
  outOfScope: list(200, 30),
  successMetric: text(400),
  killCriteria: list(300, 8),
  timeboxWeeks: z.number().int().min(1).max(52).catch(6).default(6),
});
export type Mvp = z.infer<typeof MvpSchema>;

export const STAGE_SCHEMAS = {
  idea: IdeaSchema,
  value: ValueSchema,
  validate: ValidationSchema,
  mvp: MvpSchema,
} as const;

export type StageContent = { idea: Idea; value: Value; validate: Validation; mvp: Mvp };

/** What each stage needs before it can be saved: the fields that must not be empty. */
export function stageProblems(stage: EditableStage, content: StageContent[EditableStage]): string[] {
  const missing = (entries: [string, unknown][]) =>
    entries.filter(([, value]) => (Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim())).map(([label]) => label);

  switch (stage) {
    case "idea": {
      const idea = content as Idea;
      return missing([["title", idea.title], ["problem", idea.problem], ["who has it", idea.who]]);
    }
    case "value": {
      const value = content as Value;
      return missing([["customer", value.customer], ["value proposition", value.valueProposition], ["who pays", value.whoPays]]);
    }
    case "validate":
      return [];
    case "mvp": {
      const mvp = content as Mvp;
      return missing([
        ["target user", mvp.targetUser],
        ["problem", mvp.problem],
        ["core workflow", mvp.coreWorkflow],
        ["success metric", mvp.successMetric],
        ["kill criteria", mvp.killCriteria],
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Ventures
// ---------------------------------------------------------------------------

export const VentureSchema = z.object({
  slug: z.string(),
  name: z.string(),
  pitch: z.string().default(""),
  stage: StartupStageIdSchema,
  status: VentureStatusSchema,
  /** Pivots taken after a failed score. One is allowed. */
  pivotsUsed: z.number().int().min(0).default(0),
  outcome: z.enum(["continued", "pivoted", "stopped"]).optional(),
  outcomeReason: z.string().optional(),
  /** The workspace it graduated into. */
  workspace: z.string().optional(),
  origin: z.enum(["idea", "brainstorm"]).default("idea"),
  created: z.string(),
  updated: z.string(),
});
export type Venture = z.infer<typeof VentureSchema>;

export const LaterItemSchema = z.object({
  title: z.string(),
  reason: z.string().default(""),
  at: z.string(),
});
export type LaterItem = z.infer<typeof LaterItemSchema>;

export const DecisionSchema = z.object({
  at: z.string(),
  title: z.string(),
  detail: z.string().default(""),
});
export type VentureDecision = z.infer<typeof DecisionSchema>;

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export const PersonaSchema = z.object({
  slug: z.string(),
  name: text(120),
  role: text(120),
  industry: text(120),
  seniority: text(80),
  summary: text(600),
  dayToDay: list(300, 15),
  tools: list(200, 15),
  pains: list(300, 12),
  buying: text(800),
  sceptical: list(300, 10),
  behaviour: list(300, 12),
  usedBy: list(80, 50),
  created: z.string(),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** What a persona says about a venture, after walking through their workday with it. */
export const PersonaReviewSchema = z.object({
  persona: z.string(),
  personaName: z.string().default(""),
  reviewedAt: z.string(),
  attempt: z.number().int().min(1).default(1),
  workday: z
    .array(z.object({ task: text(300), wouldUse: z.boolean().catch(false), why: text(500) }))
    .catch([])
    .default([]),
  replaces: text(600),
  objections: list(400, 10),
  dealBreakers: list(400, 8),
  missing: list(300, 10),
  wouldPay: WouldPaySchema,
  price: text(120),
  wouldRecommend: z.boolean().catch(false),
  fitScore: z.number().min(1).max(10).catch(1),
  reasons: list(400, 8),
  verdict: text(800),
  /** Always true: this is a model playing a role, not a person. */
  simulated: z.literal(true).default(true),
});
export type PersonaReview = z.infer<typeof PersonaReviewSchema>;

export const PersonaSuggestionSchema = z.object({
  role: text(120),
  industry: text(120),
  why: text(400),
  /** An existing library persona that fits, when there is one. */
  existing: z.string().optional(),
});
export type PersonaSuggestion = z.infer<typeof PersonaSuggestionSchema>;

// ---------------------------------------------------------------------------
// The validity score
// ---------------------------------------------------------------------------

/** The bar an idea must clear to continue past Validate. */
export const VALIDITY_THRESHOLD = 8;

/** Pivots allowed after a failed score before the venture stops. */
export const MAX_PIVOTS = 1;

/**
 * The dimensions of the validity score, with their weights. Weights sum to 1.
 * `personaFit` is computed from the persona reviews, never asked of a model.
 * `realEvidence` counts only when real conversations were logged; without any
 * its weight is shared out over the rest, so personas alone can reach the bar.
 */
export const SCORE_DIMENSIONS = [
  { key: "problemSeverity", label: "Problem severity", weight: 0.15 },
  { key: "frequency", label: "How often it hurts", weight: 0.1 },
  { key: "willingnessToPay", label: "Willingness to pay", weight: 0.15 },
  { key: "competitiveGap", label: "Gap in the market", weight: 0.1 },
  { key: "personaFit", label: "Persona fit", weight: 0.15 },
  { key: "reach", label: "Can reach buyers", weight: 0.1 },
  { key: "feasibility", label: "MVP feasible for one builder", weight: 0.1 },
  { key: "founderFit", label: "Founder fit", weight: 0.05 },
  { key: "realEvidence", label: "Real-world evidence", weight: 0.1 },
] as const;

export type ScoreDimensionKey = (typeof SCORE_DIMENSIONS)[number]["key"];

export const ScoredDimensionSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().min(0).max(10),
  /** The weight it counted for in this attempt, after any redistribution. */
  weight: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
});
export type ScoredDimension = z.infer<typeof ScoredDimensionSchema>;

export const ScoreAttemptSchema = z.object({
  at: z.string(),
  attempt: z.number().int().min(1),
  dimensions: z.array(ScoredDimensionSchema),
  total: z.number(),
  passed: z.boolean(),
  summary: z.string().default(""),
  /** The lowest dimensions, which a pivot aims at. */
  weakest: z.array(z.string()).default([]),
  personaReviews: z.number().int().min(0),
  conversations: z.number().int().min(0),
});
export type ScoreAttempt = z.infer<typeof ScoreAttemptSchema>;

/** One decimal, so 7.95 counts as 8.0 and 7.94 does not. */
export function roundScore(value: number): number {
  return Math.round(value * 10 + 1e-9) / 10;
}

/**
 * The weighted total of a set of dimension scores.
 *
 * Kept in shared code so the page and the server can never disagree about how
 * a number was reached.
 */
export function weighDimensions(
  scores: Partial<Record<ScoreDimensionKey, number>>,
  options: { hasRealEvidence: boolean },
): { dimensions: { key: ScoreDimensionKey; label: string; score: number; weight: number }[]; total: number } {
  const counted = SCORE_DIMENSIONS.filter((dimension) => options.hasRealEvidence || dimension.key !== "realEvidence");
  const totalWeight = counted.reduce((sum, dimension) => sum + dimension.weight, 0);

  const dimensions = counted.map((dimension) => {
    const raw = scores[dimension.key];
    const score = typeof raw === "number" && Number.isFinite(raw) ? Math.min(10, Math.max(0, raw)) : 0;
    return { key: dimension.key, label: dimension.label, score, weight: dimension.weight / totalWeight };
  });

  const total = roundScore(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0));

  return { dimensions, total };
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export const ScopeVerdictSchema = z.enum(["in", "later", "pivot"]);
export type ScopeVerdict = z.infer<typeof ScopeVerdictSchema>;

export const ScopeCheckSchema = z.object({
  request: z.string(),
  verdict: ScopeVerdictSchema,
  reason: z.string(),
  /** The MVP contract clause it was judged against. */
  clause: z.string().default(""),
});
export type ScopeCheck = z.infer<typeof ScopeCheckSchema>;

// ---------------------------------------------------------------------------
// Interviews and reads
// ---------------------------------------------------------------------------

export const StageQuestionsSchema = z.object({
  understood: z.array(z.string()).default([]),
  questions: z.array(z.string()).min(1),
});
export type StageQuestions = z.infer<typeof StageQuestionsSchema>;

export const StageAnswersSchema = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).max(20),
  /** Free text: the idea as Dylan first described it, or notes to steer the draft. */
  notes: z.string().max(6000).optional(),
});
export type StageAnswers = z.infer<typeof StageAnswersSchema>;

export const BrainstormIdeaSchema = z.object({
  title: text(120),
  oneLiner: text(240),
  who: text(300),
  why: text(600),
});
export type BrainstormIdea = z.infer<typeof BrainstormIdeaSchema>;

export const StageDocSchema = z.object({
  stage: EditableStageSchema,
  saved: z.boolean(),
  revision: z.string(),
  updated: z.string().optional(),
});

export const VentureDetailSchema = z.object({
  venture: VentureSchema,
  revision: z.string(),
  stages: z.object({
    idea: IdeaSchema.nullable(),
    value: ValueSchema.nullable(),
    validate: ValidationSchema.nullable(),
    mvp: MvpSchema.nullable(),
  }),
  revisions: z.record(z.string(), z.string()),
  reviews: z.array(PersonaReviewSchema),
  scores: z.array(ScoreAttemptSchema),
  later: z.array(LaterItemSchema),
  decisions: z.array(DecisionSchema),
  /** Why the next stage is locked, per stage, or absent when it is open. */
  locks: z.record(z.string(), z.string()),
});
export type VentureDetail = z.infer<typeof VentureDetailSchema>;

export const VenturesResponseSchema = z.object({ ventures: z.array(VentureSchema) });
export const PersonasResponseSchema = z.object({ personas: z.array(PersonaSchema) });
