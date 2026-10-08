import { TaskScheduleSchema } from "./calendar-types";
import { z } from "zod";
import { WorkerIdSchema } from "./worker-ids";
import { WorkspaceModuleSchema, WorkspaceTypeSchema } from "./workspace";

/**
 * The wire contract between the AgentOS data adapter and the React app.
 *
 * No markdown crosses this boundary. The adapter reads `~/AgentOS`, and React
 * receives clean application data. Schemas are the single source of truth; the
 * exported types are derived from them, so the two can never drift.
 */

export const ProjectStateSchema = z.enum([
  "active",
  "blocked",
  "incubating",
  "paused",
  "completed",
  /**
   * Put away, but not finished and not deleted.
   *
   * Distinct from `completed` because they are different claims: one says the
   * work is done, the other says it is out of sight. Folding archived projects
   * into completed — which the reader used to do — would make "I shipped this"
   * and "I gave up on this for now" the same row in the portfolio.
   *
   * A project is never deleted. Worker jobs, usage, designs, decisions and
   * activity all reference its slug, and removing the directory would leave
   * every one of those pointing at nothing.
   */
  "archived",
]);

export const ProjectPrioritySchema = z.enum(["high", "medium", "low"]);

/**
 * Product work competes for portfolio attention; infrastructure supports it and
 * is surfaced only when deliberately promoted.
 */
export const ProjectKindSchema = z.enum(["product", "infrastructure"]);

export const ProjectSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  state: ProjectStateSchema,
  priority: ProjectPrioritySchema,
  kind: ProjectKindSchema.optional(),
  promoted: z.boolean().optional(),
  /** Portfolio label, e.g. `Product`, `Agency / Client Work`. */
  type: z.string().optional(),
  /** One line of current status. Never a paragraph. */
  status: z.string().optional(),
  nextAction: z.string().optional(),
  /** ISO 8601 timestamp of the most recent change to the project's files. */
  lastActivity: z.string().optional(),
  /** The active milestone, when there is one. What the portfolio row shows. */
  milestone: z.lazy(() => MilestoneSummarySchema).optional(),
  health: z.lazy(() => ProjectHealthSchema).optional(),
  /**
   * What the interface presents this project as. Resolved from `Workspace
   * type:` in `PROJECT.md`, else an exact match of the portfolio type, else
   * `general` — see `shared/workspace.ts`.
   */
  workspaceType: WorkspaceTypeSchema.optional(),
  /** Open tasks filed under Now: what "planned today" counts. */
  nowCount: z.number().int().nonnegative().optional(),
});

export const ProjectsResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
});

export const ProjectTaskSectionSchema = z.enum(["now", "next", "later"]);

/**
 * One task from `TASKS.md`.
 *
 * `id` is optional because the vault is hand-maintained and most tasks predate
 * having ids at all. Those tasks are shown exactly as written and simply
 * cannot be delegated: minting an id here would put an identifier in the
 * console that does not exist in the file, and the first thing anyone would do
 * with it is delegate work against something the vault cannot name back.
 */
/**
 * Where a task is in its life, as distinct from where it is filed.
 *
 * `Now / Next / Later` say when the operator means to do something; this says
 * what state the work is actually in. Almost all of it is derived — `done`
 * from the checkbox, `blocked` from open dependencies, `in_progress` and
 * `review` from the worker job holding the task — so only `ready` is ever
 * written, as a marker on the task line.
 */
export const TaskExecutionStatusSchema = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "review",
  "blocked",
  "done",
]);

export const ProjectTaskSchema = z.object({
  schedule: TaskScheduleSchema.optional(),
  calendarEventId: z.string().optional(),
  id: z.string().optional(),
  title: z.string(),
  section: ProjectTaskSectionSchema,
  completed: z.boolean(),
  /** The operator has said this is ready to be picked up. */
  ready: z.boolean().optional(),
  /** Task ids this one waits on. Written as `· after PP-021` on the line. */
  after: z.array(z.string()).optional(),
  /**
   * The worker job this task was handed to, when it has been.
   *
   * Held in AgentOS's own state rather than written into `TASKS.md` — that
   * file is the project's, and an execution id is not project state.
   */
  delegatedJobId: z.string().optional(),
});

export const ProjectTaskGroupSchema = z.object({
  now: z.array(ProjectTaskSchema),
  next: z.array(ProjectTaskSchema),
  later: z.array(ProjectTaskSchema),
});

export const ProjectDecisionSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
});

export const WorkSessionSummarySchema = z.object({
  /** Display date, taken from the log's filename or its heading. */
  date: z.string(),
  completed: z.array(z.string()).optional(),
  stillOpen: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  resumeHere: z.string().optional(),
});

/** One entry from `git status --short`, with the porcelain code already read. */
export const GitFileChangeSchema = z.object({
  /** Human label, e.g. `Modified`. React never sees a porcelain code. */
  status: z.string(),
  path: z.string(),
});

export const ProjectGitSchema = z.object({
  /** Absent when `PROJECT.md` links no local repository. */
  repositoryPath: z.string().optional(),
  branch: z.string().optional(),
  workingTree: z.enum(["clean", "modified"]).optional(),
  changedFiles: z.array(GitFileChangeSchema),
  /** Why git data is missing, when it could not be read. */
  unavailable: z.string().optional(),
});

/** Which worker a project's delegations default to. `auto` lets routing decide. */
export const WorkerPreferenceSchema = z.enum(["auto", ...WorkerIdSchema.options]);

/**
 * When a project's delegated work is verified visually by default.
 *
 * `ui-tasks` is the sensible middle: tasks Hermes scopes as UI work start with
 * visual acceptance on, everything else starts with it off. The operator can
 * still flip it per plan.
 */
export const VisualVerificationDefaultSchema = z.enum(["off", "ui-tasks", "always"]);

/**
 * A project's operating configuration, read from `## Configuration` in
 * `PROJECT.md`.
 *
 * Everything here is a *default* that flows into task ids, delegation and
 * verification, so the operator sets it once rather than on every job. It
 * lives in the vault rather than in AgentOS state so Hermes sees the same
 * defaults the console does.
 */
export const ProjectConfigurationSchema = z.object({
  /** Overrides the prefix derived from the slug. Existing ids keep theirs. */
  taskPrefix: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/).optional(),
  defaultBranch: z.string().optional(),
  workerPreference: WorkerPreferenceSchema,
  visualVerification: VisualVerificationDefaultSchema,
  /** Name or id of the design board this project's UI work is checked against. */
  designBoard: z.string().optional(),
  /** The Vercel project this AgentOS project is linked to, if any. */
  vercelProjectId: z.string().optional(),
  /** Cached display name, so Settings can show the link without a Vercel call. */
  vercelProjectName: z.string().optional(),
  validationCommands: z.array(z.string()),
  /** Set explicitly by the operator. Absent means "derive it". */
  workspaceType: WorkspaceTypeSchema.optional(),
  /** The workspace's tabs, in order. Absent or empty means the type's defaults. */
  modules: z.array(WorkspaceModuleSchema).optional(),
  /** Local filesystem path to the project for the Coder IDE. */
  localPath: z.string().optional(),
});

export const DEFAULT_PROJECT_CONFIGURATION: ProjectConfiguration = {
  workerPreference: "auto",
  visualVerification: "ui-tasks",
  validationCommands: [],
};

/**
 * A settings edit. Omitted fields are left as they are; an empty string clears
 * an optional one, which is why the prefix accepts `""` here and not above.
 */
export const ProjectConfigurationPatchSchema = ProjectConfigurationSchema.partial().extend({
  taskPrefix: z.union([z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/), z.literal("")]).optional(),
  /** `""` returns the workspace to its derived type. */
  workspaceType: z.union([WorkspaceTypeSchema, z.literal("")]).optional(),
});

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  tasks: ProjectTaskGroupSchema,
  decisions: z.array(ProjectDecisionSchema),
  sessions: z.array(WorkSessionSummarySchema),
  git: ProjectGitSchema,
  /** The `## Purpose` body of `PROJECT.md`, as written. */
  purpose: z.string().optional(),
  configuration: ProjectConfigurationSchema,
  /** How many tasks sit in `## Archived`. Not shown on the board by default. */
  archivedTaskCount: z.number().int().nonnegative(),
});

/**
 * What the settings sheet sends.
 *
 * Two files are involved — identity in `PORTFOLIO.md`, substance in
 * `PROJECT.md` — so two revisions travel with it, and each file is only
 * edited when a field that lives in it changed.
 */
export const ProjectPatchRequestSchema = z.object({
  name: z.string().min(1).optional(),
  goal: z.string().optional(),
  type: z.string().optional(),
  state: ProjectStateSchema.optional(),
  priority: ProjectPrioritySchema.optional(),
  repoPath: z.string().optional(),
  configuration: ProjectConfigurationPatchSchema.optional(),
  /** Legacy single revision: the portfolio's. */
  expectedRevision: z.string().optional(),
  expectedRevisions: z
    .object({ portfolio: z.string().optional(), project: z.string().optional() })
    .optional(),
});

export const ProjectPatchResponseSchema = z.object({
  portfolio: z.object({ revision: z.string(), undoId: z.string().optional() }).optional(),
  project: z.object({ revision: z.string(), undoId: z.string().optional() }).optional(),
});

/** Where a task can be filed, including the two out-of-circulation sections. */
export const TaskSectionNameSchema = z.enum(["now", "next", "later", "done", "archived"]);

/** Creating a project — by hand, or from a plan Hermes proposed. */
export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  goal: z.string().optional(),
  type: z.string().optional(),
  state: ProjectStateSchema.optional(),
  priority: ProjectPrioritySchema.optional(),
  repoPath: z.string().optional(),
  configuration: ProjectConfigurationPatchSchema.optional(),
  tasks: z
    .array(z.object({ title: z.string().min(1), section: TaskSectionNameSchema.optional() }))
    .max(50)
    .optional(),
  decisions: z
    .array(z.object({ title: z.string().min(1), body: z.string() }))
    .max(20)
    .optional(),
});

/**
 * What Hermes proposes when asked to plan a project from a brief.
 *
 * A proposal, not a project: nothing in the vault changes until the operator
 * reviews every field and clicks create. `plannedBy` says whether the plan
 * came from Hermes or is AgentOS's thin fallback from the brief alone.
 */
export const ProjectPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  goal: z.string(),
  scope: z.array(z.string()),
  milestones: z.array(z.string()),
  initialTasks: z.array(
    z.object({ title: z.string().min(1), section: ProjectTaskSectionSchema }),
  ),
  risks: z.array(z.string()),
  plannedBy: z.enum(["hermes", "agentos"]),
});

export const ProjectPlanRequestSchema = z.object({
  brief: z.string().min(1).max(4000),
});

export const MilestoneStatusSchema = z.enum(["planned", "active", "completed", "paused", "archived"]);

export const MilestoneCriterionSchema = z.object({
  text: z.string(),
  done: z.boolean(),
});

/**
 * One milestone from `MILESTONES.md`.
 *
 * The unit of planning above a task: an outcome, the criteria that would show
 * it was reached, a target, and the tasks meant to get there. Progress is
 * counted from the tasks; success is judged against the criteria, by a person.
 */
export const ProjectMilestoneSchema = z.object({
  id: z.string(),
  project: z.string(),
  title: z.string(),
  outcome: z.string().optional(),
  status: MilestoneStatusSchema,
  /** ISO date, `YYYY-MM-DD`. */
  targetDate: z.string().optional(),
  criteria: z.array(MilestoneCriterionSchema),
  taskIds: z.array(z.string()),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
  /** The completion review, once written. Markdown. */
  review: z.string().optional(),
});

export const MilestoneProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  /** 0–100, integer. Zero when there are no tasks. */
  percent: z.number().int().min(0).max(100),
  criteriaTotal: z.number().int().nonnegative(),
  criteriaDone: z.number().int().nonnegative(),
  /** Whole days until the target; negative when past. Absent when undated. */
  daysToTarget: z.number().int().optional(),
});

/** A task as the roadmap sees it: its line, plus where it stands. */
export const RoadmapTaskSchema = ProjectTaskSchema.extend({
  id: z.string(),
  status: TaskExecutionStatusSchema,
  /** Open dependencies, when `status` is `blocked`. */
  blockedBy: z.array(z.string()),
  milestoneId: z.string().optional(),
});

export const ProjectHealthSchema = z.enum(["on_track", "at_risk", "blocked", "no_target"]);

export const RoadmapMilestoneSchema = ProjectMilestoneSchema.extend({
  progress: MilestoneProgressSchema,
  tasks: z.array(RoadmapTaskSchema),
});

export const ProjectRoadmapSchema = z.object({
  project: z.string(),
  /** `MILESTONES.md` revision — what milestone edits are composed against. */
  revision: z.string(),
  /** `TASKS.md` revision — what task edits from the roadmap are composed against. */
  tasksRevision: z.string(),
  milestones: z.array(RoadmapMilestoneSchema),
  /** Open tasks in no milestone. A growing pile here means the project is drifting. */
  unplanned: z.array(RoadmapTaskSchema),
  health: ProjectHealthSchema,
  /** One line explaining the health verdict, deterministic. */
  healthReason: z.string(),
});

/** What the portfolio row shows about where a project is going. */
export const MilestoneSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  progress: MilestoneProgressSchema,
  targetDate: z.string().optional(),
});

export const CreateMilestoneRequestSchema = z.object({
  title: z.string().min(1).max(120),
  outcome: z.string().max(2000).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: MilestoneStatusSchema.optional(),
  criteria: z.array(z.string().min(1)).max(30).optional(),
  taskIds: z.array(z.string()).max(200).optional(),
  expectedRevision: z.string().optional(),
});

export const PatchMilestoneRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  outcome: z.string().max(2000).optional(),
  /** Empty string clears the target. */
  targetDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  status: MilestoneStatusSchema.optional(),
  criteria: z.array(MilestoneCriterionSchema).max(30).optional(),
  taskIds: z.array(z.string()).max(200).optional(),
  review: z.string().max(20000).optional(),
  expectedRevision: z.string().optional(),
});

/** Everything the milestone detail shows beyond the roadmap row. */
export const MilestoneDetailSchema = RoadmapMilestoneSchema.extend({
  agentWork: z.array(
    z.object({ worker: z.string(), jobs: z.number().int().nonnegative() }),
  ),
  /** Summed over the milestone's tasks from the usage ledger. */
  usage: z.object({
    jobs: z.number().int().nonnegative(),
    tokens: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  }),
});

/**
 * What Hermes proposes for a milestone. A proposal: `Apply plan` is the only
 * thing that writes, and it writes through the ordinary mutations.
 */
export const MilestonePlanSchema = z.object({
  milestoneId: z.string(),
  criteria: z.array(z.string()),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      section: ProjectTaskSectionSchema,
      /** Titles or ids of tasks this one should wait on, as Hermes named them. */
      after: z.array(z.string()),
    }),
  ),
  risks: z.array(z.string()),
  dependencies: z.array(z.string()),
  /** Criteria or outcomes no existing task addresses. The planning check. */
  uncovered: z.array(z.object({ outcome: z.string(), suggestedTask: z.string() })),
  plannedBy: z.enum(["hermes", "agentos"]),
});

export const ApplyMilestonePlanRequestSchema = z.object({
  criteria: z.array(z.string().min(1)).max(30),
  tasks: z
    .array(z.object({ title: z.string().min(1), section: ProjectTaskSectionSchema }))
    .max(50),
  expectedRevision: z.string().optional(),
  tasksRevision: z.string().optional(),
});

export const ArtifactTypeSchema = z.enum([
  "plan",
  "research",
  "spec",
  "design",
  "review",
  "report",
  "notes",
  "other",
]);

export const ArtifactSourceSchema = z.enum(["hermes", "grok", "claude", "human"]);

/**
 * One document AgentOS knows about.
 *
 * Two origins, one list. An `agentos` document lives in the vault — under
 * `docs/` when a person wrote it, under `artifacts/<task>/` when an agent did —
 * and identifies itself with front matter. A `repo` document is the project's
 * own README or `docs/` file, listed from the repository and read in place;
 * it is never copied, so it can never go stale.
 */
export const ProjectArtifactSchema = z.object({
  /** Stable: the vault- or repo-relative path without its extension. */
  id: z.string(),
  project: z.string(),
  origin: z.enum(["agentos", "repo"]),
  taskId: z.string().optional(),
  jobId: z.string().optional(),
  runId: z.string().optional(),
  title: z.string(),
  filename: z.string(),
  /** Relative to the vault (`projects/<slug>/…`) or to the repository. */
  relativePath: z.string(),
  type: ArtifactTypeSchema,
  source: ArtifactSourceSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
  /** chars ÷ 4. Good enough to stop a packet quietly tripling. */
  tokenEstimate: z.number().int().nonnegative(),
  /** Registered from a worker's worktree without the worker declaring it. */
  detected: z.boolean().optional(),
});

export const ProjectDocumentsSchema = z.object({
  project: z.string(),
  /** The five control files, priced for the context picker. Not documents. */
  canonical: z.array(ProjectArtifactSchema),
  agentos: z.array(ProjectArtifactSchema),
  repo: z.array(ProjectArtifactSchema),
  /** Why repo docs are missing, when they are. */
  repoUnavailable: z.string().optional(),
});

export const DocumentContentSchema = z.object({
  artifact: ProjectArtifactSchema,
  /** The body, without front matter. */
  content: z.string(),
  revision: z.string(),
});

export const CreateDocumentRequestSchema = z.object({
  title: z.string().min(1).max(160),
  type: ArtifactTypeSchema,
  taskId: z.string().optional(),
  content: z.string().max(200_000),
  /** Optional; derived from the title otherwise. */
  filename: z.string().max(120).optional(),
  source: ArtifactSourceSchema.optional(),
  runId: z.string().optional(),
});

export const DocumentProposalRequestSchema = z.object({
  brief: z.string().min(1).max(4000),
  taskId: z.string().optional(),
});

/** What Hermes proposes to write. Nothing is saved until the operator says so. */
export const DocumentProposalSchema = z.object({
  title: z.string(),
  type: ArtifactTypeSchema,
  filename: z.string(),
  taskId: z.string().optional(),
  content: z.string(),
  plannedBy: z.enum(["hermes"]),
});

export const RecentDocumentsSchema = z.object({
  documents: z.array(ProjectArtifactSchema.extend({ projectName: z.string().optional() })),
});

/**
 * One thing Knowledge lists: a document (vault or repository) or a decision.
 *
 * A view, never a copy. `href` is where it is actually read — the owning
 * workspace's Documents or Decisions tab — so there is one viewer and one
 * source of truth for every file.
 */
export const KnowledgeItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["document", "decision", "learning"]),
  title: z.string(),
  /** A workspace slug, or `learning` for a learning note linked to none. */
  project: z.string(),
  projectName: z.string(),
  workspaceType: WorkspaceTypeSchema.optional(),
  /** Document type, or `decision`. */
  type: z.union([ArtifactTypeSchema, z.literal("decision"), z.literal("learning")]),
  /** Absent when the file does not say who wrote it. */
  source: ArtifactSourceSchema.optional(),
  origin: z.enum(["agentos", "repo"]).optional(),
  taskId: z.string().optional(),
  updatedAt: z.string().optional(),
  /** One line of context: a decision's position, a document's path. */
  detail: z.string().optional(),
  href: z.string(),
});

export const KnowledgeResponseSchema = z.object({
  generatedAt: z.string(),
  items: z.array(KnowledgeItemSchema),
  /** Workspaces whose repository documentation could not be read. */
  unavailable: z.array(z.object({ project: z.string(), reason: z.string() })),
});

/** A note captured to `inbox/CAPTURE.md`, waiting to be filed. */
export const CapturedItemSchema = z.object({
  text: z.string(),
  kind: z.string().optional(),
  workspace: z.string().optional(),
});

export const CaptureListSchema = z.object({ items: z.array(CapturedItemSchema) });

export const CaptureRequestSchema = z.object({
  note: z.string().trim().min(1).max(2000),
  /** A workspace name to tag the note with. Tagging, not filing. */
  workspace: z.string().max(120).optional(),
});

/** What global search can find. Each kind renders as its own palette group. */
export const SearchHitKindSchema = z.enum([
  "project",
  "milestone",
  "task",
  "decision",
  "design",
  "document",
  "job",
  "session",
  "learning",
]);

export const SearchHitSchema = z.object({
  kind: SearchHitKindSchema,
  id: z.string(),
  title: z.string(),
  /** One line of context — a task's section, a job's status, a board's project. */
  detail: z.string().optional(),
  /** Slug of the project this belongs to, when it belongs to one. */
  project: z.string().optional(),
  /** Where choosing the hit goes. Always an in-app route. */
  href: z.string(),
});

export const SearchGroupSchema = z.object({
  kind: SearchHitKindSchema,
  hits: z.array(SearchHitSchema),
});

export const SearchResponseSchema = z.object({
  query: z.string(),
  groups: z.array(SearchGroupSchema),
  /** True when at least one group was cut at its limit. */
  truncated: z.boolean(),
});

/** One change applied to several tasks in a single write. */
export const BulkTaskActionSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(200),
  action: z.enum(["complete", "move", "archive", "restore"]),
  /** Required for `move`. */
  section: TaskSectionNameSchema.optional(),
  expectedRevision: z.string().optional(),
});

export const AgentMessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const AgentMessageSchema = z.object({
  id: z.string(),
  role: AgentMessageRoleSchema,
  /** Markdown. Rendered as elements, never injected as HTML. */
  content: z.string(),
  createdAt: z.string(),
});

export const AgentRequestSchema = z.object({
  message: z.string().min(1),
  /** Project slug, prepended as context for the agent. */
  project: z.string().optional(),
});

export const AgentResponseSchema = z.object({
  message: AgentMessageSchema,
});

/** Why a Hermes request could not be completed. Drives the UI's recovery copy. */
export const AgentFailureReasonSchema = z.enum([
  "not-configured",
  "offline",
  "unauthorized",
  // A Hermes that answered too slowly is not a Hermes that is down, and the
  // two want different responses: one is waited out or given a smaller
  // request, the other is started. Reviews of large diffs hit this first.
  "timed-out",
  "failed",
]);

/**
 * Whether Hermes is *configured*, established without contacting it.
 * Opening the console must never cost a Hermes request.
 */
export const AgentStatusSchema = z.object({
  configured: z.boolean(),
  /** Base URL only — the key is never sent to the browser. */
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

export const AgentRunStatusSchema = z.enum([
  "starting",
  "running",
  "waiting_for_approval",
  "stopping",
  "completed",
  "failed",
  "cancelled",
]);

export const AgentRunSchema = z.object({
  runId: z.string(),
  status: AgentRunStatusSchema,
  output: z.string().optional(),
  sessionId: z.string().optional(),
});

/**
 * Deliberately generic: Hermes may add event types at any time, and the console
 * must keep working when it does. Nothing here narrows `data`.
 */
export const AgentRunEventSchema = z.object({
  type: z.string(),
  data: z.unknown(),
  timestamp: z.string().optional(),
});

/**
 * What this Hermes build supports, discovered rather than assumed.
 *
 * Every flag defaults to false: an unreadable or unfamiliar capabilities
 * payload must disable features, never enable them.
 */
export const AgentCapabilitiesSchema = z.object({
  /** False when capabilities could not be read at all. */
  available: z.boolean(),
  runs: z.boolean(),
  events: z.boolean(),
  stop: z.boolean(),
  steer: z.boolean(),
  approvals: z.boolean(),
  subagents: z.boolean(),
  /**
   * Whether Hermes can actually look at an image.
   *
   * Read from the toolsets Hermes publishes rather than inferred, and false
   * unless the vision toolset is both enabled *and* configured — an enabled
   * toolset with no model behind it would accept the request and return an
   * opinion formed without seeing anything, which is the one failure mode a
   * visual review must not have.
   */
  vision: z.boolean(),
  /** Why vision cannot be used, when it cannot. Shown verbatim. */
  visionReason: z.string().optional(),
});

/**
 * One Hermes skill, normalised for the console.
 *
 * Hermes names the skill; everything else is derived by the adapter so React
 * never reads a Hermes payload. `scope` records whether the skill acts on a
 * project, which is what lets the palette ask which project before running it.
 */
export const AgentSkillScopeSchema = z.enum(["workspace", "project"]);

export const AgentSkillSchema = z.object({
  /** Bare skill name, e.g. `start-day`. */
  name: z.string(),
  /** The slash command that runs it, e.g. `/start-day`. */
  command: z.string(),
  description: z.string().optional(),
  /** Grouping label for the palette, e.g. `Daily`. */
  category: z.string().optional(),
  scope: AgentSkillScopeSchema,
});

export const AgentSkillsResponseSchema = z.object({
  skills: z.array(AgentSkillSchema),
  /**
   * False when Hermes could not be asked and the console is falling back to
   * its built-in baseline. The UI says so rather than implying discovery.
   */
  discovered: z.boolean(),
});

/**
 * A decision on an approval request.
 *
 * `once` gates this one action; `session` lasts the conversation; `always`
 * persists in Hermes. `always` is deliberately hard to reach in the UI — it
 * removes a gate permanently, which is not a primary-button decision.
 */
export const ApprovalDecisionSchema = z.enum([
  "once",
  "session",
  "always",
  "deny",
]);

/**
 * Hermes asking permission before it acts.
 *
 * This is a *system* approval — "may Hermes execute this?" — and is not the
 * same question as whether a proposed change to AgentOS state is correct. The
 * console keeps the two apart deliberately.
 */
export const ApprovalRequestSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  /** The exact action being gated, shown verbatim and never paraphrased. */
  command: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "approved", "denied"]),
});

/** What the adapter reports back after recording a decision. */
export const ApprovalResponseSchema = z.object({
  ok: z.boolean(),
  runId: z.string(),
  decision: ApprovalDecisionSchema,
});

export const AgentSessionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  /** Project slug this session is the conversation lane for. */
  project: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  messageCount: z.number().int().nonnegative().optional(),
});

export const AgentSessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string().optional(),
  createdAt: z.string().optional(),
});

export const AgentSessionMessagesSchema = z.object({
  sessionId: z.string(),
  messages: z.array(AgentSessionMessageSchema),
});

export const AgentSessionListSchema = z.object({
  sessions: z.array(AgentSessionSchema),
});

/**
 * A scheduled Hermes job, as the console shows it.
 *
 * Hermes owns the schedule; this is a read of what it already runs. The adapter
 * translates `hermes cron` output into this shape, so React never sees a cron
 * expression, a CLI table, or a job record.
 */
export const AutomationRunStatusSchema = z.enum(["success", "failed", "running"]);

export const AutomationStateSchema = z.enum([
  "active",
  "paused",
  "disabled",
  "completed",
]);

export const AutomationRunSummarySchema = z.object({
  status: AutomationRunStatusSchema,
  /** ISO 8601. Formatted for reading in the browser, not by the adapter. */
  timestamp: z.string(),
  /**
   * What Hermes said about a run that did not simply succeed — a failure
   * reason, or a delivery that never reached its target. Shown verbatim.
   */
  detail: z.string().optional(),
});

/**
 * What a job actually does, from Hermes' job record: the instruction it is
 * given and where its output goes. Read-only — AgentOS never writes it.
 */
export const AutomationRecipeSchema = z.object({
  /** The instruction Hermes runs, verbatim. */
  prompt: z.string().optional(),
  /** A script the job runs instead of, or before, the agent. */
  script: z.string().optional(),
  /** True for a script-only job that never calls the model. */
  noAgent: z.boolean().optional(),
  /** Where the result is delivered, e.g. `local` or a platform. */
  deliver: z.string().optional(),
  workdir: z.string().optional(),
  /** A per-job model override; absent means Hermes' default model. */
  model: z.string().optional(),
  provider: z.string().optional(),
  toolsets: z.array(z.string()),
});

export const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Hermes' own words, e.g. `weekdays at 7:30am`. Never a cron expression. */
  schedule: z.string(),
  enabled: z.boolean(),
  /** Why it is not enabled, when it is not: paused, disabled, or finished. */
  state: AutomationStateSchema,
  /** The skill this job runs, e.g. `start-day`. Absent for a script job. */
  skill: z.string().optional(),
  /** Every skill the job loads. `skill` is the first of these. */
  skills: z.array(z.string()),
  lastRun: AutomationRunSummarySchema.optional(),
  /** ISO 8601. Absent for a job that will not run again. */
  nextRun: z.string().optional(),
  /** Per-job warnings Hermes raised, e.g. a missed fire. Shown verbatim. */
  warnings: z.array(z.string()),
  /** Absent when Hermes' job record couldn't be read; the listing still stands. */
  recipe: AutomationRecipeSchema.optional(),
});

/** One durable execution attempt, for the run history. */
export const AutomationExecutionSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  status: AutomationRunStatusSchema,
  /** ISO 8601, when the attempt was claimed. */
  timestamp: z.string(),
  /** Hermes' raw status word, kept when it is not one of the three above. */
  rawStatus: z.string().optional(),
  error: z.string().optional(),
});

/** `hermes cron doctor`, read as a verdict rather than as text. */
export const AutomationHealthSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.string()),
});

export const AutomationsResponseSchema = z.object({
  automations: z.array(AutomationSchema),
  health: AutomationHealthSchema,
});

/**
 * Everything else in Hermes that acts on its own, beyond scheduled jobs —
 * each read independently, so one unreadable surface never hides the rest.
 */
export const HermesCuratorSchema = z.object({
  state: z.enum(["enabled", "paused", "disabled", "unknown"]),
  /** e.g. `every 7d`. */
  interval: z.string().optional(),
  /** e.g. `4d ago`. */
  lastRun: z.string().optional(),
  lastSummary: z.string().optional(),
  skills: z
    .object({ active: z.number().int(), stale: z.number().int(), archived: z.number().int() })
    .optional(),
});

export const HermesAutomationSurfacesSchema = z.object({
  /** `hermes pause`: halts all new cron, kanban and gateway work until `hermes resume`. */
  emergencyStop: z.object({ engaged: z.boolean(), reason: z.string().optional() }),
  /** Whether the gateway's scheduler is running, so jobs will actually fire. */
  scheduler: z.object({ running: z.boolean(), detail: z.string().optional() }),
  curator: HermesCuratorSchema,
  kanban: z.object({
    readable: z.boolean(),
    byStatus: z.record(z.string(), z.number().int()),
  }),
  hooks: z.object({
    configured: z.boolean(),
    /** Hermes' own listing lines, verbatim, when any hooks exist. */
    entries: z.array(z.string()),
  }),
  webhooks: z.object({
    enabled: z.boolean(),
    entries: z.array(z.string()),
  }),
});

/** A control AgentOS may use on a scheduled job. Creating and editing stay in Hermes. */
export const AutomationControlSchema = z.enum(["pause", "resume", "run"]);
export const CuratorControlSchema = z.enum(["pause", "resume"]);

export const AutomationDetailSchema = z.object({
  automation: AutomationSchema,
  runs: z.array(AutomationExecutionSchema),
});

/**
 * One thing that happened, from any part of the system.
 *
 * The activity layer aggregates rather than records: AgentOS files, Hermes,
 * automations and the UI event store each already know what they did, and this
 * is the shape they are normalised into. `grok` is reserved so a delegated
 * worker appears in the same timeline without a schema change.
 */
export const ActivitySourceSchema = z.enum([
  "user",
  "hermes",
  "automation",
  "agentos",
  // Delegated execution. The abstraction layer names *which* worker in the
  // event's description — a Mock job must never be filed as a Grok one.
  "worker",
  "grok",
]);

export const ActivityLevelSchema = z.enum([
  "info",
  "success",
  "warning",
  "error",
]);

export const ActivityEventSchema = z.object({
  /** Stable and deterministic, so the same happening is never listed twice. */
  id: z.string(),
  /** ISO 8601. The timeline is sorted on this and nothing else. */
  timestamp: z.string(),
  source: ActivitySourceSchema,
  level: ActivityLevelSchema,
  /** Dotted event name, e.g. `run.completed`. Not shown to the reader. */
  type: z.string(),
  title: z.string(),
  description: z.string().optional(),
  /** Project slug, when the event belongs to one. Drives the project filter. */
  project: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  /** Anything a specific event type wants to carry. Never rendered as JSON. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ActivityResponseSchema = z.object({
  events: z.array(ActivityEventSchema),
  /**
   * Sources that could not be read, named so the screen can say the timeline
   * is partial rather than implying nothing happened.
   */
  unavailable: z.array(ActivitySourceSchema),
});

/**
 * The visual asset layer.
 *
 * AgentOS markdown stays the knowledge layer; images live outside it, in their
 * own media directory, so the vault never becomes a repository full of PNGs.
 * React receives a URL it can render, never a filesystem path — the server
 * decides which file a request may reach, exactly as it does for the vault.
 */
export const DesignAssetTypeSchema = z.enum([
  "uploaded",
  "generated",
  "reference",
  "screenshot",
]);

export const DesignAssetSchema = z.object({
  id: z.string(),
  /** The name it arrived with. Shown, and searched, but never used as a path. */
  filename: z.string(),
  /** Same-origin URL for the full image. */
  url: z.string(),
  /** A smaller rendition when one could be made; the original otherwise. */
  thumbnailUrl: z.string(),
  type: DesignAssetTypeSchema,
  /** Project slug this asset belongs to, when it belongs to one. */
  project: z.string().optional(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  /** Pixel dimensions, read from the file. Absent for a format not understood. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  createdAt: z.string(),
  /** The prompt that produced a generated asset. */
  prompt: z.string().optional(),
  notes: z.string().optional(),
  /**
   * Still or moving. Higgsfield renders both, and a feed that assumed images
   * would silently drop half of what it can make.
   */
  mediaType: z.enum(["image", "video"]).default("image"),
  /** Running time in seconds, for a video. */
  durationSec: z.number().positive().optional(),
  /** Where it came from, which is not the same as what kind of thing it is. */
  source: z.enum(["higgsfield", "upload", "agentos", "other"]).default("upload"),
  /**
   * A product or area within the project — `chef`, `planner`, `vaja`.
   * Free text: the shape of a product is the operator's business, not a schema's.
   */
  product: z.string().optional(),
  /** The renderer and model that produced it, for a generated asset. */
  provider: z.string().optional(),
  model: z.string().optional(),
  /** Ties every variation of one prompt together. */
  generationId: z.string().optional(),
  /** The references this was generated from. */
  referenceAssetIds: z.array(z.string()).default([]),
  /** Chosen as the design, as distinct from merely liked. */
  approved: z.boolean().default(false),
  /**
   * Derived, never stored: a board owns its asset list, so membership has one
   * source of truth and the two can never disagree.
   */
  boardIds: z.array(z.string()),
});

export const DesignBoardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  project: z.string().optional(),
  /** Ids only. An asset is never copied into a board. */
  assetIds: z.array(z.string()),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const DesignLibrarySchema = z.object({
  assets: z.array(DesignAssetSchema),
  boards: z.array(DesignBoardSchema),
});

export const DesignAssetResponseSchema = z.object({
  asset: DesignAssetSchema,
  /** The upload matched a file already in the library, which is returned instead of a copy. */
  duplicate: z.boolean().optional(),
});

export const DesignBoardResponseSchema = z.object({
  board: DesignBoardSchema,
});

export const MainFocusSchema = z.object({
  project: z.string().optional(),
  outcome: z.string(),
});

export const DashboardDataSchema = z.object({
  mainFocus: MainFocusSchema,
  /**
   * The portfolio project the focus actually resolves to.
   *
   * Not the same as `mainFocus.project`, which is whatever the focus file leads
   * with — often infrastructure. The resolution already happens when the
   * dashboard picks a next action; returning it means a caller that needs to
   * link to the project does not have to redo it and get a different answer.
   */
  focusProjectSlug: z.string().optional(),
  nextAction: z.string().optional(),
  projects: z.array(ProjectSummarySchema),
  recentProgress: z.string().optional(),
  watch: z.string().optional(),
  inboxCount: z.number().int().nonnegative(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type ProjectPriority = z.infer<typeof ProjectPrioritySchema>;
export type ProjectKind = z.infer<typeof ProjectKindSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type MainFocus = z.infer<typeof MainFocusSchema>;
export type DashboardData = z.infer<typeof DashboardDataSchema>;
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;
export type ProjectTaskSection = z.infer<typeof ProjectTaskSectionSchema>;
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;
export type ProjectTaskGroup = z.infer<typeof ProjectTaskGroupSchema>;
export type ProjectDecision = z.infer<typeof ProjectDecisionSchema>;
export type WorkSessionSummary = z.infer<typeof WorkSessionSummarySchema>;
export type GitFileChange = z.infer<typeof GitFileChangeSchema>;
export type ProjectGit = z.infer<typeof ProjectGitSchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
export type WorkerPreference = z.infer<typeof WorkerPreferenceSchema>;
export type VisualVerificationDefault = z.infer<typeof VisualVerificationDefaultSchema>;
export type ProjectConfiguration = z.infer<typeof ProjectConfigurationSchema>;
export type ProjectConfigurationPatch = z.infer<typeof ProjectConfigurationPatchSchema>;
export type ProjectPatchRequest = z.infer<typeof ProjectPatchRequestSchema>;
export type ProjectPatchResponse = z.infer<typeof ProjectPatchResponseSchema>;
export type TaskSectionName = z.infer<typeof TaskSectionNameSchema>;
export type BulkTaskAction = z.infer<typeof BulkTaskActionSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;
export type ProjectPlanRequest = z.infer<typeof ProjectPlanRequestSchema>;
export type TaskExecutionStatus = z.infer<typeof TaskExecutionStatusSchema>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;
export type MilestoneCriterion = z.infer<typeof MilestoneCriterionSchema>;
export type ProjectMilestone = z.infer<typeof ProjectMilestoneSchema>;
export type MilestoneProgress = z.infer<typeof MilestoneProgressSchema>;
export type RoadmapTask = z.infer<typeof RoadmapTaskSchema>;
export type ProjectHealth = z.infer<typeof ProjectHealthSchema>;
export type RoadmapMilestone = z.infer<typeof RoadmapMilestoneSchema>;
export type ProjectRoadmap = z.infer<typeof ProjectRoadmapSchema>;
export type MilestoneSummary = z.infer<typeof MilestoneSummarySchema>;
export type CreateMilestoneRequest = z.infer<typeof CreateMilestoneRequestSchema>;
export type PatchMilestoneRequest = z.infer<typeof PatchMilestoneRequestSchema>;
export type MilestoneDetail = z.infer<typeof MilestoneDetailSchema>;
export type MilestonePlan = z.infer<typeof MilestonePlanSchema>;
export type ApplyMilestonePlanRequest = z.infer<typeof ApplyMilestonePlanRequestSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type ArtifactSource = z.infer<typeof ArtifactSourceSchema>;
export type ProjectArtifact = z.infer<typeof ProjectArtifactSchema>;
export type ProjectDocuments = z.infer<typeof ProjectDocumentsSchema>;
export type DocumentContent = z.infer<typeof DocumentContentSchema>;
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;
export type DocumentProposal = z.infer<typeof DocumentProposalSchema>;
export type RecentDocuments = z.infer<typeof RecentDocumentsSchema>;
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
export type KnowledgeResponse = z.infer<typeof KnowledgeResponseSchema>;
export type CapturedItem = z.infer<typeof CapturedItemSchema>;
export type CaptureList = z.infer<typeof CaptureListSchema>;
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;
export type SearchHitKind = z.infer<typeof SearchHitKindSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchGroup = z.infer<typeof SearchGroupSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type AgentMessageRole = z.infer<typeof AgentMessageRoleSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type AgentFailureReason = z.infer<typeof AgentFailureReasonSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
export type AgentSkillScope = z.infer<typeof AgentSkillScopeSchema>;
export type AgentSkill = z.infer<typeof AgentSkillSchema>;
export type AgentSkillsResponse = z.infer<typeof AgentSkillsResponseSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentSessionMessage = z.infer<typeof AgentSessionMessageSchema>;
export type AgentSessionMessages = z.infer<typeof AgentSessionMessagesSchema>;
export type AgentSessionList = z.infer<typeof AgentSessionListSchema>;
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;
export type AutomationState = z.infer<typeof AutomationStateSchema>;
export type AutomationRunSummary = z.infer<typeof AutomationRunSummarySchema>;
export type Automation = z.infer<typeof AutomationSchema>;
export type AutomationExecution = z.infer<typeof AutomationExecutionSchema>;
export type AutomationHealth = z.infer<typeof AutomationHealthSchema>;
export type AutomationsResponse = z.infer<typeof AutomationsResponseSchema>;
export type AutomationDetail = z.infer<typeof AutomationDetailSchema>;
export type AutomationRecipe = z.infer<typeof AutomationRecipeSchema>;
export type HermesCurator = z.infer<typeof HermesCuratorSchema>;
export type HermesAutomationSurfaces = z.infer<typeof HermesAutomationSurfacesSchema>;
export type AutomationControl = z.infer<typeof AutomationControlSchema>;
export type CuratorControl = z.infer<typeof CuratorControlSchema>;
export type ActivitySource = z.infer<typeof ActivitySourceSchema>;
export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type DesignAssetType = z.infer<typeof DesignAssetTypeSchema>;
export type DesignAsset = z.infer<typeof DesignAssetSchema>;
export type DesignBoard = z.infer<typeof DesignBoardSchema>;
export type DesignLibrary = z.infer<typeof DesignLibrarySchema>;
export type DesignAssetResponse = z.infer<typeof DesignAssetResponseSchema>;
export type DesignBoardResponse = z.infer<typeof DesignBoardResponseSchema>;
