import { z } from "zod";
import {
  ActivityEventSchema,
  MilestoneSummarySchema,
  ProjectHealthSchema,
  ProjectSummarySchema,
} from "./agentos-types";

/**
 * One screen that answers four questions: what matters, what is running, what
 * needs me, and what is broken.
 *
 * Mission Control is a **consolidation**, not another system. Everything on it
 * already exists somewhere — the vault's focus, worker jobs, Hermes' cron,
 * the activity log — and the one rule that keeps it from becoming a fifth
 * source of truth is that it owns no workflow state of its own. It reads, it
 * ranks, and it links. It cannot approve, review, revise or schedule anything;
 * every action on it is a deep link into the system that actually owns that
 * decision.
 *
 * Nothing here is derived by asking a model. Attention is computed from job
 * statuses and automation health with ordinary code, so the screen costs
 * nothing to open and says the same thing twice in a row.
 */

/**
 * One vocabulary for "how is this thing doing", used by every subsystem here.
 *
 * Worth stating plainly because the codebase had drifted: cron said `healthy`,
 * workers said `available`, Hermes said `configured`, projects said `active`,
 * and several of those meant the same thing. A reader comparing two rows
 * should not have to know which subsystem wrote each one.
 *
 * This is the *liveness and health* vocabulary. The design system's
 * `AgentStatus` remains what pills are drawn with; one mapping in the view
 * model translates between them, rather than every feature inventing its own.
 */
export const SystemStatusSchema = z.enum([
  /** Configured, reachable, and doing nothing. The good resting state. */
  "ready",
  /** Actually executing something right now. */
  "running",
  /** Alive, but held up on something — usually a person. */
  "waiting",
  /** Working, but something about it needs looking at. */
  "attention",
  /** Tried and did not succeed. */
  "failed",
  /** Could not be determined. Never rounded up to `ready`. */
  "unknown",
  /** Not reachable, or not configured. */
  "offline",
]);

/**
 * What is waiting on a person, and how loudly.
 *
 * `critical` is reserved for something that is broken or stuck; `warning` for a
 * decision that is genuinely pending; `info` for something worth seeing but not
 * blocking. The severity decides the order and the tone, and nothing else.
 */
export const AttentionSeveritySchema = z.enum(["critical", "warning", "info"]);

export const AttentionTypeSchema = z.enum([
  "approval",
  "review",
  "changes_required",
  "blocked",
  "failed",
  "automation",
  "system",
]);

/**
 * One thing asking for the operator.
 *
 * `action` is a link, always — Mission Control routes to the screen that owns
 * the decision rather than reimplementing it. An attention item that could not
 * name where to go would be a notification, and notifications are what this
 * screen exists instead of.
 */
export const AttentionItemSchema = z.object({
  id: z.string(),
  type: AttentionTypeSchema,
  severity: AttentionSeveritySchema,
  title: z.string(),
  description: z.string().optional(),
  project: z.string().optional(),
  action: z.object({
    label: z.string(),
    /** In-app, e.g. `/workers/jobs/job_123`. Never external. */
    href: z.string(),
  }),
  createdAt: z.string(),
  /** How many attempts at the same work this card stands for, when more than one failed. */
  occurrences: z.number().int().min(1).optional(),
  /** Present on a failed job: what a retry from the card would start. */
  retry: z
    .object({
      jobId: z.string(),
      /** The worker that failed, so the card can offer the others. */
      worker: z.string(),
      /** The failure was a usage or rate limit: another worker is the better retry. */
      limitHit: z.boolean(),
    })
    .optional(),
  /** Present on a worker job that can be approved, rejected, or revised from here. */
  workerJob: z
    .object({
      jobId: z.string(),
      /** Whether this job can be approved (has passed review and validation). */
      canApprove: z.boolean(),
      /** Whether this job needs revision (has review findings to send back). */
      canRevise: z.boolean(),
    })
    .optional(),
});

/**
 * Something genuinely executing.
 *
 * The bar is deliberately high: a project that exists is not active work, and
 * a job that finished an hour ago is not either. Only a process that is running
 * at the moment the page was built belongs here, because the whole value of the
 * section is that it is true right now.
 */
export const ActiveWorkItemSchema = z.object({
  id: z.string(),
  /** Who is doing it, in the operator's words — `GROK`, `HERMES`, `CLAUDE`. */
  actor: z.string(),
  /**
   * The same actor as an id the rest of the app keys on: a worker id
   * (`claude-code`), `hermes`, or `operator`. Absent for a job still on
   * `auto` that has not been given a worker yet.
   */
  agent: z.string().optional(),
  title: z.string(),
  project: z.string().optional(),
  /** What stage it is at, when there is one worth naming. */
  detail: z.string().optional(),
  startedAt: z.string(),
  href: z.string(),
  /**
   * When the worker was last heard from. Absent, the start is the best we have.
   *
   * Unconfirmed work shows this rather than a ticking "running" clock: a job
   * that has not spoken for hours must not look freshly live.
   */
  lastSeenAt: z.string().optional(),
  /**
   * True when this is inferred rather than observed.
   *
   * A Hermes run's start is recorded by the adapter; its end is reported by
   * whoever holds the event stream. Close the tab mid-run and the ending is
   * never written, so a run that has been open a long time is reported as
   * possibly finished rather than confidently still going.
   */
  uncertain: z.boolean().optional(),
});

/** A worker, as the strip on Mission Control needs it. */
export const MissionWorkerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: SystemStatusSchema,
  /** `1 job`, or why it cannot be used. */
  detail: z.string().optional(),
  href: z.string(),
});

export const MissionAutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: SystemStatusSchema,
  /**
   * ISO 8601, when Hermes says it next fires.
   *
   * Sent raw and worded in the browser, like every other timestamp that
   * crosses this boundary: "tomorrow · 07:30" is a statement about the
   * reader's clock, and the adapter does not have one.
   */
  nextRun: z.string().optional(),
  /** What went wrong, when something did. Not a schedule. */
  detail: z.string().optional(),
  href: z.string(),
});

/** One row of the system panel. */
export const SystemComponentSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: SystemStatusSchema,
  /** Shown only when something is wrong. A healthy system explains nothing. */
  detail: z.string().optional(),
});

/**
 * What the day is about.
 *
 * Read from the vault, which is a person's own account of their priorities —
 * not generated, and not regenerated on every refresh.
 */
export const FocusSummarySchema = z.object({
  project: z.string().optional(),
  /** The portfolio slug, when the focus resolves to a real project. */
  projectSlug: z.string().optional(),
  outcome: z.string(),
  nextAction: z.string().optional(),
  /** The risk the focus file says to carry into the day. */
  watch: z.string().optional(),
  inboxCount: z.number().int().nonnegative(),
  /** The focus project's active milestone, when it has one. */
  milestone: MilestoneSummarySchema.optional(),
  health: ProjectHealthSchema.optional(),
  /** The next task flagged ready in that milestone — what "start work" means. */
  nextReady: z.object({ id: z.string(), title: z.string() }).optional(),
});

/**
 * Which sources answered, and which did not.
 *
 * Mission Control reads five systems and any one of them can be down. The page
 * degrades a section rather than failing the request — an unreachable Hermes
 * must not cost the operator their worker queue — and says which section is
 * degraded, because a silently empty list reads as good news.
 */
export const MissionSourcesSchema = z.object({
  vault: SystemStatusSchema,
  workers: SystemStatusSchema,
  automations: SystemStatusSchema,
  activity: SystemStatusSchema,
  hermes: SystemStatusSchema,
});

/** Cards to clear from Needs you: each identified by id and when it became a problem. */
export const AttentionDismissRequestSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), createdAt: z.string().min(1) })).min(1).max(200),
});

/** Cards to bring back; no ids restores all of them. */
export const AttentionRestoreRequestSchema = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
});

export const MissionControlDataSchema = z.object({
  generatedAt: z.string(),
  focus: FocusSummarySchema.optional(),
  /** Ordered worst-first. The order is the answer to "what do I do next?". */
  attention: z.array(AttentionItemSchema).default([]),
  /** Still-current cards the operator cleared from Needs you — kept so they can be restored. */
  dismissed: z.array(AttentionItemSchema).default([]),
  activeWork: z.array(ActiveWorkItemSchema).default([]),
  workers: z.array(MissionWorkerSchema).default([]),
  automations: z.array(MissionAutomationSchema).default([]),
  recentActivity: z.array(ActivityEventSchema).default([]),
  system: z.array(SystemComponentSchema).default([]),
  /** The projects competing for today, for the focus block's context. */
  projects: z.array(ProjectSummarySchema).default([]),
  sources: MissionSourcesSchema,
});

export type SystemStatus = z.infer<typeof SystemStatusSchema>;
export type AttentionSeverity = z.infer<typeof AttentionSeveritySchema>;
export type AttentionType = z.infer<typeof AttentionTypeSchema>;
export type AttentionItem = z.infer<typeof AttentionItemSchema>;
export type ActiveWorkItem = z.infer<typeof ActiveWorkItemSchema>;
export type MissionWorker = z.infer<typeof MissionWorkerSchema>;
export type MissionAutomation = z.infer<typeof MissionAutomationSchema>;
export type SystemComponent = z.infer<typeof SystemComponentSchema>;
export type FocusSummary = z.infer<typeof FocusSummarySchema>;
export type MissionSources = z.infer<typeof MissionSourcesSchema>;
export type MissionControlData = z.infer<typeof MissionControlDataSchema>;
