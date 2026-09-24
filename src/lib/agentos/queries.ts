import { useCallback } from "react";
import {
  getValidationSprint,
  reportFriction,
  startValidationTask,
  updateValidationTask,
} from "./client";
import {
  actOnMilestone,
  applyMilestonePlan,
  completeProjectMilestone,
  createProjectMilestone,
  deleteProjectMilestone,
  draftMilestoneReviewWithHermes,
  getMilestoneDetail,
  getProjectRoadmap,
  patchProjectMilestone,
  planMilestoneWithHermes,
  reorderProjectMilestones,
  setMilestoneCriterion,
  type MilestoneAction,
} from "./client";
import { retryWorkerJob } from "./client";
import { disconnectMail, getMail, getMailStatus, getMailThreadBody, removeMailThread, syncMail } from "./client";
import {
  createTaskFromSeoFinding,
  getProjectSeo,
  getProjectVercelInfo,
  getVercelProjects,
  runProjectSeoAudit,
} from "./client";
import {
  createProjectDocument,
  getProjectDocument,
  getProjectDocuments,
  getRepositoryStatus,
  runRepositoryAction,
  validateWorkerJob,
  getRecentDocuments,
  proposeProjectDocument,
} from "./client";
import type { CreateDocumentRequest } from "@shared/agentos-types";
import {
  estimateGenerationCost,
  getHiggsfieldAccount,
  getHiggsfieldModels,
} from "./client";
import type {
  ApplyMilestonePlanRequest,
  CreateMilestoneRequest,
  PatchMilestoneRequest,
} from "@shared/agentos-types";
import {
  archiveProject,
  archiveProjectTask,
  bulkProjectTasks,
  createNewProject,
  createProjectTask,
  deleteProjectDecision,
  deleteProjectTask,
  getBackups,
  getEditableDecisions,
  getEditableTasks,
  getProjectProse,
  getProjectSettings,
  getProjectSource,
  patchProjectDetails,
  patchProjectTask,
  planProjectWithHermes,
  putProjectProse,
  reorderProjectTasks,
  restoreProject,
  restoreProjectTask,
  searchAgentOS,
  undoEdit,
  writeProjectDecision,
  type NewProject,
  type ProseField,
} from "./client";
import type { BulkTaskAction, ProjectPatchRequest } from "@shared/agentos-types";
import {
  deleteSubscription,
  getAgentDetail,
  getBudgets,
  getOperations,
  getSubscriptions,
  getTaskUsage,
  getUsageSummary,
  saveBudget,
  saveSubscription,
} from "./client";
import type {
  Subscription,
  UsageBudget,
} from "@shared/usage-types";
import type { RepositoryAction } from "@shared/repository-types";
import type {
  ReportFriction,
  StartValidationTask,
  UpdateValidationTask,
} from "@shared/validation-sprint-types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  forkAgentSession,
  getAgentCapabilities,
  getAgentSession,
  getAgentSessionMessages,
  getAgentSkills,
  getAgentStatus,
  listAgentSessions,
  startNewAgentSession,
  createDesignBoard,
  deleteDesignAsset,
  deleteDesignBoard,
  getActivity,
  getAutomation,
  getAutomations,
  getDesignLibrary,
  setDesignBoardMembership,
  updateDesignAsset,
  updateDesignBoard,
  uploadDesignAsset,
  cancelWorkerJob,
  getWorkerJob,
  getWorkerJobs,
  getWorkers,
  completeTask,
  finaliseDesignReview,
  generateDesigns,
  getDesignGenerations,
  getGenerationCapability,
  getDesignReviews,
  proposeDesignBrief,
  saveDesignBrief,
  startDesignReview,
  getTaskCompletion,
  getTaskDelegations,
  prepareMilestoneDelegation,
  prepareTaskDelegation,
  routeWorkerJob,
  startMilestoneDelegation,
  startTaskDelegation,
  startWorkerJob,
  steerWorkerJob,
  type ActivityQuery,
  type AssetPatch,
  type BoardPatch,
  type CreateBoardInput,
  type UploadAssetOptions,
  getDashboard,
  getMissionControl,
  getProject,
  getProjects,
  sendAgentMessage,
  approveWorkerJob,
  discardWorkerWorktree,
  getWorkerJobDiff,
  getWorkerJobIntegration,
  rejectWorkerJob,
  reviewWorkerJob,
  reviseWorkerJob,
  getWorkerJobVisual,
  requestWorkerVisualRevision,
  verifyWorkerJobVisually,
} from "./client";
import type { WorkerJobRequest, WorkerJobStatus } from "@shared/worker-types";
import type { MilestoneTaskApproval, TaskDelegationApproval } from "@shared/delegation-types";

/** Query keys for AgentOS vault reads. */
export const agentosKeys = {
  all: ["agentos"] as const,
  dashboard: () => [...agentosKeys.all, "dashboard"] as const,
  mail: () => [...agentosKeys.all, "mail"] as const,
  mailStatus: () => [...agentosKeys.all, "mail-status"] as const,
  mailBody: (threadId: string) => [...agentosKeys.all, "mail-body", threadId] as const,
  vercelProjects: () => [...agentosKeys.all, "vercel-projects"] as const,
  projectVercel: (slug: string) => [...agentosKeys.all, "project-vercel", slug] as const,
  seo: (slug: string) => [...agentosKeys.all, "seo", slug] as const,
  missionControl: () => [...agentosKeys.all, "mission-control"] as const,
  projects: () => [...agentosKeys.all, "projects"] as const,
  project: (slug: string) => [...agentosKeys.all, "project", slug] as const,
  automations: () => [...agentosKeys.all, "automations"] as const,
  activity: (query: ActivityQuery) =>
    [...agentosKeys.all, "activity", query] as const,
  designs: () => [...agentosKeys.all, "designs"] as const,
  designGenerations: (project?: string) =>
    [...agentosKeys.all, "design-generations", project ?? "all"] as const,
  generationCapability: () =>
    [...agentosKeys.all, "generation-capability"] as const,
  designReviews: (project?: string) =>
    [...agentosKeys.all, "design-reviews", project ?? "all"] as const,
  workers: () => [...agentosKeys.all, "workers"] as const,
  workerJobs: () => [...agentosKeys.all, "worker-jobs"] as const,
  taskDelegations: (slug: string) =>
    [...agentosKeys.all, "task-delegations", slug] as const,
  taskCompletion: (slug: string, taskId: string) =>
    [...agentosKeys.all, "task-completion", slug, taskId] as const,
  workerJob: (id: string) => [...agentosKeys.all, "worker-job", id] as const,
  automation: (id: string) => [...agentosKeys.all, "automation", id] as const,
  agentStatus: () => [...agentosKeys.all, "agent", "status"] as const,
  agentCapabilities: () => [...agentosKeys.all, "agent", "capabilities"] as const,
  agentSkills: () => [...agentosKeys.all, "agent", "skills"] as const,
  agentSession: (project?: string) =>
    [...agentosKeys.all, "agent", "session", project ?? "general"] as const,
  agentMessages: (project?: string) =>
    [...agentosKeys.all, "agent", "messages", project ?? "general"] as const,
  agentSessions: () => [...agentosKeys.all, "agent", "sessions"] as const,
  validation: () => [...agentosKeys.all, "validation"] as const,
  operations: () => [...agentosKeys.all, "operations"] as const,
  usageSummary: () => [...agentosKeys.all, "usage-summary"] as const,
  agentDetail: (id: string) => [...agentosKeys.all, "agent-detail", id] as const,
  taskUsage: (taskId: string) => [...agentosKeys.all, "task-usage", taskId] as const,
  subscriptions: () => [...agentosKeys.all, "subscriptions"] as const,
  budgets: () => [...agentosKeys.all, "budgets"] as const,
  editableTasks: (slug: string) =>
    [...agentosKeys.all, "editable-tasks", slug] as const,
  projectProse: (slug: string) =>
    [...agentosKeys.all, "project-prose", slug] as const,
  editableDecisions: (slug: string) =>
    [...agentosKeys.all, "editable-decisions", slug] as const,
  projectSource: (slug: string, file: string) =>
    [...agentosKeys.all, "project-source", slug, file] as const,
  backups: () => [...agentosKeys.all, "backups"] as const,
  projectSettings: (slug: string) =>
    [...agentosKeys.all, "project-settings", slug] as const,
  search: (query: string) => [...agentosKeys.all, "search", query] as const,
  roadmap: (slug: string) => [...agentosKeys.all, "roadmap", slug] as const,
  documents: (slug: string) => [...agentosKeys.all, "documents", slug] as const,
  repository: (slug: string) => [...agentosKeys.all, "repository", slug] as const,
  document: (slug: string, path: string, origin: string) =>
    [...agentosKeys.all, "document", slug, origin, path] as const,
  recentDocuments: () => [...agentosKeys.all, "documents", "recent"] as const,
  higgsfield: () => [...agentosKeys.all, "higgsfield"] as const,
  higgsfieldModels: () => [...agentosKeys.all, "higgsfield", "models"] as const,
  generationCost: (model: string, prompt: string, count: number) =>
    [...agentosKeys.all, "higgsfield", "cost", model, prompt, count] as const,
  milestone: (slug: string, id: string) => [...agentosKeys.all, "milestone", slug, id] as const,
};

/**
 * Reads dashboard state from the local adapter.
 *
 * A local filesystem read is cheap, but it is still a read: a 30s stale window
 * keeps navigation between screens from re-reading the vault every time.
 */
/**
 * Mission Control, polled.
 *
 * Ten seconds, and no SSE. A page that aggregates five subsystems does not need
 * five permanent streams to be useful — the live detail lives on each job's and
 * run's own screen, where a stream already exists. This only has to be right
 * within a few seconds of now.
 *
 * `refetchInterval` pauses in a background tab by default, which is the correct
 * behaviour: nobody is reading it.
 */
export function useMissionControl() {
  return useQuery({
    queryKey: agentosKeys.missionControl(),
    queryFn: getMissionControl,
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * How many decisions are waiting, for the sidebar badge.
 *
 * Shares one cache entry with the Mission Control screen, so every screen in
 * the app showing the badge costs a single poll between them. The count is
 * things requiring a person — never a notification count, and never something
 * that goes up because a machine did some work.
 */
export function useAttentionCount(): number {
  const { data } = useMissionControl();
  return data?.attention.length ?? 0;
}

export function useDashboard() {
  return useQuery({
    queryKey: agentosKeys.dashboard(),
    queryFn: getDashboard,
    staleTime: 30_000,
    retry: 1,
    // Loopback read: never gate it on internet connectivity.
    networkMode: "always",
  });
}

/** Mail's stored, bucketed state. Cheap and safe to poll — never a Gmail/Jev call. */
export function useMailStatus() {
  return useQuery({
    queryKey: agentosKeys.mailStatus(),
    queryFn: getMailStatus,
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useMail() {
  return useQuery({
    queryKey: agentosKeys.mail(),
    queryFn: getMail,
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

/** A thread's full body — only fetched once the row is actually expanded. */
export function useMailThreadBody(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: agentosKeys.mailBody(threadId),
    queryFn: () => getMailThreadBody(threadId),
    enabled,
    staleTime: 60_000,
    retry: 1,
    networkMode: "always",
  });
}

/** The only thing that ever triggers a live Gmail + Jev call. */
export function useSyncMail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncMail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mail() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mailStatus() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useDisconnectMail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectMail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mailStatus() });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Every Vercel project the configured token can see, for the "connect a project" picker. Rarely changes. */
export function useVercelProjects() {
  return useQuery({
    queryKey: agentosKeys.vercelProjects(),
    queryFn: getVercelProjects,
    staleTime: 60_000,
    retry: 0,
    networkMode: "always",
  });
}

/** A linked project's live URL, domains, and recent deployments. Not fetched until the project is actually linked. */
export function useProjectVercelInfo(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: agentosKeys.projectVercel(slug),
    queryFn: () => getProjectVercelInfo(slug),
    enabled,
    staleTime: 30_000,
    retry: 0,
    networkMode: "always",
  });
}

/** The SEO tab's stored state. Never crawls on its own — only `useRunSeoAudit` does. */
export function useProjectSeo(slug: string) {
  return useQuery({
    queryKey: agentosKeys.seo(slug),
    queryFn: () => getProjectSeo(slug),
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

/** The only call in the SEO feature that crawls the live site. */
export function useRunSeoAudit(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targetUrl?: string) => runProjectSeoAudit({ slug, targetUrl }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.seo(slug) });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Files one SEO finding as a task on the project's board. */
export function useFileSeoFindingTask(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (findingId: string) => createTaskFromSeoFinding({ slug, findingId }),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: agentosKeys.seo(slug) });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Hides one thread from the Mail view. Local only — never touches the Gmail message. */
export function useRemoveMailThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeMailThread,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mail() });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Reads the whole project portfolio from the local adapter. */
export function useProjects() {
  return useQuery({
    queryKey: agentosKeys.projects(),
    queryFn: getProjects,
    staleTime: 30_000,
    retry: 1,
    networkMode: "always",
  });
}

/** Reads one project's full detail: tasks, decisions, sessions, and git state. */
export function useProject(slug: string) {
  return useQuery({
    queryKey: agentosKeys.project(slug),
    queryFn: () => getProject(slug),
    enabled: slug.length > 0,
    staleTime: 30_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * The scheduled jobs Hermes runs.
 *
 * Displaying automations costs no model call — the adapter reads Hermes'
 * schedule and reports it. Kept fresher than the vault reads because a run that
 * fires while the screen is open changes what it should say.
 */
export function useAutomations() {
  return useQuery({
    queryKey: agentosKeys.automations(),
    queryFn: getAutomations,
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

/** One automation and its run history. */
export function useAutomation(id: string) {
  return useQuery({
    queryKey: agentosKeys.automation(id),
    queryFn: () => getAutomation(id),
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * The activity timeline.
 *
 * Assembled from state the adapter already reads, so this is cheap and involves
 * no model call. Kept fresh: a run or an automation firing while the screen is
 * open is exactly what it exists to show.
 */
export function useActivity(query: ActivityQuery = {}) {
  return useQuery({
    queryKey: agentosKeys.activity(query),
    queryFn: () => getActivity(query),
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * The design library.
 *
 * One read for every asset and board: the library is personal-scale, and
 * holding it whole is what lets search, filters and boards stay instant. Image
 * bytes are not in here — those load from their own URLs, cached by the browser.
 */
export function useDesignLibrary() {
  return useQuery({
    queryKey: agentosKeys.designs(),
    queryFn: getDesignLibrary,
    staleTime: 30_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * Re-reads the library after a change.
 *
 * Nothing is updated optimistically: the adapter is the only thing that knows
 * what was actually written, and a library that disagrees with disk is worse
 * than one that takes a moment to catch up.
 */
function useLibraryRefresh() {
  const queryClient = useQueryClient();

  return () =>
    queryClient.invalidateQueries({ queryKey: agentosKeys.designs() });
}

export function useUploadDesignAsset() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: ({ file, options }: { file: File; options?: UploadAssetOptions }) =>
      uploadDesignAsset(file, options),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useUpdateDesignAsset() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AssetPatch }) =>
      updateDesignAsset(id, patch),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteDesignAsset() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: (id: string) => deleteDesignAsset(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useCreateDesignBoard() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: (input: CreateBoardInput) => createDesignBoard(input),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useUpdateDesignBoard() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BoardPatch }) =>
      updateDesignBoard(id, patch),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteDesignBoard() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: (id: string) => deleteDesignBoard(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useSetBoardMembership() {
  const refresh = useLibraryRefresh();

  return useMutation({
    mutationFn: ({
      boardId,
      assetId,
      member,
    }: {
      boardId: string;
      assetId: string;
      member: boolean;
    }) => setDesignBoardMembership(boardId, assetId, member),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** The workers this build has. Health is discovered, never assumed. */
export function useWorkers() {
  return useQuery({
    queryKey: agentosKeys.workers(),
    queryFn: getWorkers,
    staleTime: 30_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * Delegated jobs, newest first.
 *
 * Polled while any job is running: a job's own screen streams its events, but
 * the list needs to notice when one finishes.
 */
export function useWorkerJobs() {
  return useQuery({
    queryKey: agentosKeys.workerJobs(),
    queryFn: getWorkerJobs,
    staleTime: 5_000,
    retry: 1,
    networkMode: "always",
    refetchInterval: (query) =>
      (query.state.data?.jobs ?? []).some((job) => IN_FLIGHT.has(job.status))
        ? 2_000
        : false,
  });
}

/**
 * Statuses where something is actually happening.
 *
 * Only these are worth polling for. A job waiting on a person changes when the
 * person acts, and asking every two seconds whether they have yet is just
 * traffic — the mutations invalidate the query themselves.
 */
const IN_FLIGHT = new Set<WorkerJobStatus>([
  "queued",
  "preparing",
  "running",
  "waiting",
  "validating",
  "reviewing",
  "approved",
  "integrating",
]);

export function useWorkerJob(id: string) {
  return useQuery({
    queryKey: agentosKeys.workerJob(id),
    queryFn: () => getWorkerJob(id),
    enabled: id.length > 0,
    staleTime: 5_000,
    retry: 1,
    networkMode: "always",
    refetchInterval: (query) =>
      query.state.data && IN_FLIGHT.has(query.state.data.job.status)
        ? 2_000
        : false,
  });
}

/**
 * Re-reads a job once its stream says it is over.
 *
 * The event stream knows the moment a job ends, so the record is refreshed from
 * that rather than waited for by polling — which also keeps the screen correct
 * in a background tab, where interval refetching is paused.
 */
export function useRefreshWorkerJob() {
  const queryClient = useQueryClient();

  // Stable: this is used as an effect dependency, and a new function every
  // render would make that effect re-run on every render.
  return useCallback(
    (id: string) => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.workerJob(id) });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.workerJobs() });
    },
    [queryClient],
  );
}

function useJobRefresh() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: agentosKeys.workerJobs() });
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[1] === "worker-job",
    });
  };
}

/** Whether concepts can be generated at all. Fails closed. */
export function useGenerationCapability() {
  return useQuery({
    queryKey: agentosKeys.generationCapability(),
    queryFn: getGenerationCapability,
    staleTime: 60_000,
    networkMode: "always",
    retry: 1,
  });
}

/** Past generations, so the history reopens with its results. */
export function useDesignGenerations(project?: string) {
  return useQuery({
    queryKey: agentosKeys.designGenerations(project),
    queryFn: () => getDesignGenerations(project),
    networkMode: "always",
    retry: 1,
  });
}

/**
 * Generates concepts.
 *
 * Long-running and paid, so it never retries on its own: a request that failed
 * halfway must not quietly become two.
 */
export function useGenerateDesigns() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: generateDesigns,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: agentosKeys.designs() });
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[1] === "design-generations",
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Past design reviews.
 *
 * Reopening a board or the library restores what was already analysed, which
 * is the difference between a review being a result and being a moment.
 */
export function useDesignReviews(project?: string) {
  return useQuery({
    queryKey: agentosKeys.designReviews(project),
    queryFn: () => getDesignReviews(project),
    networkMode: "always",
    retry: 1,
  });
}

/** Starts a review. Nothing is analysed until Hermes picks up the run. */
export function useStartDesignReview() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: startDesignReview,
    onSuccess: () => {
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[1] === "design-reviews",
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Reads a finished run into its review. */
export function useFinaliseDesignReview() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: finaliseDesignReview,
    onSuccess: () => {
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[1] === "design-reviews",
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Drafts a brief from a review. Writes nothing. */
export function useProposeDesignBrief() {
  return useMutation({
    mutationFn: ({ reviewId, feature }: { reviewId: string; feature: string }) =>
      proposeDesignBrief(reviewId, feature),
    networkMode: "always",
    retry: 0,
  });
}

/** Writes an approved brief into the project. */
export function useSaveDesignBrief() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveDesignBrief,
    onSuccess: () => {
      // The project's own files changed, so the screen must re-read them.
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[1] === "project",
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * What has been delegated in this project.
 *
 * Polled while anything is still running, so a task row can follow its job
 * without the projects screen subscribing to the worker event stream.
 */
export function useTaskDelegations(slug: string) {
  return useQuery({
    queryKey: agentosKeys.taskDelegations(slug),
    queryFn: () => getTaskDelegations(slug),
    refetchInterval: (query) =>
      query.state.data?.delegations.some((entry) => entry.active) ? 4_000 : false,
    networkMode: "always",
    retry: 1,
  });
}

/** Whether a task can be closed, and what closing it would change. */
export function useTaskCompletion(
  slug: string,
  taskId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: agentosKeys.taskCompletion(slug, taskId ?? ""),
    queryFn: () => getTaskCompletion(slug, taskId as string),
    enabled: enabled && Boolean(taskId),
    networkMode: "always",
    retry: 0,
  });
}

/** Scopes a task and recommends a worker. Starts nothing. */
export function usePrepareTaskDelegation(slug: string) {
  return useMutation({
    mutationFn: ({
      taskId,
      requestedWorker,
    }: {
      taskId: string;
      requestedWorker: WorkerJobRequest["worker"];
    }) => prepareTaskDelegation(slug, taskId, requestedWorker),
    networkMode: "always",
    retry: 0,
  });
}

/** Starts the work from an approved plan, and refreshes what the screen shows. */
export function useStartTaskDelegation(slug: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      approval,
    }: {
      taskId: string;
      approval: TaskDelegationApproval;
    }) => startTaskDelegation(slug, taskId, approval),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: agentosKeys.taskDelegations(slug),
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Scopes every eligible task in a milestone and recommends a worker for
 * each. Starts nothing — same one-way rule as a single task's delegation.
 */
export function usePrepareMilestoneDelegation(slug: string) {
  return useMutation({
    mutationFn: ({
      milestoneId,
      requestedWorker,
    }: {
      milestoneId: string;
      requestedWorker: WorkerJobRequest["worker"];
    }) => prepareMilestoneDelegation(slug, milestoneId, requestedWorker),
    networkMode: "always",
    retry: 0,
  });
}

/** Starts every task approved out of a prepared milestone batch, and refreshes what the screen shows. */
export function useStartMilestoneDelegation(slug: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      milestoneId,
      tasks,
    }: {
      milestoneId: string;
      tasks: MilestoneTaskApproval[];
    }) => startMilestoneDelegation(slug, milestoneId, tasks),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: agentosKeys.taskDelegations(slug) });
      void client.invalidateQueries({ queryKey: agentosKeys.roadmap(slug) });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Closes a task in `TASKS.md`.
 *
 * Invalidates the project as well as the delegations: the file is the
 * project's canonical state, so the screen must re-read it rather than assume
 * what the write did.
 */
export function useCompleteTask(slug: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => completeTask(slug, taskId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: agentosKeys.project(slug) });
      void client.invalidateQueries({
        queryKey: agentosKeys.taskDelegations(slug),
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Asks for a recommendation.
 *
 * A mutation rather than a query on purpose: it is an action the operator
 * takes, it costs a Hermes call, and it must not re-run on its own while
 * someone is still reading the answer it gave.
 */
export function useRouteWorkerJob() {
  return useMutation({
    mutationFn: routeWorkerJob,
    networkMode: "always",
    retry: 0,
  });
}

export function useStartWorkerJob() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: startWorkerJob,
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useCancelWorkerJob() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => cancelWorkerJob(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The review, approval, and rejection actions.
 *
 * Each one invalidates the job, because every one of them changes what the
 * screen is allowed to offer next — and getting that wrong here means offering
 * to approve something that has already been integrated.
 */
export function useReviewWorkerJob() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => reviewWorkerJob(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useReviseWorkerJob() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => reviseWorkerJob(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The visual verdict and its history.
 *
 * Read separately from the job rather than folded into it: the job record
 * carries the current verdict, and the screenshots and earlier revisions are a
 * larger thing that only matters on the screen that shows them.
 */
export function useWorkerJobVisual(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...agentosKeys.workerJob(id), "visual"],
    queryFn: () => getWorkerJobVisual(id),
    enabled: enabled && id.length > 0,
    staleTime: 10_000,
    retry: 1,
    networkMode: "always",
  });
}

/** Runs the implementation and photographs it again. */
export function useVerifyWorkerJobVisually() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => verifyWorkerJobVisually(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Sends the visual findings back to the worker. */
export function useRequestVisualRevision() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => requestWorkerVisualRevision(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useApproveWorkerJob() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => approveWorkerJob(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useRejectWorkerJob() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      rejectWorkerJob(id, reason),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDiscardWorkerWorktree() {
  const refresh = useJobRefresh();

  return useMutation({
    mutationFn: (id: string) => discardWorkerWorktree(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** The diff, fetched only when the operator asks to see it. */
export function useWorkerJobDiff(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...agentosKeys.workerJob(id), "diff"],
    queryFn: () => getWorkerJobDiff(id),
    enabled: enabled && id.length > 0,
    staleTime: 10_000,
    retry: 1,
    networkMode: "always",
  });
}

/**
 * Whether the work could be integrated right now.
 *
 * Read from the server rather than worked out in the browser: the conditions
 * are about the state of a git repository, and the browser has no way to know
 * whether the operator's branch moved a moment ago.
 */
export function useWorkerJobIntegration(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...agentosKeys.workerJob(id), "integration"],
    queryFn: () => getWorkerJobIntegration(id),
    enabled: enabled && id.length > 0,
    staleTime: 5_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useSteerWorkerJob() {
  return useMutation({
    mutationFn: ({ id, instruction }: { id: string; instruction: string }) =>
      steerWorkerJob(id, instruction),
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Whether Hermes is configured. This reads local config from the adapter and
 * costs no Hermes request, so the console can open without waking the agent.
 */
export function useAgentStatus() {
  return useQuery({
    queryKey: agentosKeys.agentStatus(),
    queryFn: getAgentStatus,
    staleTime: 60_000,
    retry: 1,
    networkMode: "always",
  });
}

/** Sends one message to Hermes. Only fires when the operator asks it to. */
export function useSendAgentMessage() {
  return useMutation({
    mutationFn: sendAgentMessage,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * What this Hermes build supports.
 *
 * Contacting Hermes for capabilities is a read, not a run: it starts no work
 * and produces no agent output. Features stay off until this says otherwise.
 */
export function useAgentCapabilities() {
  return useQuery({
    queryKey: agentosKeys.agentCapabilities(),
    queryFn: getAgentCapabilities,
    staleTime: 5 * 60_000,
    retry: 0,
    networkMode: "always",
  });
}

/**
 * The skills this Hermes has, for quick actions and the command palette.
 *
 * Reading skills contacts Hermes, so it is opt-in: screens outside the console
 * ask for it only once the palette is opened. Discovery is a read — it starts
 * no work and produces no agent output — and a Hermes that cannot answer leaves
 * the console on its built-in baseline rather than empty.
 */
export function useAgentSkills(enabled = true) {
  return useQuery({
    queryKey: agentosKeys.agentSkills(),
    queryFn: getAgentSkills,
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    networkMode: "always",
  });
}

/**
 * The project's persistent Hermes session.
 *
 * Resolving a session creates one on first use, which is a write — but not a
 * run. Opening the console still costs no agent work.
 */
export function useAgentSession(project?: string) {
  return useQuery({
    queryKey: agentosKeys.agentSession(project),
    queryFn: () => getAgentSession(project),
    staleTime: 5 * 60_000,
    retry: 0,
    networkMode: "always",
  });
}

/** The canonical transcript for a project's session, straight from Hermes. */
export function useAgentSessionMessages(project?: string, enabled = true) {
  return useQuery({
    queryKey: agentosKeys.agentMessages(project),
    queryFn: () => getAgentSessionMessages(project),
    enabled,
    staleTime: 30_000,
    retry: 0,
    networkMode: "always",
  });
}

/** Recent Hermes sessions, for the session history control. */
export function useAgentSessions(enabled = false) {
  return useQuery({
    queryKey: agentosKeys.agentSessions(),
    queryFn: listAgentSessions,
    enabled,
    staleTime: 60_000,
    retry: 0,
    networkMode: "always",
  });
}

/** Refreshes the session and its transcript after they change. */
function useSessionRefresh(project?: string) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({
      queryKey: agentosKeys.agentSession(project),
    });
    void queryClient.invalidateQueries({
      queryKey: agentosKeys.agentMessages(project),
    });
    void queryClient.invalidateQueries({ queryKey: agentosKeys.agentSessions() });
  };
}

/**
 * Re-reads AgentOS state from the vault.
 *
 * Called after a run ends, because a run may have written files. Nothing is
 * updated optimistically — the adapter re-reads what is actually on disk, so
 * the screens can only ever show a change that really happened.
 *
 * Deliberately scoped to vault reads: capabilities, skills and sessions are not
 * changed by a run, and refetching them would cost needless Hermes requests.
 */
export function useRefreshVault() {
  const queryClient = useQueryClient();

  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === agentosKeys.all[0] &&
        query.queryKey[1] !== "agent",
    });
}

/** Reloads the canonical transcript, e.g. once a run completes. */
export function useRefreshAgentMessages(project?: string) {
  const queryClient = useQueryClient();

  return () =>
    queryClient.invalidateQueries({
      queryKey: agentosKeys.agentMessages(project),
    });
}

export function useNewAgentSession(project?: string) {
  const refresh = useSessionRefresh(project);

  return useMutation({
    mutationFn: () => startNewAgentSession(project),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useForkAgentSession(project?: string) {
  const refresh = useSessionRefresh(project);

  return useMutation({
    mutationFn: () => forkAgentSession(project),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The validation sprint.
 *
 * Read on demand and never polled. Nothing on this screen changes without the
 * operator doing something, and a sprint that refetched itself every ten
 * seconds would be a live feed of a thing that moves five times a week.
 */
export function useValidationSprint(enabled = true) {
  return useQuery({
    queryKey: agentosKeys.validation(),
    queryFn: getValidationSprint,
    enabled,
    staleTime: 15_000,
    networkMode: "always",
    retry: 0,
  });
}

/** Re-reads the sprint after anything is recorded against it. */
function useSprintRefresh() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: agentosKeys.validation() });
  }, [queryClient]);
}

export function useStartValidationTask() {
  const refresh = useSprintRefresh();

  return useMutation({
    mutationFn: (input: StartValidationTask) => startValidationTask(input),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useUpdateValidationTask() {
  const refresh = useSprintRefresh();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateValidationTask & { id: string }) =>
      updateValidationTask(id, input),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useReportFriction() {
  const refresh = useSprintRefresh();

  return useMutation({
    mutationFn: (input: ReportFriction) => reportFriction(input),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Operations.
 *
 * Polled slowly — a minute, not ten seconds. Spend does not move fast enough
 * to justify a live feed, and the one part of this screen that genuinely is
 * live (what a worker is doing right now) is already streamed on that job's
 * own page.
 */
export function useOperations() {
  return useQuery({
    queryKey: agentosKeys.operations(),
    queryFn: getOperations,
    refetchInterval: 60_000,
    staleTime: 30_000,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The Mission Control line.
 *
 * A separate, far cheaper read than the Operations payload, so the morning's
 * first screen does not pay for a report it only shows two numbers from.
 */
export function useUsageSummary() {
  return useQuery({
    queryKey: agentosKeys.usageSummary(),
    queryFn: getUsageSummary,
    staleTime: 60_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useAgentDetail(id: string) {
  return useQuery({
    queryKey: agentosKeys.agentDetail(id),
    queryFn: () => getAgentDetail(id),
    enabled: id.length > 0,
    staleTime: 30_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useTaskUsage(taskId: string, enabled = true) {
  return useQuery({
    queryKey: agentosKeys.taskUsage(taskId),
    queryFn: () => getTaskUsage(taskId),
    enabled: enabled && taskId.length > 0,
    staleTime: 30_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: agentosKeys.subscriptions(),
    queryFn: getSubscriptions,
    staleTime: 60_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useBudgets() {
  return useQuery({
    queryKey: agentosKeys.budgets(),
    queryFn: getBudgets,
    staleTime: 60_000,
    networkMode: "always",
    retry: 0,
  });
}

/** Everything money-shaped invalidates the same three reads. */
function useMoneyRefresh() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: agentosKeys.operations() });
    void queryClient.invalidateQueries({
      queryKey: agentosKeys.subscriptions(),
    });
    void queryClient.invalidateQueries({ queryKey: agentosKeys.budgets() });
  }, [queryClient]);
}

export function useSaveSubscription() {
  const refresh = useMoneyRefresh();

  return useMutation({
    mutationFn: (input: Omit<Subscription, "id"> & { id?: string }) =>
      saveSubscription(input),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteSubscription() {
  const refresh = useMoneyRefresh();

  return useMutation({
    mutationFn: (id: string) => deleteSubscription(id),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useSaveBudget() {
  const refresh = useMoneyRefresh();

  return useMutation({
    mutationFn: (budget: UsageBudget) => saveBudget(budget),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The editable workspace.
 *
 * Every read here returns a revision, and every write sends one back. That pair
 * is what makes a UI safe on top of files a person still edits by hand: a
 * screen that has gone stale is refused rather than silently winning, and the
 * console reloads instead of overwriting.
 *
 * All of these invalidate the project itself as well as their own read, because
 * the project detail is assembled from the same files — leaving it stale would
 * show a task in the list that the tasks tab has already moved.
 */
export function useEditableTasks(slug: string) {
  return useQuery({
    queryKey: agentosKeys.editableTasks(slug),
    queryFn: () => getEditableTasks(slug),
    enabled: slug.length > 0,
    staleTime: 5_000,
    networkMode: "always",
    retry: 0,
  });
}

function useWorkspaceRefresh(slug: string) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    for (const key of [
      agentosKeys.editableTasks(slug),
      agentosKeys.roadmap(slug),
      [...agentosKeys.all, "milestone", slug],
      agentosKeys.projectProse(slug),
      agentosKeys.editableDecisions(slug),
      agentosKeys.project(slug),
      agentosKeys.projects(),
      agentosKeys.dashboard(),
      agentosKeys.missionControl(),
      agentosKeys.backups(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient, slug]);
}

export function useCreateTask(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: { title: string; section?: string; expectedRevision?: string }) =>
      createProjectTask({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function usePatchTask(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: {
      taskId: string;
      title?: string;
      completed?: boolean;
      section?: string;
      position?: number;
      ready?: boolean;
      after?: string[];
      milestone?: string;
      milestoneRevision?: string;
      expectedRevision?: string;
    }) => patchProjectTask({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteTask(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: { taskId: string; expectedRevision?: string }) =>
      deleteProjectTask({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useReorderTasks(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: {
      section: string;
      taskIds: string[];
      expectedRevision?: string;
    }) => reorderProjectTasks({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useProjectProse(slug: string) {
  return useQuery({
    queryKey: agentosKeys.projectProse(slug),
    queryFn: () => getProjectProse(slug),
    enabled: slug.length > 0,
    staleTime: 5_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useWriteProse(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: {
      field: ProseField;
      body: string;
      expectedRevision?: string;
    }) => putProjectProse({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useEditableDecisions(slug: string) {
  return useQuery({
    queryKey: agentosKeys.editableDecisions(slug),
    queryFn: () => getEditableDecisions(slug),
    enabled: slug.length > 0,
    staleTime: 5_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useWriteDecision(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: {
      title: string;
      body: string;
      decidedOn?: string;
      expectedRevision?: string;
    }) => writeProjectDecision({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteDecision(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (title: string) => deleteProjectDecision({ slug, title }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useProjectSource(slug: string, file: string, enabled: boolean) {
  return useQuery({
    queryKey: agentosKeys.projectSource(slug, file),
    queryFn: () => getProjectSource(slug, file),
    enabled: enabled && slug.length > 0,
    staleTime: 0,
    networkMode: "always",
    retry: 0,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewProject) => createNewProject(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.projects() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.dashboard() });
      void queryClient.invalidateQueries({
        queryKey: agentosKeys.missionControl(),
      });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function usePatchProject(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProjectPatchRequest) => patchProjectDetails({ slug, ...input }),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: agentosKeys.projectSettings(slug) });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useProjectSettings(slug: string, enabled = true) {
  return useQuery({
    queryKey: agentosKeys.projectSettings(slug),
    queryFn: () => getProjectSettings(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 0,
    networkMode: "always",
    retry: 0,
  });
}

export function useArchiveTask(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: { taskId: string; expectedRevision?: string }) =>
      archiveProjectTask({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useRestoreTask(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: { taskId: string; section?: string; expectedRevision?: string }) =>
      restoreProjectTask({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useBulkTasks(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (input: BulkTaskAction) => bulkProjectTasks({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Hermes' proposal for a project. Nothing is written until the operator creates it. */
export function usePlanProject() {
  return useMutation({
    mutationFn: (brief: string) => planProjectWithHermes(brief),
    networkMode: "always",
    retry: 0,
  });
}

/** Global search, keyed by query so the palette can type ahead without refetch storms. */
export function useSearch(query: string, enabled = true) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: agentosKeys.search(trimmed),
    queryFn: () => searchAgentOS(trimmed),
    enabled: enabled && trimmed.length >= 2,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    networkMode: "always",
    retry: 0,
  });
}

export function useArchiveProject(slug: string) {
  const refresh = useWorkspaceRefresh(slug);

  return useMutation({
    mutationFn: (restoreTo?: string) =>
      restoreTo ? restoreProject(slug, restoreTo) : archiveProject(slug),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Recent human edits, and putting one back. */
export function useBackups(enabled = false) {
  return useQuery({
    queryKey: agentosKeys.backups(),
    queryFn: getBackups,
    enabled,
    staleTime: 5_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useUndoEdit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => undoEdit(id),
    onSuccess: () => {
      // An undo can touch any file, so nothing assembled from the vault is
      // trustworthy afterwards. Everything is re-read rather than guessing.
      void queryClient.invalidateQueries({ queryKey: agentosKeys.all });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The roadmap and its milestones.
 *
 * Read fresh often: progress is derived from the task file, which the board
 * on the next tab may have just changed.
 */
export function useRoadmap(slug: string) {
  return useQuery({
    queryKey: agentosKeys.roadmap(slug),
    queryFn: () => getProjectRoadmap(slug),
    enabled: slug.length > 0,
    staleTime: 5_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useMilestone(slug: string, id: string | undefined) {
  return useQuery({
    queryKey: agentosKeys.milestone(slug, id ?? ""),
    queryFn: () => getMilestoneDetail(slug, id ?? ""),
    enabled: slug.length > 0 && !!id,
    staleTime: 5_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useCreateMilestone(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: CreateMilestoneRequest) => createProjectMilestone({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function usePatchMilestone(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { id: string } & PatchMilestoneRequest) => patchProjectMilestone({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useMilestoneAction(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { id: string; action: MilestoneAction; expectedRevision?: string }) =>
      actOnMilestone({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useCompleteMilestone(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { id: string; review?: string; expectedRevision?: string }) =>
      completeProjectMilestone({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteMilestone(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { id: string; expectedRevision?: string }) => deleteProjectMilestone({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useReorderMilestones(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { ids: string[]; expectedRevision?: string }) => reorderProjectMilestones({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useSetCriterion(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { id: string; index: number; done: boolean; expectedRevision?: string }) =>
      setMilestoneCriterion({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Hermes' proposal for a milestone. Writes nothing until applied. */
export function usePlanMilestone(slug: string) {
  return useMutation({
    mutationFn: (id: string) => planMilestoneWithHermes(slug, id),
    networkMode: "always",
    retry: 0,
  });
}

export function useApplyMilestonePlan(slug: string) {
  const refresh = useWorkspaceRefresh(slug);
  return useMutation({
    mutationFn: (input: { id: string } & ApplyMilestonePlanRequest) => applyMilestonePlan({ slug, ...input }),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useDraftMilestoneReview(slug: string) {
  return useMutation({
    mutationFn: (id: string) => draftMilestoneReviewWithHermes(slug, id),
    networkMode: "always",
    retry: 0,
  });
}

/** A fresh run of a finished job. The new job is what the caller navigates to. */
export function useRetryWorkerJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retryWorkerJob(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.workerJobs() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.missionControl() });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Project documents: vault artifacts and docs, and the repository's own. */
export function useProjectDocuments(slug: string, enabled = true) {
  return useQuery({
    queryKey: agentosKeys.documents(slug),
    queryFn: () => getProjectDocuments(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 10_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useProjectDocument(slug: string, path: string | undefined, origin: "agentos" | "repo") {
  return useQuery({
    queryKey: agentosKeys.document(slug, path ?? "", origin),
    queryFn: () => getProjectDocument(slug, path ?? "", origin),
    enabled: slug.length > 0 && !!path,
    staleTime: 10_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useCreateDocument(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateDocumentRequest) => createProjectDocument({ slug, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.documents(slug) });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.recentDocuments() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.backups() });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Hermes drafts a document. Nothing is written until it is saved. */
export function useProposeDocument(slug: string) {
  return useMutation({
    mutationFn: (input: { brief: string; taskId?: string }) => proposeProjectDocument(slug, input.brief, input.taskId),
    networkMode: "always",
    retry: 0,
  });
}

export function useRecentDocuments(limit = 6) {
  return useQuery({
    queryKey: agentosKeys.recentDocuments(),
    queryFn: () => getRecentDocuments(limit),
    staleTime: 30_000,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * The Higgsfield account behind the composer.
 *
 * Read on the Designs page and in Operations: the credit balance is the one
 * number that decides whether a generation is a good idea, so it is never far
 * from the button that spends it.
 */
export function useHiggsfieldAccount() {
  return useQuery({
    queryKey: agentosKeys.higgsfield(),
    queryFn: getHiggsfieldAccount,
    staleTime: 60_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useHiggsfieldModels(enabled = true) {
  return useQuery({
    queryKey: agentosKeys.higgsfieldModels(),
    queryFn: getHiggsfieldModels,
    enabled,
    staleTime: 10 * 60_000,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * What the current composer settings would cost.
 *
 * Keyed on the model, prompt and count, so changing any of them re-prices —
 * and the answer comes from Higgsfield rather than from a constant.
 */
export function useGenerationCost(input: { model: string; prompt: string; count: number; enabled?: boolean }) {
  return useQuery({
    queryKey: agentosKeys.generationCost(input.model, input.prompt.slice(0, 80), input.count),
    queryFn: () => estimateGenerationCost({ model: input.model, prompt: input.prompt, count: input.count }),
    enabled: (input.enabled ?? true) && input.model.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * A project's repository.
 *
 * Polled while the tab is open: branches and the working tree change from
 * outside AgentOS — an operator committing in their own terminal is the normal
 * case, not the exception — and a stale branch name here is how somebody
 * switches to the wrong thing.
 */
export function useRepositoryStatus(slug: string, enabled = true) {
  return useQuery({
    queryKey: agentosKeys.repository(slug),
    queryFn: () => getRepositoryStatus(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 5_000,
    refetchInterval: enabled ? 15_000 : false,
    networkMode: "always",
    retry: 0,
  });
}

/**
 * One repository action.
 *
 * The action returns the resulting status, so a success seeds the cache
 * directly rather than asking for it again — the page updates in the same tick
 * the button reports what it did. A refusal resolves rather than throws, so it
 * is read from `data`, not from an error boundary.
 */
export function useRepositoryAction(slug: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (action: RepositoryAction) => runRepositoryAction(slug, action),
    onSuccess: (result) => {
      if (result.status) {
        client.setQueryData(agentosKeys.repository(slug), result.status);
      }

      // A branch switch or a commit changes what the rest of the project page
      // is describing, so the project itself is refetched too.
      void client.invalidateQueries({ queryKey: agentosKeys.project(slug) });
      void client.invalidateQueries({ queryKey: agentosKeys.workerJobs() });
    },
  });
}

/**
 * Runs a job's validation again.
 *
 * Invalidates the integration check as well as the job: the whole point of
 * running it is that the "cannot be applied" panel should change.
 */
export function useValidateWorkerJob() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => validateWorkerJob(id),
    onSuccess: (_result, id) => {
      void client.invalidateQueries({ queryKey: agentosKeys.workerJob(id) });
      void client.invalidateQueries({ queryKey: agentosKeys.workerJobs() });
    },
  });
}
