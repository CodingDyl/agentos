import { z } from "zod";
import {
  RepositoryActionResultSchema,
  RepositoryStatusSchema,
  type RepositoryAction,
  type RepositoryActionResult,
  type RepositoryStatus,
} from "@shared/repository-types";
import {
  AgentCapabilitiesSchema,
  AgentFailureReasonSchema,
  AgentResponseSchema,
  AgentRunSchema,
  AgentSessionListSchema,
  AgentSessionMessagesSchema,
  AgentSessionSchema,
  AgentSkillsResponseSchema,
  AgentStatusSchema,
  ApprovalResponseSchema,
  ActivityResponseSchema,
  AutomationDetailSchema,
  DesignAssetResponseSchema,
  DesignBoardResponseSchema,
  DesignLibrarySchema,
  AutomationsResponseSchema,
  HermesAutomationSurfacesSchema,
  DashboardDataSchema,
  ProjectDetailSchema,
  ProjectsResponseSchema,
  ProjectPlanSchema,
  ProjectRoadmapSchema,
  MilestoneDetailSchema,
  MilestonePlanSchema,
  ProjectDocumentsSchema,
  DocumentContentSchema,
  DocumentProposalSchema,
  RecentDocumentsSchema,
  KnowledgeResponseSchema,
  CaptureListSchema,
  type KnowledgeResponse,
  type CaptureList,
  SearchResponseSchema,
  type CreateDocumentRequest,
  type DocumentContent,
  type DocumentProposal,
  type ProjectArtifact,
  type ProjectDocuments,
  type RecentDocuments,
  type ApplyMilestonePlanRequest,
  type CreateMilestoneRequest,
  type MilestoneDetail,
  type MilestonePlan,
  type PatchMilestoneRequest,
  type ProjectRoadmap,
  type BulkTaskAction,
  type CreateProjectRequest,
  type ProjectConfiguration,
  type ProjectPatchRequest,
  type ProjectPatchResponse,
  type ProjectPlan,
  type SearchResponse,
  type AgentCapabilities,
  type AgentFailureReason,
  type AgentRequest,
  type AgentRun,
  type AgentResponse,
  type AgentSession,
  type AgentSessionList,
  type AgentSessionMessages,
  type AgentSkillsResponse,
  type AgentStatus,
  type ApprovalDecision,
  type ApprovalResponse,
  type ActivityResponse,
  type AutomationDetail,
  type DesignAsset,
  type DesignAssetType,
  type DesignBoard,
  type DesignLibrary,
  type AutomationsResponse,
  type AutomationControl,
  type CuratorControl,
  type HermesAutomationSurfaces,
  type DashboardData,
  type ProjectDetail,
  type ProjectsResponse,
} from "@shared/agentos-types";
import {
  MissionControlDataSchema,
  type MissionControlData,
} from "@shared/mission-control-types";
import {
  VisualVerificationResponseSchema,
  type VisualVerificationResponse,
} from "@shared/visual-verification-types";
import {
  IntegrationBlockerSchema,
  WorkerDiffSchema,
  WorkerJobEventsResponseSchema,
  WorkerJobResponseSchema,
  WorkerJobsResponseSchema,
  WorkersResponseSchema,
  type IntegrationBlocker,
  type WorkerDiff,
  type WorkerJob,
  type WorkerJobRequest,
  type WorkersResponse,
} from "@shared/worker-types";
import {
  type DesignGeneration,
  type DesignGenerationRequest,
  DesignGenerationResponseSchema,
  type DesignGenerationsResponse,
  DesignGenerationsResponseSchema,
  type GenerationCapabilityResponse,
  GenerationCapabilityResponseSchema,
  type CostEstimate,
  CostEstimateResponseSchema,
  type HiggsfieldAccount,
  HiggsfieldAccountSchema,
  type HiggsfieldModel,
  HiggsfieldModelsResponseSchema,
} from "@shared/design-generation-types";
import {
  type DesignBriefProposal,
  DesignBriefProposalResponseSchema,
  type DesignReview,
  type DesignReviewRequest,
  DesignReviewResponseSchema,
  type DesignReviewsResponse,
  DesignReviewsResponseSchema,
} from "@shared/design-intelligence-types";
import {
  type MilestoneDelegationPreview,
  MilestoneDelegationPreviewSchema,
  type MilestoneDelegationResult,
  MilestoneDelegationResultSchema,
  type MilestoneTaskApproval,
  type TaskCompletionProposal,
  TaskCompletionProposalSchema,
  type TaskDelegationApproval,
  type TaskDelegationPreview,
  TaskDelegationPreviewSchema,
  type TaskDelegationsResponse,
  TaskDelegationsResponseSchema,
} from "@shared/delegation-types";
import {
  type WorkerRoutingRequest,
  type WorkerRoutingResponse,
  WorkerRoutingResponseSchema,
} from "@shared/worker-routing-types";
import {
  ExecutionOptionsResponseSchema,
  OllamaStatusResponseSchema,
  ProbeResponseSchema,
  RoutePreviewResponseSchema,
  type ExecutionOptionsResponse,
  type OllamaSettings,
  type OllamaStatusResponse,
  type ProbeRequest,
  type ProbeResult,
  type RoutePreviewResponse,
} from "@shared/route-policy-types";
import {
  type AgentDetail,
  AgentDetailResponseSchema,
  type BudgetsResponse,
  BudgetsResponseSchema,
  type OperationsData,
  OperationsDataSchema,
  type Subscription,
  type SubscriptionsResponse,
  SubscriptionsResponseSchema,
  type TaskUsage,
  TaskUsageResponseSchema,
  type UsageBudget,
  type UsageRange,
  type UsageSummary,
  UsageSummarySchema,
} from "@shared/usage-types";
import {
  type ReportFriction,
  type StartValidationTask,
  type UpdateValidationTask,
  type ValidationFriction,
  ValidationFrictionResponseSchema,
  type ValidationSprint,
  ValidationSprintSchema,
  type ValidationTask,
  ValidationTaskResponseSchema,
} from "@shared/validation-sprint-types";
import {
  MailBulkResultSchema,
  MailDataSchema,
  MailProgressSchema,
  MailStatusSchema,
  MailSyncResultSchema,
  MailThreadBodySchema,
  type MailBulkAction,
  type MailBulkResult,
  type MailCorrection,
  type MailData,
  type MailProgress,
  type MailStatus,
  type MailSyncResult,
} from "@shared/mail-types";
import { AiStackSchema, type AiStack } from "@shared/ai-stack-types";
import {
  ProjectVercelInfoSchema,
  VercelProjectsResponseSchema,
  type ProjectVercelInfo,
  type VercelProjectSummary,
} from "@shared/vercel-types";
import {
  ProjectSeoSchema,
  SeoAuditRunSchema,
  type ProjectSeo,
  type SeoAuditRun,
} from "@shared/seo-types";
import {
  DayWrapSchema,
  MorningBriefSchema,
  TodayCalendarSchema,
  TodayNewsSchema,
  TodayTrendingSchema,
  type DayWrap,
  type MorningBrief,
  type TodayCalendar,
  type TodayNews,
  type TodayTrending,
} from "@shared/today-types";

/**
 * Talks to the local AgentOS data adapter.
 *
 * Responses are validated against the shared schema, so an adapter that drifts
 * from the contract fails loudly here instead of silently corrupting the UI.
 */

export class AgentOSRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AgentOSRequestError";
  }
}

/** A Hermes failure, carrying the adapter's classification of the cause. */
export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

/** Fetches and validates one adapter endpoint. */
async function readVault<T>(
  path: string,
  parse: (value: unknown) => { success: true; data: T } | { success: false },
  /** What a 404 means for this endpoint, in the reader's terms. */
  notFound = "That project is not in the AgentOS portfolio.",
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path);
  } catch {
    throw new AgentOSRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
    );
  }

  if (!response.ok) {
    throw new AgentOSRequestError(
      response.status === 404
        ? notFound
        : "The AgentOS data adapter could not read the vault.",
      response.status,
    );
  }

  const result = parse(await response.json());

  if (!result.success) {
    throw new AgentOSRequestError(
      "The AgentOS data adapter returned data in an unexpected shape.",
    );
  }

  return result.data;
}

/**
 * Mission Control's whole state, in one read.
 *
 * Deliberately one request rather than six: the screen's value is that its
 * sections agree with each other, and six independently-timed reads would let
 * "nothing needs you" sit beside an attention badge saying otherwise.
 *
 * The adapter never fails this for a single bad source — it returns partial
 * data with `sources` saying which section is degraded.
 */
/** Today's Google Calendar events. Never throws for a missing calendar; that comes back as a status. */
export function getTodayCalendar(): Promise<TodayCalendar> {
  return readVault("/api/today/calendar", (value) => TodayCalendarSchema.safeParse(value));
}

/** Hermes' newest morning brief, parsed into its plan. */
export function getMorningBrief(): Promise<MorningBrief> {
  return readVault("/api/today/brief", (value) => MorningBriefSchema.safeParse(value));
}

/** The end-of-day wrap: done today, and what tomorrow starts with. */
export function getDayWrap(): Promise<DayWrap> {
  return readVault("/api/today/wrap", (value) => DayWrapSchema.safeParse(value));
}

/** Tech and AI news from Hacker News and trusted outlets. */
export function getTodayNews(): Promise<TodayNews> {
  return readVault("/api/today/news", (value) => TodayNewsSchema.safeParse(value));
}

/** New GitHub repositories taking off this week. */
export function getTodayTrending(): Promise<TodayTrending> {
  return readVault("/api/today/trending", (value) => TodayTrendingSchema.safeParse(value));
}

/** Clears cards from Today's Needs you. What's behind them is untouched. */
export function dismissAttention(items: { id: string; createdAt: string }[]): Promise<unknown> {
  return workerRequest("/api/mission-control/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

/** Brings cleared cards back; no ids restores every one. */
export function restoreAttention(ids?: string[]): Promise<unknown> {
  return workerRequest("/api/mission-control/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
}

export function getMissionControl(): Promise<MissionControlData> {
  return readVault(
    "/api/mission-control",
    (value) => MissionControlDataSchema.safeParse(value),
    "Mission control could not be read.",
  );
}

export function getDashboard(): Promise<DashboardData> {
  return readVault("/api/dashboard", (value) =>
    DashboardDataSchema.safeParse(value),
  );
}

/**
 * Mail's whole state: pre-bucketed, pre-sorted. Never triggers a Gmail or
 * Jev call — that only happens from `syncMail`.
 */
export function getMail(): Promise<MailData> {
  return readVault("/api/mail", (value) => MailDataSchema.safeParse(value));
}

export function getMailStatus(): Promise<MailStatus> {
  return readVault("/api/mail/status", (value) => MailStatusSchema.safeParse(value));
}

/** A specific thread's full plain-text body, read only when it is opened. */
export function getMailThreadBody(threadId: string): Promise<{ body: string }> {
  return readVault(`/api/mail/${encodeURIComponent(threadId)}/body`, (value) =>
    MailThreadBodySchema.safeParse(value),
  );
}

export function syncMail(): Promise<MailSyncResult> {
  return workerRequest("/api/mail/sync", { method: "POST" }, (value) =>
    MailSyncResultSchema.safeParse(value),
  );
}

export function disconnectMail(): Promise<unknown> {
  return workerRequest("/api/mail/disconnect", { method: "POST" });
}

/** How far the current Refresh or "Ask Jev again" has got. */
export function getMailProgress(): Promise<MailProgress> {
  return readVault("/api/mail/progress", (value) => MailProgressSchema.safeParse(value));
}

function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Corrects Jev's profile of one thread. Local, and sent to Jev as an example on later calls. */
export function correctMailThread(threadId: string, correction: MailCorrection): Promise<unknown> {
  return workerRequest(`/api/mail/${encodeURIComponent(threadId)}/correct`, postJson(correction));
}

/** Drops a correction, handing the thread back to Jev's judgment. */
export function clearMailCorrection(threadId: string): Promise<unknown> {
  return workerRequest(`/api/mail/${encodeURIComponent(threadId)}/correct/clear`, { method: "POST" });
}

/** Marks one thread read or unread — in Gmail, then locally. */
export function setMailThreadRead(threadId: string, read: boolean): Promise<MailBulkResult> {
  return workerRequest(`/api/mail/${encodeURIComponent(threadId)}/read`, postJson({ read }), (value) =>
    MailBulkResultSchema.safeParse(value),
  );
}

/** Mark read / move to Gmail Trash / ask Jev again, for a list of threads. */
export function runMailBulkAction(action: MailBulkAction, threadIds: string[]): Promise<MailBulkResult> {
  return workerRequest("/api/mail/bulk", postJson({ action, threadIds }), (value) =>
    MailBulkResultSchema.safeParse(value),
  );
}

/** Hides a thread from the Mail view. Local only — the Gmail message itself is never touched. */
export function removeMailThread(threadId: string): Promise<unknown> {
  return workerRequest(`/api/mail/${encodeURIComponent(threadId)}/remove`, { method: "POST" });
}

/** Not a fetch — a real navigation, since it hands the browser to Google's own consent screen. */
export function mailConnectUrl(): string {
  return "/api/mail/connect";
}

/** Every AI on this machine, which of them AgentOS uses, and how much. Changes nothing. */
export function getAiStack(): Promise<AiStack> {
  return readVault("/api/ai-stack", (value) => AiStackSchema.safeParse(value));
}

/** Switches one integrated AI on or off for AgentOS. */
export function setAiEnabled(input: { id: string; enabled: boolean }): Promise<unknown> {
  return workerRequest(`/api/ai-stack/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    ...asJson({ enabled: input.enabled }),
  });
}

/** Chooses the model an AI runs. An empty model clears it back to the tool's own default. */
export function setAiModel(input: { id: string; model: string }): Promise<unknown> {
  return workerRequest(`/api/ai-stack/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    ...asJson({ model: input.model }),
  });
}

/** Every Vercel project the configured token can see, for the "connect a project" picker. */
export function getVercelProjects(): Promise<{ projects: VercelProjectSummary[] }> {
  return readVault("/api/vercel/projects", (value) => VercelProjectsResponseSchema.safeParse(value));
}

/** A linked project's live URL, domains, and recent deployments. 404 if nothing is linked yet. */
export function getProjectVercelInfo(slug: string): Promise<ProjectVercelInfo> {
  return readVault(
    `/api/projects/${encodeURIComponent(slug)}/vercel`,
    (value) => ProjectVercelInfoSchema.safeParse(value),
    "No Vercel project is linked yet.",
  );
}

/** The SEO tab's whole read: the latest audit in full, plus prior runs as history. Never crawls on its own. */
export function getProjectSeo(slug: string): Promise<ProjectSeo> {
  return readVault(`/api/projects/${encodeURIComponent(slug)}/seo`, (value) => ProjectSeoSchema.safeParse(value));
}

/** Crawls the project's live site and records a fresh audit. The only call in this feature that is not a plain read. */
export function runProjectSeoAudit(input: { slug: string; targetUrl?: string }): Promise<SeoAuditRun> {
  const { slug, ...body } = input;

  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/seo/audit`,
    { method: "POST", ...asJson(body) },
    (value) => SeoAuditRunSchema.safeParse(value),
  );
}

/** Files a finding as a task on the project's board. */
export function createTaskFromSeoFinding(input: {
  slug: string;
  findingId: string;
}): Promise<{ taskId: string; findingId: string }> {
  return workerRequest(`/api/projects/${encodeURIComponent(input.slug)}/seo/findings/${encodeURIComponent(input.findingId)}/task`, {
    method: "POST",
  });
}

export function getProjects(): Promise<ProjectsResponse> {
  return readVault("/api/projects", (value) =>
    ProjectsResponseSchema.safeParse(value),
  );
}

export function getProject(slug: string): Promise<ProjectDetail> {
  return readVault(`/api/projects/${encodeURIComponent(slug)}`, (value) =>
    ProjectDetailSchema.safeParse(value),
  );
}

/**
 * The scheduled jobs Hermes runs.
 *
 * Reading automations costs no model call: the adapter reads Hermes' own
 * schedule and reports what is already there.
 */
export function getAutomations(): Promise<AutomationsResponse> {
  return readVault("/api/automations", (value) =>
    AutomationsResponseSchema.safeParse(value),
  );
}

/** Hermes' other automation surfaces: curator, kanban, hooks, webhooks, scheduler, emergency stop. */
export function getAutomationSurfaces(): Promise<HermesAutomationSurfaces> {
  return readVault("/api/hermes/automation-surfaces", (value) => HermesAutomationSurfacesSchema.safeParse(value));
}

/** Pause, resume, or run a scheduled job now — in Hermes. */
export function controlAutomation(id: string, control: AutomationControl): Promise<unknown> {
  return workerRequest(`/api/automations/${encodeURIComponent(id)}/${control}`, { method: "POST" });
}

export function controlCurator(control: CuratorControl): Promise<unknown> {
  return workerRequest(`/api/hermes/curator/${control}`, { method: "POST" });
}

/** One automation and the execution attempts Hermes recorded for it. */
export function getAutomation(id: string): Promise<AutomationDetail> {
  return readVault(
    `/api/automations/${encodeURIComponent(id)}`,
    (value) => AutomationDetailSchema.safeParse(value),
    "Hermes has no scheduled job with that id.",
  );
}

export interface ActivityQuery {
  project?: string;
  source?: string;
  limit?: number;
}

/**
 * The unified activity timeline.
 *
 * Aggregated by the adapter from state that already exists, so reading it costs
 * no model call. Filters are applied server-side — the browser never holds the
 * whole history.
 */
export function getActivity(query: ActivityQuery = {}): Promise<ActivityResponse> {
  const params = new URLSearchParams();
  if (query.project) params.set("project", query.project);
  if (query.source) params.set("source", query.source);
  if (query.limit) params.set("limit", String(query.limit));

  const search = params.toString();

  return readVault(
    `/api/activity${search ? `?${search}` : ""}`,
    (value) => ActivityResponseSchema.safeParse(value),
  );
}

/**
 * Reports an outcome only the browser saw.
 *
 * A run ends on the event stream, which the console holds. Only the event type
 * is sent: the adapter owns the wording, so the audit trail cannot be written
 * in the browser's words. Failing to record must never fail the run it
 * describes, so this resolves either way.
 */
export async function reportActivity(report: {
  type: "run.completed" | "run.failed" | "run.cancelled" | "automation.run";
  project?: string;
  runId?: string;
  sessionId?: string;
  description?: string;
}): Promise<void> {
  try {
    await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch {
    // An unrecorded event is a gap in the timeline, not a failed run.
  }
}

/**
 * The design library: every asset, and the boards that collect them.
 *
 * Images are served from the adapter by id. The browser never learns where a
 * file lives, exactly as with the vault.
 */
export function getDesignLibrary(): Promise<DesignLibrary> {
  return readVault("/api/designs", (value) =>
    DesignLibrarySchema.safeParse(value),
  );
}

/** Shared failure handling for the library's write calls. */
async function designRequest<T>(
  path: string,
  init: RequestInit,
  parse?: (value: unknown) => { success: true; data: T } | { success: false },
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(
      failure?.error ?? "The design library could not be changed.",
      response.status,
    );
  }

  if (!parse) return payload as T;

  const result = parse(payload);

  if (!result.success) {
    throw new AgentOSRequestError(
      "The design library returned data in an unexpected shape.",
    );
  }

  return result.data;
}

export interface UploadAssetOptions {
  project?: string;
  type?: DesignAssetType;
}

/**
 * Adds one image to the library.
 *
 * The file is sent as the request body and its own type names the format, so
 * the server decides where it is stored. The filename travels as a label only.
 */
export function uploadDesignAsset(
  file: File,
  options: UploadAssetOptions = {},
): Promise<DesignAsset> {
  const params = new URLSearchParams({ filename: file.name });
  if (options.project) params.set("project", options.project);
  if (options.type) params.set("type", options.type);

  return designRequest(
    `/api/designs/assets?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    },
    (value) => DesignAssetResponseSchema.safeParse(value),
  ).then((response) => response.asset);
}

/** `null` clears a field; an absent field is left alone. */
export interface AssetPatch {
  project?: string | null;
  /** `null` clears it: an asset can stop belonging to a product. */
  product?: string | null;
  tags?: string[];
  favorite?: boolean;
  /** Chosen as the design, as distinct from merely liked. */
  approved?: boolean;
  notes?: string | null;
  type?: DesignAssetType;
}

export function updateDesignAsset(
  id: string,
  patch: AssetPatch,
): Promise<DesignAsset> {
  return designRequest(
    `/api/designs/assets/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    (value) => DesignAssetResponseSchema.safeParse(value),
  ).then((response) => response.asset);
}

export function deleteDesignAsset(id: string): Promise<unknown> {
  return designRequest(`/api/designs/assets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface CreateBoardInput {
  name: string;
  description?: string;
  project?: string;
}

export function createDesignBoard(input: CreateBoardInput): Promise<DesignBoard> {
  return designRequest(
    "/api/designs/boards",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => DesignBoardResponseSchema.safeParse(value),
  ).then((response) => response.board);
}

export interface BoardPatch {
  name?: string;
  description?: string | null;
  project?: string | null;
  notes?: string | null;
}

export function updateDesignBoard(
  id: string,
  patch: BoardPatch,
): Promise<DesignBoard> {
  return designRequest(
    `/api/designs/boards/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    (value) => DesignBoardResponseSchema.safeParse(value),
  ).then((response) => response.board);
}

export function deleteDesignBoard(id: string): Promise<unknown> {
  return designRequest(`/api/designs/boards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Adds or removes one asset. Boards hold ids; an asset is never copied. */
export function setDesignBoardMembership(
  boardId: string,
  assetId: string,
  member: boolean,
): Promise<DesignBoard> {
  return designRequest(
    `/api/designs/boards/${encodeURIComponent(boardId)}/assets/${encodeURIComponent(assetId)}`,
    { method: member ? "PUT" : "DELETE" },
    (value) => DesignBoardResponseSchema.safeParse(value),
  ).then((response) => response.board);
}

/**
 * The workers this build has, and whether each can be used.
 *
 * Declared-but-unbuilt workers are listed too — the screen says why they cannot
 * be used rather than pretending they do not exist.
 */
export function getWorkers(): Promise<WorkersResponse> {
  return readVault("/api/workers", (value) =>
    WorkersResponseSchema.safeParse(value),
  );
}

export function getWorkerJobs(): Promise<{ jobs: WorkerJob[] }> {
  return readVault("/api/worker-jobs", (value) =>
    WorkerJobsResponseSchema.safeParse(value),
  );
}

export function getWorkerJob(id: string): Promise<{ job: WorkerJob }> {
  return readVault(
    `/api/worker-jobs/${encodeURIComponent(id)}`,
    (value) => WorkerJobResponseSchema.safeParse(value),
    "There is no job with that id.",
  );
}

/** A finished job's recorded events, for a screen opened after the fact. */
export function getWorkerJobEvents(id: string) {
  return readVault(
    `/api/worker-jobs/${encodeURIComponent(id)}/events`,
    (value) => WorkerJobEventsResponseSchema.safeParse(value),
  );
}

/** Shared failure handling for the worker layer's write calls. */
async function workerRequest<T>(
  path: string,
  init: RequestInit,
  parse?: (value: unknown) => { success: true; data: T } | { success: false },
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(
      failure?.error ?? "The job could not be started.",
      response.status,
    );
  }

  if (!parse) return payload as T;

  const result = parse(payload);

  if (!result.success) {
    throw new AgentOSRequestError("The worker layer returned an unexpected job.");
  }

  return result.data;
}

/** Whether concepts can be generated at all, and why not when they cannot. */
export function getGenerationCapability(): Promise<GenerationCapabilityResponse> {
  return workerRequest(
    "/api/designs/generation-capability",
    { method: "GET" },
    (value) => GenerationCapabilityResponseSchema.safeParse(value),
  );
}

/** Generates concepts. Blocks until the renderer is finished. */
export function generateDesigns(
  request: DesignGenerationRequest,
): Promise<DesignGeneration> {
  return workerRequest(
    "/api/designs/generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    (value) => DesignGenerationResponseSchema.safeParse(value),
  ).then((response) => response.generation);
}

/** Past generations, newest first. */
export function getDesignGenerations(
  project?: string,
): Promise<DesignGenerationsResponse> {
  return workerRequest(
    project
      ? `/api/designs/generations?project=${encodeURIComponent(project)}`
      : "/api/designs/generations",
    { method: "GET" },
    (value) => DesignGenerationsResponseSchema.safeParse(value),
  );
}

/**
 * Starts a visual design review.
 *
 * Returns as soon as the Hermes run is submitted — the review comes back
 * pending, with the run to follow for progress.
 */
export function startDesignReview(
  request: DesignReviewRequest,
): Promise<DesignReview> {
  return workerRequest(
    "/api/designs/review",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    (value) => DesignReviewResponseSchema.safeParse(value),
  ).then((response) => response.review);
}

/** Reads a finished run into its review. Safe to call more than once. */
export function finaliseDesignReview(id: string): Promise<DesignReview> {
  return workerRequest(
    `/api/designs/reviews/${encodeURIComponent(id)}/finalise`,
    { method: "POST" },
    (value) => DesignReviewResponseSchema.safeParse(value),
  ).then((response) => response.review);
}

/** Past reviews, newest first. */
export function getDesignReviews(
  project?: string,
): Promise<DesignReviewsResponse> {
  return workerRequest(
    project
      ? `/api/designs/reviews?project=${encodeURIComponent(project)}`
      : "/api/designs/reviews",
    { method: "GET" },
    (value) => DesignReviewsResponseSchema.safeParse(value),
  );
}

/** Drafts a brief from a review. Proposes a file; writes nothing. */
export function proposeDesignBrief(
  reviewId: string,
  feature: string,
): Promise<DesignBriefProposal> {
  return workerRequest(
    `/api/designs/reviews/${encodeURIComponent(reviewId)}/brief`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature }),
    },
    (value) => DesignBriefProposalResponseSchema.safeParse(value),
  ).then((response) => response.proposal);
}

/** Writes an approved brief into the project. */
export function saveDesignBrief(
  proposal: DesignBriefProposal,
): Promise<unknown> {
  return workerRequest("/api/designs/briefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proposal),
  });
}

/**
 * Scopes one project task and recommends a worker.
 *
 * Prepares; does not start. The plan comes back to be read.
 */
export function prepareTaskDelegation(
  slug: string,
  taskId: string,
  requestedWorker: WorkerJobRequest["worker"],
): Promise<TaskDelegationPreview> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/delegate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedWorker }),
    },
    (value) => TaskDelegationPreviewSchema.safeParse(value),
  );
}

/** Starts the work, from a plan the operator has approved. */
export function startTaskDelegation(
  slug: string,
  taskId: string,
  approval: TaskDelegationApproval,
): Promise<WorkerJob> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(approval),
    },
    (value) => WorkerJobResponseSchema.safeParse(value),
  ).then((response) => response.job);
}

/**
 * Scopes every eligible task in a milestone and recommends a worker for each.
 *
 * Same shape as `prepareTaskDelegation`, just over the whole milestone at
 * once: prepares, does not start. Every plan comes back to be read together.
 */
export function prepareMilestoneDelegation(
  slug: string,
  milestoneId: string,
  requestedWorker: WorkerJobRequest["worker"],
): Promise<MilestoneDelegationPreview> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(milestoneId)}/delegate/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedWorker }),
    },
    (value) => MilestoneDelegationPreviewSchema.safeParse(value),
  );
}

/** Starts every task the operator approved out of a prepared milestone batch. */
export function startMilestoneDelegation(
  slug: string,
  milestoneId: string,
  tasks: MilestoneTaskApproval[],
): Promise<MilestoneDelegationResult> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(milestoneId)}/delegate/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks }),
    },
    (value) => MilestoneDelegationResultSchema.safeParse(value),
  );
}

/** What has been delegated in this project, and where each job has got to. */
export function getTaskDelegations(
  slug: string,
): Promise<TaskDelegationsResponse> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/task-delegations`,
    { method: "GET" },
    (value) => TaskDelegationsResponseSchema.safeParse(value),
  );
}

/** Whether a task can be closed, and the exact line closing it would change. */
export function getTaskCompletion(
  slug: string,
  taskId: string,
): Promise<{ proposal: TaskCompletionProposal }> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/completion`,
    { method: "GET" },
    (value) =>
      z.object({ proposal: TaskCompletionProposalSchema }).safeParse(value),
  );
}

/** Ticks a task off in `TASKS.md`. The only write AgentOS makes to the vault. */
export function completeTask(slug: string, taskId: string): Promise<unknown> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/complete`,
    { method: "POST" },
  );
}

/**
 * Asks who should take a job, without starting anything.
 *
 * A recommendation and the evidence behind it. Nothing is delegated until the
 * operator says so, which is why this is its own call rather than a step
 * inside starting a job.
 */
export function routeWorkerJob(
  request: WorkerRoutingRequest,
): Promise<WorkerRoutingResponse> {
  return workerRequest(
    "/api/worker-routing",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    (value) => WorkerRoutingResponseSchema.safeParse(value),
  );
}

/** Ollama connection, discovered models and their routing configuration. */
export function getOllamaStatus(): Promise<OllamaStatusResponse> {
  return workerRequest("/api/route-policy/ollama", { method: "GET" }, (value) =>
    OllamaStatusResponseSchema.safeParse(value),
  );
}

/** Runs the suitability test for one installed model. Can take up to a minute or two. */
export function probeOllamaModel(input: ProbeRequest): Promise<ProbeResult> {
  return workerRequest(
    "/api/route-policy/ollama/probe",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => ProbeResponseSchema.safeParse(value),
  ).then((response) => response.result);
}

export function saveOllamaSettings(settings: OllamaSettings): Promise<unknown> {
  return workerRequest("/api/route-policy/ollama", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

/** Every execution option and whether it is usable, for the manual override. */
export function getExecutionOptions(): Promise<ExecutionOptionsResponse> {
  return workerRequest("/api/route-policy/options", { method: "GET" }, (value) =>
    ExecutionOptionsResponseSchema.safeParse(value),
  );
}

export type RoutePreviewInput = Pick<
  WorkerJobRequest,
  | "project"
  | "objective"
  | "inputText"
  | "repoPath"
  | "expectedOutput"
  | "routingMode"
  | "manualOptionId"
  | "routingHints"
>;

/** The routing decision for a task, before anything is dispatched. */
export function previewRoute(input: RoutePreviewInput): Promise<RoutePreviewResponse> {
  return workerRequest(
    "/api/route-policy/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => RoutePreviewResponseSchema.safeParse(value),
  );
}

/** Delegates one scoped job. The work itself is asynchronous. */
export function startWorkerJob(request: WorkerJobRequest): Promise<WorkerJob> {
  return workerRequest(
    "/api/worker-jobs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    (value) => WorkerJobResponseSchema.safeParse(value),
  ).then((response) => response.job);
}

export function cancelWorkerJob(id: string): Promise<unknown> {
  return workerRequest(`/api/worker-jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}

export function steerWorkerJob(
  id: string,
  instruction: string,
): Promise<unknown> {
  return workerRequest(`/api/worker-jobs/${encodeURIComponent(id)}/steer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction }),
  });
}

/**
 * Has Hermes review a finished job.
 *
 * Slow by nature — it is one model call over a diff — so the console shows it
 * working rather than pretending it is instant.
 */
export function reviewWorkerJob(id: string): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/review`,
    { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

/** The diff, read from git in the job's worktree. */
export function getWorkerJobDiff(id: string): Promise<{ diff: WorkerDiff }> {
  return readVault(
    `/api/worker-jobs/${encodeURIComponent(id)}/diff`,
    (value) => z.object({ diff: WorkerDiffSchema }).safeParse(value),
    "That job has no diff to show.",
  );
}

/**
 * Whether this job could be integrated right now, and what is stopping it.
 *
 * `details` carries each blocker with the cure that would resolve it. It is
 * optional so an older adapter still parses, and the panel falls back to
 * prose-only blockers when it is missing.
 */
export function getWorkerJobIntegration(id: string): Promise<{
  ready: boolean;
  blockers: string[];
  details?: IntegrationBlocker[];
}> {
  return readVault(
    `/api/worker-jobs/${encodeURIComponent(id)}/integration`,
    (value) =>
      z
        .object({
          ready: z.boolean(),
          blockers: z.array(z.string()),
          details: z.array(IntegrationBlockerSchema).optional(),
        })
        .safeParse(value),
  );
}

/**
 * What the implementation looked like, and what Hermes made of it.
 *
 * Every revision comes back, not just the current one: the question a person
 * asks after sending work back is whether the revision actually fixed it, and
 * that is a comparison rather than a reading.
 */
export function getWorkerJobVisual(
  id: string,
): Promise<VisualVerificationResponse> {
  return readVault(
    `/api/worker-jobs/${encodeURIComponent(id)}/visual`,
    (value) => VisualVerificationResponseSchema.safeParse(value),
    "That job has no visual verification.",
  );
}

/**
 * Where one captured screenshot is served from.
 *
 * A path rather than a fetch: these go straight into `img src`, and the
 * adapter is the only thing that knows which file a name refers to.
 */
export function workerScreenshotUrl(
  id: string,
  revision: number,
  filename: string,
): string {
  return `/api/worker-jobs/${encodeURIComponent(id)}/visual/${revision}/${encodeURIComponent(filename)}`;
}

/**
 * Runs the implementation and photographs it again.
 *
 * Slow — it installs, starts a dev server, drives a browser and then asks
 * Hermes — so the console shows it working rather than pretending otherwise.
 */
export function verifyWorkerJobVisually(
  id: string,
): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/visual`,
    { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

/** Sends the visual findings back to the worker, in the same worktree. */
export function requestWorkerVisualRevision(
  id: string,
): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/visual-revision`,
    { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

/** Sends the review's findings back to the worker, in the same worktree. */
export function reviseWorkerJob(id: string): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/revise`,
    { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

/** Approves the work and integrates it. The one call that touches the repo. */
export function approveWorkerJob(id: string): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/approve`,
    { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

export function rejectWorkerJob(
  id: string,
  reason?: string,
): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

/** Throws away a settled job's checkout. Deliberately its own decision. */
export function discardWorkerWorktree(id: string): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/worktree`,
    { method: "DELETE" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

/** Same-origin SSE URL: recorded events replay first, then live ones follow. */
export function workerJobEventsUrl(id: string): string {
  return `/api/worker-jobs/${encodeURIComponent(id)}/events`;
}

/** Hermes configuration state. Reads local config only; never contacts Hermes. */
export function getAgentStatus(): Promise<AgentStatus> {
  return readVault("/api/agent/status", (value) =>
    AgentStatusSchema.safeParse(value),
  );
}

/**
 * Sends one message to Hermes through the local adapter.
 *
 * The adapter holds the API key; this call carries only the message and the
 * project it belongs to.
 */
export async function sendAgentMessage(
  request: AgentRequest,
): Promise<AgentResponse> {
  let response: Response;

  try {
    response = await fetch("/api/agent/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new AgentRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
      "offline",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string; reason?: string } | null;
    const reason = AgentFailureReasonSchema.safeParse(failure?.reason);

    throw new AgentRequestError(
      failure?.error ?? "Hermes could not be reached.",
      reason.success ? reason.data : "failed",
    );
  }

  const result = AgentResponseSchema.safeParse(payload);

  if (!result.success) {
    throw new AgentRequestError(
      "Hermes returned a reply in an unexpected shape.",
      "failed",
    );
  }

  return result.data;
}

/** What this Hermes build supports. Every feature in the console gates on this. */
export function getAgentCapabilities(): Promise<AgentCapabilities> {
  return readVault("/api/agent/capabilities", (value) =>
    AgentCapabilitiesSchema.safeParse(value),
  );
}

/**
 * The skills this Hermes has.
 *
 * Quick actions and the command palette are built from this rather than a list
 * kept in the frontend, so a skill added to Hermes appears here on reload.
 */
export function getAgentSkills(): Promise<AgentSkillsResponse> {
  return readVault("/api/agent/skills", (value) =>
    AgentSkillsResponseSchema.safeParse(value),
  );
}

/** Shared failure handling for the run endpoints. */
async function agentPost<T>(
  path: string,
  body: unknown,
  parse?: (value: unknown) => { success: true; data: T } | { success: false },
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AgentRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
      "offline",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string; reason?: string } | null;
    const reason = AgentFailureReasonSchema.safeParse(failure?.reason);

    throw new AgentRequestError(
      failure?.error ?? "Hermes could not be reached.",
      reason.success ? reason.data : "failed",
    );
  }

  if (!parse) return payload as T;

  const result = parse(payload);

  if (!result.success) {
    throw new AgentRequestError(
      "Hermes returned a run in an unexpected shape.",
      "failed",
    );
  }

  return result.data;
}

export interface StartRunRequest {
  message: string;
  project?: string;
  sessionId?: string;
}

export function startAgentRun(request: StartRunRequest): Promise<AgentRun> {
  return agentPost("/api/agent/runs", request, (value) =>
    AgentRunSchema.safeParse(value),
  );
}

export function stopAgentRun(runId: string): Promise<AgentRun> {
  return agentPost(
    `/api/agent/runs/${encodeURIComponent(runId)}/stop`,
    {},
    (value) => AgentRunSchema.safeParse(value),
  );
}

export function steerAgentRun(runId: string, message: string): Promise<unknown> {
  return agentPost(`/api/agent/runs/${encodeURIComponent(runId)}/steer`, {
    message,
  });
}

/**
 * Records a decision on a pending approval.
 *
 * This is the only call in the console that can lead to a write, and it writes
 * nothing itself: Hermes acts, the adapter stays read-only. It resolves only
 * once Hermes has acknowledged the decision, so a failure is never mistaken for
 * an approval.
 */
export function respondToAgentApproval(
  runId: string,
  requestId: string,
  decision: ApprovalDecision,
): Promise<ApprovalResponse> {
  return agentPost(
    `/api/agent/runs/${encodeURIComponent(runId)}/approval`,
    { requestId, decision },
    (value) => ApprovalResponseSchema.safeParse(value),
  );
}

/** Same-origin SSE URL. The adapter attaches the bearer token upstream. */
export function agentRunEventsUrl(runId: string): string {
  return `/api/agent/runs/${encodeURIComponent(runId)}/events`;
}

/** Query string for a project lane. Omitted for the general lane. */
function laneQuery(project?: string): string {
  return project ? `?project=${encodeURIComponent(project)}` : "";
}

/** The active Hermes session for a project, created on first use. */
export function getAgentSession(project?: string): Promise<AgentSession> {
  return readVault(`/api/agent/session${laneQuery(project)}`, (value) =>
    AgentSessionSchema.safeParse(value),
  );
}

/** The canonical transcript, owned by Hermes — never reconstructed locally. */
export function getAgentSessionMessages(
  project?: string,
): Promise<AgentSessionMessages> {
  return readVault(
    `/api/agent/session/messages${laneQuery(project)}`,
    (value) => AgentSessionMessagesSchema.safeParse(value),
  );
}

export function listAgentSessions(): Promise<AgentSessionList> {
  return readVault("/api/agent/sessions", (value) =>
    AgentSessionListSchema.safeParse(value),
  );
}

/** Starts a fresh session for the project. The previous one is kept. */
export function startNewAgentSession(project?: string): Promise<AgentSession> {
  return agentPost("/api/agent/session/new", { project }, (value) =>
    AgentSessionSchema.safeParse(value),
  );
}

export function forkAgentSession(project?: string): Promise<AgentSession> {
  return agentPost("/api/agent/session/fork", { project }, (value) =>
    AgentSessionSchema.safeParse(value),
  );
}

/**
 * The validation sprint.
 *
 * Four calls, and none of them touch the pipeline. The sprint measures AgentOS
 * from beside it: it can read what happened and record what a person noticed,
 * and it has no way to start, route, review or integrate anything.
 */
export function getValidationSprint(): Promise<ValidationSprint> {
  return workerRequest("/api/validation", { method: "GET" }, (value) =>
    ValidationSprintSchema.safeParse(value),
  );
}

export function startValidationTask(
  input: StartValidationTask,
): Promise<ValidationTask> {
  return workerRequest(
    "/api/validation/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => ValidationTaskResponseSchema.safeParse(value),
  ).then((response) => response.task);
}

export function updateValidationTask(
  id: string,
  input: UpdateValidationTask,
): Promise<ValidationTask> {
  return workerRequest(
    `/api/validation/tasks/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => ValidationTaskResponseSchema.safeParse(value),
  ).then((response) => response.task);
}

/** Files one friction report. The note is sent as written and never parsed. */
export function reportFriction(
  input: ReportFriction,
): Promise<ValidationFriction> {
  return workerRequest(
    "/api/validation/friction",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    (value) => ValidationFrictionResponseSchema.safeParse(value),
  ).then((response) => response.friction);
}

/**
 * Operations.
 *
 * Reads only. Nothing on this surface can start work, and the two writes it
 * does have — a subscription and a budget — are records of what the operator
 * already pays and already decided, not instructions to any agent. One range
 * at a time; money committed monthly reads the calendar month regardless.
 */
export function getOperations(range: UsageRange = "month"): Promise<OperationsData> {
  return workerRequest(`/api/operations?range=${range}`, { method: "GET" }, (value) =>
    OperationsDataSchema.safeParse(value),
  );
}

export function getUsageSummary(): Promise<UsageSummary> {
  return workerRequest("/api/usage/summary", { method: "GET" }, (value) =>
    UsageSummarySchema.safeParse(value),
  );
}

export function getAgentDetail(id: string): Promise<AgentDetail> {
  return workerRequest(
    `/api/operations/agents/${encodeURIComponent(id)}`,
    { method: "GET" },
    (value) => AgentDetailResponseSchema.safeParse(value),
  ).then((response) => response.agent);
}

export function getTaskUsage(taskId: string): Promise<TaskUsage> {
  return workerRequest(
    `/api/usage/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET" },
    (value) => TaskUsageResponseSchema.safeParse(value),
  ).then((response) => response.task);
}

export function getSubscriptions(): Promise<SubscriptionsResponse> {
  return workerRequest("/api/subscriptions", { method: "GET" }, (value) =>
    SubscriptionsResponseSchema.safeParse(value),
  );
}

export function saveSubscription(
  subscription: Omit<Subscription, "id"> & { id?: string },
): Promise<void> {
  return workerRequest("/api/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });
}

export function deleteSubscription(id: string): Promise<void> {
  return workerRequest(`/api/subscriptions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getBudgets(): Promise<BudgetsResponse> {
  return workerRequest("/api/budgets", { method: "GET" }, (value) =>
    BudgetsResponseSchema.safeParse(value),
  );
}

export function saveBudget(budget: UsageBudget): Promise<void> {
  return workerRequest("/api/budgets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(budget),
  });
}

/**
 * A write refused because the file moved underneath it.
 *
 * Its own class because it is the one failure the operator can act on: the
 * vault is still edited by hand and written by Hermes, so "someone else changed
 * this" is a normal outcome rather than a bug, and the console has to offer a
 * reload rather than an apology. Carries the current revision so a retry can be
 * composed against the truth.
 */
export class VaultConflictError extends Error {
  readonly code = "revision_conflict";

  constructor(
    message: string,
    readonly path: string | undefined,
    readonly revision: string | undefined,
  ) {
    super(message);
    this.name = "VaultConflictError";
  }
}

/** One workspace mutation, with the conflict case pulled out. */
async function writeVault<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 409) {
    const conflict = payload as
      | { error?: string; path?: string; revision?: string }
      | null;

    throw new VaultConflictError(
      conflict?.error ?? "That file changed since you opened it.",
      conflict?.path,
      conflict?.revision,
    );
  }

  if (!response.ok) {
    const failure = payload as { error?: string } | null;

    throw new AgentOSRequestError(
      failure?.error ?? "That change could not be saved.",
      response.status,
    );
  }

  return payload as T;
}

const asJson = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface TaskRecord {
  id?: string;
  title: string;
  completed: boolean;
  section?: string;
  ready?: boolean;
  after?: string[];
}

export interface EditableTasks {
  revision: string;
  tasks: TaskRecord[];
}

export function getEditableTasks(slug: string): Promise<EditableTasks> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/tasks`,
    { method: "GET" },
  );
}

export interface TaskWrite {
  slug: string;
  expectedRevision?: string;
}

export function createProjectTask(
  input: TaskWrite & { title: string; section?: string },
): Promise<{ taskId: string; revision: string; undoId?: string }> {
  const { slug, ...body } = input;

  return writeVault(`/api/projects/${encodeURIComponent(slug)}/tasks`, {
    method: "POST",
    ...asJson(body),
  });
}

export function patchProjectTask(
  input: TaskWrite & {
    taskId: string;
    title?: string;
    completed?: boolean;
    section?: string;
    position?: number;
    ready?: boolean;
    after?: string[];
    /** Milestone id, or `""` to unassign. Written to MILESTONES.md. */
    milestone?: string;
    milestoneRevision?: string;
  },
): Promise<{ taskId: string; revision?: string; undoId?: string; milestone?: { revision: string; undoId?: string } }> {
  const { slug, taskId, ...body } = input;

  return writeVault(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", ...asJson(body) },
  );
}

export function deleteProjectTask(
  input: TaskWrite & { taskId: string },
): Promise<{ revision: string; undoId?: string }> {
  const query = input.expectedRevision
    ? `?expectedRevision=${encodeURIComponent(input.expectedRevision)}`
    : "";

  return writeVault(
    `/api/projects/${encodeURIComponent(input.slug)}/tasks/${encodeURIComponent(input.taskId)}${query}`,
    { method: "DELETE" },
  );
}

export function reorderProjectTasks(
  input: TaskWrite & { section: string; taskIds: string[] },
): Promise<{ revision: string; undoId?: string }> {
  const { slug, ...body } = input;

  return writeVault(`/api/projects/${encodeURIComponent(slug)}/tasks/reorder`, {
    method: "POST",
    ...asJson(body),
  });
}

export function archiveProjectTask(
  input: TaskWrite & { taskId: string },
): Promise<{ taskId: string; revision: string; undoId?: string }> {
  const { slug, taskId, ...body } = input;

  return writeVault(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/archive`,
    { method: "POST", ...asJson(body) },
  );
}

export function restoreProjectTask(
  input: TaskWrite & { taskId: string; section?: string },
): Promise<{ taskId: string; revision: string; undoId?: string }> {
  const { slug, taskId, ...body } = input;

  return writeVault(
    `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/restore`,
    { method: "POST", ...asJson(body) },
  );
}

export function bulkProjectTasks(
  input: { slug: string } & BulkTaskAction,
): Promise<{ revision: string; undoId?: string; applied: string[]; missing: string[] }> {
  const { slug, ...body } = input;

  return writeVault(`/api/projects/${encodeURIComponent(slug)}/tasks/bulk`, {
    method: "POST",
    ...asJson(body),
  });
}

export function getProjectRoadmap(slug: string): Promise<ProjectRoadmap> {
  return workerRequest(`/api/projects/${encodeURIComponent(slug)}/roadmap`, { method: "GET" }, (value) =>
    ProjectRoadmapSchema.safeParse(value),
  );
}

export function getMilestoneDetail(slug: string, id: string): Promise<MilestoneDetail> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(id)}`,
    { method: "GET" },
    (value) => MilestoneDetailSchema.safeParse(value),
  );
}

export function createProjectMilestone(
  input: { slug: string } & CreateMilestoneRequest,
): Promise<{ milestoneId: string; revision: string; undoId?: string }> {
  const { slug, ...body } = input;
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/milestones`, { method: "POST", ...asJson(body) });
}

export function patchProjectMilestone(
  input: { slug: string; id: string } & PatchMilestoneRequest,
): Promise<{ milestoneId: string; revision: string; undoId?: string }> {
  const { slug, id, ...body } = input;
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    ...asJson(body),
  });
}

export type MilestoneAction = "activate" | "pause" | "resume" | "archive" | "restore";

export function actOnMilestone(input: {
  slug: string;
  id: string;
  action: MilestoneAction;
  expectedRevision?: string;
}): Promise<{ milestoneId: string; revision: string; undoId?: string }> {
  return writeVault(
    `/api/projects/${encodeURIComponent(input.slug)}/milestones/${encodeURIComponent(input.id)}/${input.action}`,
    { method: "POST", ...asJson({ expectedRevision: input.expectedRevision }) },
  );
}

export function completeProjectMilestone(input: {
  slug: string;
  id: string;
  review?: string;
  expectedRevision?: string;
}): Promise<{ milestoneId: string; revision: string; undoId?: string }> {
  const { slug, id, ...body } = input;
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    ...asJson(body),
  });
}

export function deleteProjectMilestone(input: {
  slug: string;
  id: string;
  expectedRevision?: string;
}): Promise<{ revision: string; undoId?: string }> {
  const query = input.expectedRevision ? `?expectedRevision=${encodeURIComponent(input.expectedRevision)}` : "";
  return writeVault(
    `/api/projects/${encodeURIComponent(input.slug)}/milestones/${encodeURIComponent(input.id)}${query}`,
    { method: "DELETE" },
  );
}

export function reorderProjectMilestones(input: {
  slug: string;
  ids: string[];
  expectedRevision?: string;
}): Promise<{ revision: string; undoId?: string }> {
  const { slug, ...body } = input;
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/milestones/reorder`, { method: "POST", ...asJson(body) });
}

export function setMilestoneCriterion(input: {
  slug: string;
  id: string;
  index: number;
  done: boolean;
  expectedRevision?: string;
}): Promise<{ revision: string; undoId?: string }> {
  return writeVault(
    `/api/projects/${encodeURIComponent(input.slug)}/milestones/${encodeURIComponent(input.id)}/criteria/${input.index}`,
    { method: "PUT", ...asJson({ done: input.done, expectedRevision: input.expectedRevision }) },
  );
}

export async function planMilestoneWithHermes(slug: string, id: string): Promise<MilestonePlan> {
  const payload = await writeVault<{ plan: unknown }>(
    `/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(id)}/plan`,
    { method: "POST", ...asJson({}) },
  );
  return MilestonePlanSchema.parse(payload.plan);
}

export function applyMilestonePlan(
  input: { slug: string; id: string } & ApplyMilestonePlanRequest,
): Promise<{ milestoneId: string; revision: string; undoId?: string; createdTaskIds: string[] }> {
  const { slug, id, ...body } = input;
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(id)}/apply-plan`, {
    method: "POST",
    ...asJson(body),
  });
}

export async function draftMilestoneReviewWithHermes(slug: string, id: string): Promise<string> {
  const payload = await writeVault<{ review: string }>(
    `/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(id)}/review-draft`,
    { method: "POST", ...asJson({}) },
  );
  return payload.review;
}

/** A fresh run of a finished job; `worker` hands it to a different worker. */
export function retryWorkerJob(id: string, worker?: string): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/retry`,
    worker
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker }) }
      : { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}

export function getProjectDocuments(slug: string): Promise<ProjectDocuments> {
  return workerRequest(`/api/projects/${encodeURIComponent(slug)}/documents`, { method: "GET" }, (value) =>
    ProjectDocumentsSchema.safeParse(value),
  );
}

export function getProjectDocument(
  slug: string,
  relativePath: string,
  origin: "agentos" | "repo",
): Promise<DocumentContent> {
  const params = new URLSearchParams({ path: relativePath, origin });
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/document?${params.toString()}`,
    { method: "GET" },
    (value) => DocumentContentSchema.safeParse(value),
  );
}

export function createProjectDocument(
  input: { slug: string } & CreateDocumentRequest,
): Promise<{ artifact: ProjectArtifact; revision: string; undoId?: string }> {
  const { slug, ...body } = input;
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/documents`, { method: "POST", ...asJson(body) });
}

export async function proposeProjectDocument(
  slug: string,
  brief: string,
  taskId?: string,
): Promise<DocumentProposal> {
  const payload = await writeVault<{ proposal: unknown }>(
    `/api/projects/${encodeURIComponent(slug)}/documents/propose`,
    { method: "POST", ...asJson({ brief, taskId }) },
  );
  return DocumentProposalSchema.parse(payload.proposal);
}

export function getRecentDocuments(limit = 6): Promise<RecentDocuments> {
  return workerRequest(`/api/documents/recent?limit=${limit}`, { method: "GET" }, (value) =>
    RecentDocumentsSchema.safeParse(value),
  );
}

export function getKnowledge(): Promise<KnowledgeResponse> {
  return workerRequest("/api/knowledge", { method: "GET" }, (value) => KnowledgeResponseSchema.safeParse(value));
}

export function getCaptures(): Promise<CaptureList> {
  return workerRequest("/api/capture", { method: "GET" }, (value) => CaptureListSchema.safeParse(value));
}

/** Appends one line to `inbox/CAPTURE.md`. No model involved. */
export function captureNote(input: { note: string; workspace?: string }): Promise<{ revision: string; undoId?: string; line: string }> {
  return writeVault(`/api/capture`, { method: "POST", ...asJson(input) });
}

export async function getHiggsfieldAccount(): Promise<HiggsfieldAccount> {
  const payload = await workerRequest<{ account: unknown }>("/api/designs/higgsfield", { method: "GET" });
  return HiggsfieldAccountSchema.parse(payload.account);
}

export async function getHiggsfieldModels(): Promise<HiggsfieldModel[]> {
  const payload = await workerRequest("/api/designs/models", { method: "GET" }, (value) =>
    HiggsfieldModelsResponseSchema.safeParse(value),
  );
  return payload.models;
}

/** What a generation would cost, asked before it is run. */
export async function estimateGenerationCost(input: {
  model: string;
  prompt: string;
  count: number;
}): Promise<CostEstimate> {
  const payload = await workerRequest(
    "/api/designs/cost",
    { method: "POST", ...asJson(input) },
    (value) => CostEstimateResponseSchema.safeParse(value),
  );
  return payload.cost;
}

export type NewProject = CreateProjectRequest;

export function createNewProject(
  input: NewProject,
): Promise<{ slug: string; name: string }> {
  return writeVault("/api/projects", { method: "POST", ...asJson(input) });
}

export function patchProjectDetails(
  input: { slug: string } & ProjectPatchRequest,
): Promise<ProjectPatchResponse> {
  const { slug, ...body } = input;

  return writeVault(`/api/projects/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    ...asJson(body),
  });
}

/** What the settings sheet edits, with the two revisions it must be composed against. */
export interface ProjectSettings {
  slug: string;
  name: string;
  type?: string;
  state: string;
  priority: string;
  goal?: string;
  repoPath?: string;
  configuration: ProjectConfiguration;
  revisions: { portfolio: string; project: string };
}

export function getProjectSettings(slug: string): Promise<ProjectSettings> {
  return workerRequest(`/api/projects/${encodeURIComponent(slug)}/settings`, {
    method: "GET",
  });
}

/** Asks Hermes for a project plan. Writes nothing. */
export async function planProjectWithHermes(brief: string): Promise<ProjectPlan> {
  const payload = await writeVault<{ plan: unknown }>("/api/projects/plan", {
    method: "POST",
    ...asJson({ brief }),
  });

  return ProjectPlanSchema.parse(payload.plan);
}

export function searchAgentOS(query: string, limit?: number): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", String(limit));

  return workerRequest(`/api/search?${params.toString()}`, { method: "GET" }, (value) =>
    SearchResponseSchema.safeParse(value),
  );
}

export function archiveProject(slug: string): Promise<{ revision: string }> {
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/archive`, {
    method: "POST",
  });
}

export function restoreProject(
  slug: string,
  state: string,
): Promise<{ revision: string }> {
  return writeVault(`/api/projects/${encodeURIComponent(slug)}/restore`, {
    method: "POST",
    ...asJson({ state }),
  });
}

export type ProseField = "status" | "purpose" | "milestone";

export interface EditableProse {
  status: { revision: string; heading: string; body?: string };
  purpose: { revision: string; heading: string; body?: string };
  milestone: { revision: string; heading: string; body?: string };
}

export function getProjectProse(slug: string): Promise<EditableProse> {
  return workerRequest(`/api/projects/${encodeURIComponent(slug)}/prose`, {
    method: "GET",
  });
}

export function putProjectProse(input: {
  slug: string;
  field: ProseField;
  body: string;
  expectedRevision?: string;
}): Promise<{ revision: string; undoId?: string }> {
  return writeVault(
    `/api/projects/${encodeURIComponent(input.slug)}/prose/${input.field}`,
    {
      method: "PUT",
      ...asJson({ body: input.body, expectedRevision: input.expectedRevision }),
    },
  );
}

export interface EditableDecision {
  title: string;
  body: string;
  decidedOn?: string;
}

export function getEditableDecisions(
  slug: string,
): Promise<{ revision: string; decisions: EditableDecision[] }> {
  return workerRequest(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
    method: "GET",
  });
}

export function writeProjectDecision(input: {
  slug: string;
  title: string;
  body: string;
  decidedOn?: string;
  expectedRevision?: string;
}): Promise<{ revision: string; undoId?: string }> {
  const { slug, ...body } = input;

  return writeVault(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
    method: "POST",
    ...asJson(body),
  });
}

export function deleteProjectDecision(input: {
  slug: string;
  title: string;
}): Promise<{ revision: string; undoId?: string }> {
  return writeVault(
    `/api/projects/${encodeURIComponent(input.slug)}/decisions/${encodeURIComponent(input.title)}`,
    { method: "DELETE" },
  );
}

export function getProjectSource(
  slug: string,
  file: string,
): Promise<{ revision: string; contents?: string }> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/source/${encodeURIComponent(file)}`,
    { method: "GET" },
  );
}

export interface BackupRecord {
  id: string;
  path: string;
  takenAt: string;
  label: string;
}

export function getBackups(): Promise<{ backups: BackupRecord[] }> {
  return workerRequest("/api/backups", { method: "GET" });
}

export function undoEdit(id: string): Promise<{ revision: string }> {
  return writeVault(`/api/backups/${encodeURIComponent(id)}/restore`, {
    method: "POST",
  });
}

/** A project's repository: branches, working tree, commits, job pins. */
export function getRepositoryStatus(slug: string): Promise<RepositoryStatus> {
  return workerRequest(
    `/api/projects/${encodeURIComponent(slug)}/repository`,
    { method: "GET" },
    (value) => RepositoryStatusSchema.safeParse(value),
  );
}

/**
 * Runs one repository action.
 *
 * A refusal comes back as 409 with a real body, and is returned rather than
 * thrown: "there are uncommitted changes" is an answer the operator acts on,
 * not a failure. Only a transport or server fault throws.
 */
export async function runRepositoryAction(
  slug: string,
  action: RepositoryAction,
): Promise<RepositoryActionResult> {
  let response: Response;

  try {
    response = await fetch(
      `/api/projects/${encodeURIComponent(slug)}/repository/action`,
      { method: "POST", ...asJson(action) },
    );
  } catch {
    throw new AgentOSRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 409) {
    const refusal = RepositoryActionResultSchema.safeParse(payload);
    if (refusal.success) return refusal.data;
  }

  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(
      failure?.error ?? "That action could not be run.",
      response.status,
    );
  }

  const parsed = RepositoryActionResultSchema.safeParse(payload);

  if (!parsed.success) {
    throw new AgentOSRequestError("The repository returned an unexpected result.");
  }

  return parsed.data;
}

/** Re-runs a finished job's validation commands in its own worktree. */
export function validateWorkerJob(id: string): Promise<{ job: WorkerJob }> {
  return workerRequest(
    `/api/worker-jobs/${encodeURIComponent(id)}/validate`,
    { method: "POST" },
    (value) => WorkerJobResponseSchema.safeParse(value),
  );
}
