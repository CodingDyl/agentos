import { z } from "zod";

/**
 * Motion Design: a workspace that builds a cinematic site with the local
 * Claude Code worker running the `motion-site-studio` skill.
 *
 * AgentOS does not generate Higgsfield assets itself. It checks the machine,
 * writes the brief, starts a Claude Code job, and stops paid spend until a
 * person picks one concept and a credit ceiling.
 */

export const MOTION_DESIGN_SKILL_ID = "motion-site-studio";
export const MOTION_DESIGN_SKILL_RELATIVE = ".claude/skills/motion-site-studio/SKILL.md";
export const MOTION_CREDIT_LEDGER = "motion-credit-ledger.csv";
export const MOTION_CONCEPTS_FILE = "motion-studio/concepts.json";
export const MOTION_APPROVAL_FILE = "motion-studio/credits.approved.json";
export const HIGGSFIELD_TOOL = "Bash(higgsfield:*)";

export const REFERENCE_LIKES = ["color", "composition", "typography", "material", "lighting", "motion", "layout"] as const;
export const ReferenceLikeSchema = z.enum(REFERENCE_LIKES);
export type ReferenceLike = z.infer<typeof ReferenceLikeSchema>;

export const REFERENCE_LIKE_LABEL: Record<ReferenceLike, string> = {
  color: "Color",
  composition: "Composition",
  typography: "Typography",
  material: "Material",
  lighting: "Lighting",
  motion: "Motion",
  layout: "Layout",
};

export const MOTION_WIZARD_STEPS = ["setup", "references", "brief", "launch", "approval", "progress", "business"] as const;
export const MotionWizardStepSchema = z.enum(MOTION_WIZARD_STEPS);
export type MotionWizardStep = z.infer<typeof MotionWizardStepSchema>;

export const MOTION_WIZARD_STEP_LABEL: Record<MotionWizardStep, string> = {
  setup: "Setup",
  references: "References",
  brief: "Brief",
  launch: "Launch",
  approval: "Credit approval",
  progress: "Build",
  business: "Make it a business",
};

export const BUILD_STAGES = [
  "teardown",
  "interview",
  "images",
  "video",
  "build",
  "review_brief",
  "review_design",
  "review_craft",
  "copy",
] as const;
export const BuildStageSchema = z.enum(BUILD_STAGES);
export type BuildStage = z.infer<typeof BuildStageSchema>;

export const BUILD_STAGE_LABEL: Record<BuildStage, string> = {
  teardown: "Teardown",
  interview: "Interview",
  images: "Images",
  video: "Video",
  build: "Build",
  review_brief: "Review · Brief",
  review_design: "Review · Design rules",
  review_craft: "Review · Craft",
  copy: "Copy polish",
};

export const MOTION_WIZARD_EFFORTS = ["low", "medium", "high"] as const;
export const MOTION_DESIGN_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const MotionDesignEffortSchema = z.enum(MOTION_DESIGN_EFFORTS);
export type MotionDesignEffort = z.infer<typeof MotionDesignEffortSchema>;

export const DEFAULT_MOTION_MODEL = "claude-opus-5-5";
export const DEFAULT_MOTION_EFFORT: MotionDesignEffort = "high";

export const BUDGET_PLAN_IDS = ["taster", "standard", "full", "custom"] as const;
export const BudgetPlanIdSchema = z.enum(BUDGET_PLAN_IDS);
export type BudgetPlanId = z.infer<typeof BudgetPlanIdSchema>;

export const BUDGET_PLANS: readonly {
  id: BudgetPlanId;
  label: string;
  credits?: number;
  detail: string;
}[] = [
  { id: "taster", label: "Taster", credits: 100, detail: "4 images, 3-clip film at 720p, 1 loop" },
  { id: "standard", label: "Standard", credits: 330, detail: "6 images, 5-clip film at 1080p, 2 loops" },
  { id: "full", label: "Full", credits: 525, detail: "14 images, 7-clip film at 1080p, 4 loops" },
  { id: "custom", label: "Custom", detail: "Set a ceiling" },
];

export const CREDIT_COST_TABLE: readonly { output: string; model: string; credits: string }[] = [
  { output: "One 2K image", model: "Nano Banana Pro", credits: "2" },
  { output: "One 5-second 1080p clip", model: "Seedance 2.0", credits: "45" },
  { output: "One 5-second 720p clip", model: "Seedance 2.0", credits: "22.5" },
  { output: "One 5-second 480p draft", model: "Seedance 2.0", credits: "15" },
  { output: "Brand film with sound, 1080p", model: "Seedance 2.5", credits: "12 per second" },
];

export const REFERENCE_LIBRARY_LINKS = [
  { href: "https://styles.refero.design", label: "Refero" },
  { href: "https://mobbin.com", label: "Mobbin" },
  { href: "https://savee.it", label: "Savee" },
] as const;

const Text = (max: number) => z.string().trim().max(max);

export const MotionReferenceSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["link", "file"]),
  url: z.string().trim().url().max(500).optional(),
  filename: z.string().trim().max(200).optional(),
  path: z.string().trim().max(400).optional(),
  likes: z.array(ReferenceLikeSchema).max(7).default([]),
  note: Text(240).default(""),
});
export type MotionReference = z.infer<typeof MotionReferenceSchema>;

export const YouDecideFieldsSchema = z.object({
  brand: z.boolean().optional(),
  vibe: z.boolean().optional(),
  journey: z.boolean().optional(),
  sections: z.boolean().optional(),
  cta: z.boolean().optional(),
  budget: z.boolean().optional(),
  extras: z.boolean().optional(),
});
export type YouDecideFields = z.infer<typeof YouDecideFieldsSchema>;

export const MotionBriefSchema = z.object({
  brandName: Text(80).default(""),
  brandSells: Text(200).default(""),
  brandAudience: Text(200).default(""),
  vibe: Text(200).default(""),
  journeyStart: Text(400).default(""),
  journeyEnd: Text(400).default(""),
  journeyBeats: Text(800).default(""),
  sections: Text(800).default(""),
  cta: Text(120).default(""),
  extrasCharacter: z.boolean().default(false),
  extrasDeploy: Text(80).default(""),
  youDecide: YouDecideFieldsSchema.default({}),
});
export type MotionBrief = z.infer<typeof MotionBriefSchema>;

export const MotionConceptSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  summary: z.string().max(2000).default(""),
  hero: z.string().max(800).optional(),
  journey: z.string().max(800).optional(),
  sections: z.string().max(800).optional(),
  motion: z.string().max(800).optional(),
  plannedCredits: z.number().nonnegative(),
  itemized: z.array(z.object({ label: z.string().max(200), credits: z.number().nonnegative() })).default([]),
  recommended: z.boolean().optional(),
});
export type MotionConcept = z.infer<typeof MotionConceptSchema>;

export const CreditApprovalSchema = z.object({
  conceptId: z.string().min(1).max(40),
  ceiling: z.number().positive(),
  plannedCredits: z.number().nonnegative(),
  approvedAt: z.string(),
  note: z.string().max(400).optional(),
});
export type CreditApproval = z.infer<typeof CreditApprovalSchema>;

export const CreditLedgerRowSchema = z.object({
  timestamp: z.string(),
  jobId: z.string().optional(),
  purpose: z.string().optional(),
  model: z.string().optional(),
  settings: z.string().optional(),
  quotedCredits: z.number().nonnegative().optional(),
  actualCredits: z.number().nonnegative().optional(),
  status: z.string().optional(),
  output: z.string().optional(),
  cumulative: z.number().optional(),
  remaining: z.number().optional(),
});
export type CreditLedgerRow = z.infer<typeof CreditLedgerRowSchema>;

export const CreditLedgerSchema = z.object({
  rows: z.array(CreditLedgerRowSchema),
  spent: z.number().nonnegative(),
  pending: z.number().nonnegative(),
  committed: z.number().nonnegative(),
  raw: z.string().optional(),
});
export type CreditLedger = z.infer<typeof CreditLedgerSchema>;

export const SetupCheckIdSchema = z.enum(["claude", "skill", "higgsfield", "ffmpeg", "python", "node", "chrome"]);
export type SetupCheckId = z.infer<typeof SetupCheckIdSchema>;

export const SetupCheckSchema = z.object({
  id: SetupCheckIdSchema,
  label: z.string(),
  ok: z.boolean(),
  required: z.boolean(),
  detail: z.string().optional(),
  fix: z.string().optional(),
});
export type SetupCheck = z.infer<typeof SetupCheckSchema>;

export const MotionSetupSchema = z.object({
  ready: z.boolean(),
  codeOnly: z.boolean(),
  skill: z.object({
    present: z.boolean(),
    path: z.string(),
    matchesBundled: z.boolean().optional(),
    canInstall: z.boolean(),
  }),
  checks: z.array(SetupCheckSchema),
});
export type MotionSetup = z.infer<typeof MotionSetupSchema>;

export const SkillInstallResultSchema = z.object({
  installed: z.boolean(),
  path: z.string(),
  overwritten: z.boolean().default(false),
  needsConfirm: z.boolean().default(false),
  message: z.string(),
});
export type SkillInstallResult = z.infer<typeof SkillInstallResultSchema>;

export const MotionMediaSchema = z.object({
  name: z.string(),
  url: z.string(),
  kind: z.enum(["image", "video"]),
});
export type MotionMedia = z.infer<typeof MotionMediaSchema>;

export const ReviewLogEntrySchema = z.object({
  review: z.enum(["brief", "design", "craft"]),
  at: z.string().optional(),
  summary: z.string(),
});
export type ReviewLogEntry = z.infer<typeof ReviewLogEntrySchema>;

export const MotionProgressSchema = z.object({
  stages: z.array(
    z.object({
      id: BuildStageSchema,
      label: z.string(),
      status: z.enum(["not_started", "in_progress", "complete"]),
    }),
  ),
  keyframes: z.array(MotionMediaSchema),
  clips: z.array(MotionMediaSchema),
  previewUrl: z.string().optional(),
  reviewLog: z.array(ReviewLogEntrySchema),
  ledger: CreditLedgerSchema.optional(),
  concepts: z.array(MotionConceptSchema).default([]),
  error: z.string().optional(),
});
export type MotionProgress = z.infer<typeof MotionProgressSchema>;

export const MotionRunStatusSchema = z.enum([
  "draft",
  "setup",
  "queued",
  "running",
  "awaiting_approval",
  "building",
  "completed",
  "failed",
  "cancelled",
]);
export type MotionRunStatus = z.infer<typeof MotionRunStatusSchema>;

export const MotionNotesSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

export const MotionApprovalInputSchema = z.object({
  conceptId: z.string().min(1).max(40),
  ceiling: z.number().positive().max(100_000),
  note: z.string().trim().max(400).optional(),
});
export type MotionApprovalInput = z.infer<typeof MotionApprovalInputSchema>;

export const MotionLaunchInputSchema = z.object({
  brief: MotionBriefSchema,
  references: z.array(MotionReferenceSchema).max(10),
  budgetPlan: BudgetPlanIdSchema.default("standard"),
  budgetCeiling: z.number().positive().max(100_000).optional(),
  codeOnly: z.boolean().default(false),
  model: z.string().trim().max(80).default(DEFAULT_MOTION_MODEL),
  effort: MotionDesignEffortSchema.default(DEFAULT_MOTION_EFFORT),
  workspaceName: z.string().trim().min(1).max(80).optional(),
  workspaceSlug: z.string().trim().max(64).optional(),
});
export type MotionLaunchInput = z.input<typeof MotionLaunchInputSchema>;

export const MotionDraftSchema = z.object({
  step: MotionWizardStepSchema.default("setup"),
  brief: MotionBriefSchema.default(() => MotionBriefSchema.parse({})),
  references: z.array(MotionReferenceSchema).max(10).default([]),
  budgetPlan: BudgetPlanIdSchema.default("standard"),
  budgetCeiling: z.number().positive().max(100_000).optional(),
  codeOnly: z.boolean().default(false),
  model: z.string().trim().max(80).default(DEFAULT_MOTION_MODEL),
  effort: MotionDesignEffortSchema.default(DEFAULT_MOTION_EFFORT),
  workspaceName: z.string().trim().max(80).default(""),
  updatedAt: z.string().optional(),
});
export type MotionDraft = z.infer<typeof MotionDraftSchema>;

export const MotionRunSchema = z.object({
  id: z.string(),
  workspaceSlug: z.string(),
  status: MotionRunStatusSchema,
  step: MotionWizardStepSchema,
  brief: MotionBriefSchema,
  references: z.array(MotionReferenceSchema),
  budgetPlan: BudgetPlanIdSchema,
  budgetCeiling: z.number().positive().optional(),
  codeOnly: z.boolean(),
  model: z.string(),
  effort: MotionDesignEffortSchema,
  siteRepoPath: z.string().optional(),
  proposalJobId: z.string().optional(),
  buildJobId: z.string().optional(),
  concepts: z.array(MotionConceptSchema).default([]),
  approval: CreditApprovalSchema.optional(),
  notes: z.array(z.object({ at: z.string(), text: z.string() })).default([]),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MotionRun = z.infer<typeof MotionRunSchema>;

export const MotionRunViewSchema = MotionRunSchema.extend({
  setup: MotionSetupSchema.optional(),
  progress: MotionProgressSchema.optional(),
  job: z
    .object({
      id: z.string(),
      status: z.string(),
      error: z.string().optional(),
      summary: z.string().optional(),
      href: z.string(),
    })
    .optional(),
});
export type MotionRunView = z.infer<typeof MotionRunViewSchema>;

/** Planned spend, a 15% repair reserve, and the authorized maximum — shown separately. */
export function budgetBreakdown(ceiling: number, planned: number): { planned: number; reserve: number; ceiling: number } {
  const reserve = Math.round(ceiling * 0.15 * 10) / 10;
  return { planned, reserve, ceiling };
}

export function youDecideAuthorizesSpend(youDecide: boolean): false {
  if (youDecide) return false;
  return false;
}

export function creditToolsAllowed(approval: CreditApproval | undefined): string[] {
  return approval ? [HIGGSFIELD_TOOL] : [];
}

export function authorizeHiggsfieldSpend(input: {
  approval: CreditApproval | undefined;
  conceptId: string;
  requestedCredits: number;
  spent: number;
  pending: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.approval) {
    return { ok: false, reason: "No concept and credit ceiling have been approved." };
  }
  if (input.approval.conceptId !== input.conceptId) {
    return { ok: false, reason: "That concept was not approved." };
  }
  const committed = input.spent + input.pending + input.requestedCredits;
  if (committed > input.approval.ceiling) {
    return {
      ok: false,
      reason: `That spend would exceed the approved ceiling of ${input.approval.ceiling} credits. A new approval is required.`,
    };
  }
  return { ok: true };
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads `motion-credit-ledger.csv`. Unknown / pending charges count toward the remaining budget. */
export function parseCreditLedger(csv: string): CreditLedger {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], spent: 0, pending: 0, committed: 0, raw: csv };

  const start = /timestamp/i.test(lines[0] ?? "") ? 1 : 0;
  const rows: CreditLedgerRow[] = [];

  for (const line of lines.slice(start)) {
    const cells = splitCsvLine(line);
    const status = cells[7]?.trim() || undefined;
    const quoted = numberOrUndefined(cells[5]);
    const actual = numberOrUndefined(cells[6]);
    rows.push({
      timestamp: cells[0] ?? "",
      jobId: cells[1] || undefined,
      purpose: cells[2] || undefined,
      model: cells[3] || undefined,
      settings: cells[4] || undefined,
      quotedCredits: quoted,
      actualCredits: actual,
      status,
      output: cells[8] || undefined,
      cumulative: numberOrUndefined(cells[9]),
      remaining: numberOrUndefined(cells[10]),
    });
  }

  let spent = 0;
  let pending = 0;
  for (const row of rows) {
    const pendingStatus = /pend/i.test(row.status ?? "");
    if (pendingStatus) pending += row.quotedCredits ?? row.actualCredits ?? 0;
    else spent += row.actualCredits ?? row.quotedCredits ?? 0;
  }

  return { rows, spent, pending, committed: spent + pending, raw: csv };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

export function suggestedReferences(): MotionReference[] {
  return [
    {
      id: "suggest_refero",
      kind: "link",
      url: "https://styles.refero.design",
      likes: ["layout", "typography"],
      note: "Editorial layout and type — a starting point for hierarchy.",
    },
    {
      id: "suggest_mobbin",
      kind: "link",
      url: "https://mobbin.com",
      likes: ["composition", "motion"],
      note: "Product motion and screen composition.",
    },
    {
      id: "suggest_savee",
      kind: "link",
      url: "https://savee.it",
      likes: ["color", "material", "lighting"],
      note: "Material, light and colour references.",
    },
  ];
}

function decided(brief: MotionBrief, field: keyof YouDecideFields): boolean {
  return Boolean(brief.youDecide[field]);
}

function line(label: string, value: string, youDecide: boolean, fallback = "not given"): string {
  if (youDecide) return `${label}: [you decide]`;
  const trimmed = value.trim();
  return `${label}: ${trimmed || fallback}`;
}

const SKILL_INVOCATION = `/motion-site-studio

Build a 3D motion website from my attached references.
The site is a Next.js App Router TypeScript project (already scaffolded).
Use GSAP + ScrollTrigger (register client-side in useGSAP/useEffect),
@react-three/fiber for 3D, and Framer Motion for UI motion.
Do not replace the app with a standalone index.html.
Analyze what makes the references work, then interview me in one batch.
Show two concepts and a verified itemized budget before spending.
Generate the images and video with Higgsfield if available, build the site,
and iterate against the reference rules and my feedback.`;

export function assembleMotionPrompt(input: {
  brief: MotionBrief;
  references: MotionReference[];
  budgetCeiling?: number;
  codeOnly: boolean;
  interviewAnswered: boolean;
}): string {
  const { brief, references, budgetCeiling, codeOnly, interviewAnswered } = input;
  const brandBits = [brief.brandName, brief.brandSells, brief.brandAudience].map((part) => part.trim()).filter(Boolean);
  const brand = decided(brief, "brand")
    ? "[you decide]"
    : brandBits.length > 0
      ? brandBits.join(" — ")
      : "[name and one-line description, or ask me]";
  const budget =
    budgetCeiling && budgetCeiling > 0
      ? `${budgetCeiling} Higgsfield credits maximum`
      : decided(brief, "budget")
        ? "[propose a plan; do not spend until a ceiling is approved in AgentOS]"
        : "[maximum Higgsfield credits, or ask me]";

  const referenceLines =
    references.length === 0
      ? ["No references were attached. Suggest three visual directions I can pick from."]
      : references.map((reference, index) => {
          const where = reference.kind === "file" ? reference.path ?? reference.filename ?? "attached file" : reference.url ?? "link";
          const likes = reference.likes.length > 0 ? ` Likes: ${reference.likes.join(", ")}.` : "";
          const note = reference.note.trim() ? ` Why: ${reference.note.trim()}` : "";
          return `${index + 1}. ${where}.${likes}${note}`;
        });

  const extras = decided(brief, "extras")
    ? "Extras: [you decide]"
    : `Character: ${brief.extrasCharacter ? "yes, a small character" : "no character"}. Deploy target: ${brief.extrasDeploy.trim() || "not given"}.`;

  const parts = [
    SKILL_INVOCATION,
    "",
    `Brand: ${brand}`,
    `Budget: ${budget}`,
    "",
    interviewAnswered
      ? "The interview is already answered below. Only ask about gaps. Do not re-ask questions that have answers."
      : "Interview me in one batch.",
    "You decide (creative only — not a spending authorisation). You decide is not spending authority. Creative 'you decide' answers never authorize Higgsfield spend.",
    "Present two concrete concepts with an itemized cost. Write them to motion-studio/concepts.json and stop. Do not submit paid jobs until motion-studio/credits.approved.json exists.",
    "Maintain motion-credit-ledger.csv in the project, including pending charges.",
    "Keep a concise review log covering Brief, Design rules, and Craft.",
    codeOnly
      ? "Higgsfield is not available. Use code-only motion. Do not submit paid Higgsfield jobs, and do not describe estimates as exact live prices."
      : "Make the images and video with Higgsfield after the concept and ceiling are approved.",
    "",
    "## Interview answers",
    line("Brand name", brief.brandName, decided(brief, "brand")),
    line("What it sells", brief.brandSells, decided(brief, "brand")),
    line("Who it is for", brief.brandAudience, decided(brief, "brand")),
    line("Vibe", brief.vibe, decided(brief, "vibe")),
    "Journey (most important) — start frame, end frame, intermediate states:",
    line("Start frame", brief.journeyStart, decided(brief, "journey")),
    line("End frame", brief.journeyEnd, decided(brief, "journey")),
    line("Intermediate states", brief.journeyBeats, decided(brief, "journey")),
    line("Sections below the film, and what each must prove", brief.sections, decided(brief, "sections")),
    line("Primary CTA", brief.cta, decided(brief, "cta")),
    extras,
    decided(brief, "budget") ? "Budget: [you decide] (creative only — not a spending authorisation)" : undefined,
    "",
    "## References",
    ...referenceLines,
  ];

  return parts.filter((part) => part !== undefined).join("\n");
}

export const MOTION_SITE_ALLOWED_TOOLS = [
  "Write",
  "Edit",
  "WebFetch",
  "Bash(ffmpeg:*)",
  "Bash(ffprobe:*)",
  "Bash(python3:*)",
  "Bash(python:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "Bash(cat:*)",
  "Bash(head:*)",
  "Bash(file:*)",
] as const;
