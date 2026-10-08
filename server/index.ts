import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { AutomationControlSchema, CuratorControlSchema } from "../shared/agentos-types";
import { WorkerIdSchema } from "../shared/worker-ids";
import { MailBulkRequestSchema, MailCorrectionSchema } from "../shared/mail-types";
import { MailComposeRequestSchema, MailPolishRequestSchema, MailSendTagSchema } from "../shared/mail-compose-types";
import { ZodError } from "zod";
import {
  ApplyMilestonePlanRequestSchema,
  BulkTaskActionSchema,
  CreateDocumentRequestSchema,
  CreateMilestoneRequestSchema,
  DocumentProposalRequestSchema,
  CreateProjectRequestSchema,
  PatchMilestoneRequestSchema,
  ProjectPatchRequestSchema,
  ProjectPlanRequestSchema,
  type ApprovalDecision,
} from "../shared/agentos-types";
import { getDashboardData } from "./agentos/dashboard";
import { getMissionControlData } from "./mission-control/builder";
import { dismissAttention, restoreAttention } from "./mission-control/dismissals";
import { readCalendarTasks } from "./calendar/tasks";
import { calendarRouter } from "./calendar/routes";
import { getTodayCalendar } from "./today/calendar";
import { formatAgenda } from "./today/agenda";
import { getMorningBrief } from "./today/brief";
import { getDayWrap } from "./today/wrap";
import { getTodayNews } from "./today/news";
import { getTodayTrending, startTrendingTracker } from "./today/trending";
import { AttentionDismissRequestSchema, AttentionRestoreRequestSchema } from "../shared/mission-control-types";
import { agentOSRoot, readOptionalFile } from "./agentos/filesystem";
import {
  findProject,
  getProjectDetail,
  getProjects,
  parseRepositoryPath,
} from "./agentos/projects";
import { parseConfiguration } from "./agentos/mutations/configuration";
import { readPortfolioGoal } from "./agentos/mutations/portfolio-document";
import { search } from "./agentos/search";
import { getMilestoneDetail, getRoadmap } from "./agentos/roadmap";
import {
  readRepositoryStatus,
  repositoryPathFor,
  runRepositoryAction,
} from "./agentos/repository";
import { RepositoryActionSchema } from "../shared/repository-types";
import { readGitGraph } from "./agentos/git-graph";
import {
  getProjectDocuments,
  listRecentDocuments,
  readProjectDocument,
} from "./agentos/documents";
import { createDocument } from "./agentos/mutations/documents";
import { proposeDocument } from "./hermes/document-proposal";
import {
  assignTask,
  completeMilestone,
  createMilestone,
  deleteMilestone,
  patchMilestone,
  reorderMilestones,
  setCriterion,
  setMilestoneStatus,
} from "./agentos/mutations/milestones";
import { draftMilestoneReview, planMilestone } from "./hermes/milestone-planning";
import { PlanningUnavailableError, planProject } from "./hermes/project-planning";
import {
  forkProjectSession,
  resolveProjectSession,
} from "./agentos/session-resolver";
import {
  getActivity,
  readLimit,
  readSource,
  type ActivityQuery,
} from "./activity";
import { isReportableType, recordActivity } from "./activity/ui-events";
import { getValidationSprint } from "./validation-sprint/sprint";
import { businessRouter } from "./business/routes";
import { tractionRouter } from "./traction/routes";
import { careerRouter } from "./career/routes";
import { voiceRouter } from "./voice/routes";
import { memoryRouter } from "./memory/routes";
import { grokBotRouter } from "./workers/grok-bot-routes";
import { memoryService } from "./memory/service";
import { completeOutreachConnection, OutreachAuthError, parseOutreachState } from "./outreach/auth";
import { startOutreachSyncTimer } from "./outreach/sync";
import { outreachRouter } from "./outreach/routes";
import { rebuildRouter, recoverRebuildsAtStartup } from "./website-rebuild/routes";
import { siteRequestRouter } from "./site-requests/routes";
import { skillsRouter } from "./skills/routes";
import { financeRouter } from "./finance/routes";
import { routePolicyRouter } from "./route-policy/routes";
import { connectorsRouter } from "./connectors/routes";
import { databasesRouter } from "./supabase/routes";
import { operatorRouter } from "./operator/routes";
import { reconcileOperatorRuns } from "./operator/service";
import { coderRouter, handleTerminalWebSocket } from "./coder/routes";
import { killAllTerminals } from "./coder/pty-manager";
import { startMonthlyReviewSchedule } from "./finance/monthly-review";
import {
  archiveTask,
  bulkTasks,
  completeTask,
  createTask,
  deleteTask,
  InvalidRequestError,
  NotFoundError,
  reopenTask,
  reorderTasks,
  readTasks,
  restoreTask,
  updateTask,
} from "./agentos/mutations/tasks";
import {
  archiveProject,
  createProject,
  patchProject,
  readPortfolioForEdit,
  restoreProject,
} from "./agentos/mutations/projects";
import {
  deleteDecision,
  readDecisions,
  writeDecision,
} from "./agentos/mutations/decisions";
import {
  isProseField,
  readMilestone,
  readProjectSource,
  readPurpose,
  readStatus,
  writeProse,
} from "./agentos/mutations/status";
import {
  DocumentInvalidError,
  listBackups,
  restoreBackup,
} from "./agentos/mutations/writer";
import { RevisionConflictError } from "./agentos/mutations/revision";
import {
  getAgentDetail,
  getOperationsData,
  getUsageSummary,
} from "./usage/operations";
import { readUsage } from "./usage/ledger";
import { taskUsage } from "./usage/metrics";
import { deleteBudget, listBudgets, saveBudget } from "./usage/budgets";
import {
  deleteSubscription,
  listSubscriptions,
  saveSubscription,
} from "./usage/subscriptions";
import {
  SubscriptionSchema,
  UsageBudgetSchema,
  UsageRangeSchema,
} from "../shared/usage-types";
import {
  reportFriction,
  startTask,
  updateTask as updateValidationTask,
} from "./validation-sprint/store";
import {
  ReportFrictionSchema,
  StartValidationTaskSchema,
  UpdateValidationTaskSchema,
} from "../shared/validation-sprint-types";
import {
  createAssetOnce,
  createBoard,
  deleteAsset,
  deleteBoard,
  findAssetByFingerprint,
  findStoredAsset,
  fingerprint,
  getLibrary,
  setBoardMembership,
  updateAsset,
  updateBoard,
} from "./designs/library";
import {
  contentTypeFor,
  deleteImage,
  extensionFor,
  isVideoName,
  ORIGINALS,
  readImage,
  resolveMedia,
  storeImage,
  storeVideo,
  thumbnailNameFor,
  THUMBNAILS,
} from "./designs/media";
import { animateRouter } from "./designs/animate-routes";
import { motionRouter } from "./designs/motion-routes";
import { readDecision, respondToApproval } from "./hermes/approvals";
import { accountStatus, estimateCost, listModels } from "./designs/higgsfield";
import { validateJobRequest } from "./workers/context-builder";
import {
  cancelJob,
  interruptRunningJobs,
  isRunning,
  reconcileInterruptedJobs,
  retryJob,
  startJob,
  startStallWatch,
  steerJob,
  subscribe,
  withLiveness,
} from "./workers/job-manager";
import {
  appendEvent,
  listJobs,
  readEvents,
  readJob,
  saveJob,
} from "./workers/job-store";
import { createWorkerEvent } from "./workers/worker";
import {
  delegateTask,
  previewTaskRoute,
  prepareDelegation,
  taskDelegations,
} from "./agentos/task-delegation";
import { proposeCompletion } from "./agentos/task-completion";
import { CloseoutError, completeTaskWithCloseout, draftCloseout } from "./tasks/closeout";
import { CompleteTaskRequestSchema } from "../shared/task-closeout-types";
import { frictionRouter } from "./friction/routes";
import { learningRouter, spotifyRouter } from "./learning/routes";
import { readTaskLink } from "./agentos/task-jobs";
import { prepareMilestoneDelegation, startMilestoneDelegation } from "./agentos/milestone-delegation";
import {
  MilestoneDelegationRequestSchema,
  MilestoneDelegationStartRequestSchema,
  TaskDelegationApprovalSchema,
  TaskDelegationRequestSchema,
  TaskRouteRequestSchema,
} from "../shared/delegation-types";
import {
  DesignBriefProposalSchema,
  DesignReviewRequestSchema,
  MAX_REVIEW_ASSETS,
} from "../shared/design-intelligence-types";
import {
  finaliseReview,
  proposeBrief,
  saveBrief,
  startReview,
} from "./designs/design-intelligence";
import {
  listReviews,
  readReview as readDesignReviewRecord,
} from "./designs/review-store";
import { DesignGenerationRequestSchema, MAX_VARIATIONS } from "../shared/design-generation-types";
import { generate } from "./designs/generation";
import { generationCapability } from "./designs/renderer";
import { listGenerations, readGeneration } from "./designs/generation-store";
import {
  approveJob,
  discardWorktree,
  getJobDiff,
  integrationBlockerDetails,
  validateJob,
  rejectJob,
  requestRevision,
  requestVisualRevision,
  reviewJob,
} from "./workers/review";
import {
  readVerification,
  readVerificationHistory,
  verifyJobVisually,
  wantsVisualVerification,
} from "./visual-verification";
import { resolveScreenshot } from "./visual-verification/storage";
import { describeWorkers, getWorker, listWorkers } from "./workers/registry";
import { workerPerformance } from "./workers/metrics";
import { routeJob } from "./workers/router";
import { WorkerRoutingDecisionSchema } from "../shared/worker-routing-types";
import { RoutingModeSchema, TaskMetadataSchema } from "../shared/route-policy-types";
import { WorkerJobRequestSchema } from "../shared/worker-types";
import {
  VisualAcceptanceContextSchema,
  type VisualAcceptanceContext,
} from "../shared/visual-verification-types";
import { controlAutomation, getAutomation, getAutomations } from "./hermes/automations";
import { controlCurator, getAutomationSurfaces } from "./hermes/automation-surfaces";
import { getCapabilities } from "./hermes/capabilities";
import { getHermesStatus, HermesError, sendToHermes } from "./hermes/client";
import {
  buildConsentUrl,
  loopbackOrigin,
  canModifyGmail,
  completeGmailConnection,
  disconnectGmail,
  GmailAuthError,
  isGmailConfigured,
  isGmailConnected,
} from "./mail/gmail-auth";
import { getThreadBody, GmailError } from "./mail/gmail-client";
import { JevError } from "./mail/jev-client";
import { runMailSync, syncDepsFor } from "./mail/sync";
import { closeTitanConnection, getTitanThreadBody, TitanError, verifyTitanLogin } from "./mail/titan-client";
import { forgetTitanCredentials, saveTitanCredentials, titanAccount, TitanCredentialsError, updateTitanSenderName } from "./mail/titan-credentials";
import { MAIL_ACCOUNT_LABEL, mailAccountOf, TitanConnectRequestSchema, TitanUpdateRequestSchema, type MailAccountSummary } from "../shared/mail-account-types";
import { activeMailClassifier } from "./mail/classifier";
import { captureNote, CAPTURE_PATH, parseCaptures } from "./agentos/capture";
import { compassRouter } from "./compass/routes";
import { focusRouter } from "./focus/routes";
import { acceptCapture, CaptureTriageError, deleteCapture, readTriage, suggestHomes } from "./agentos/capture-triage";
import { CaptureAcceptSchema } from "../shared/capture-types";
import { getKnowledge } from "./agentos/knowledge";
import { CaptureRequestSchema } from "../shared/agentos-types";
import {
  clearCorrection,
  lastSyncedAt,
  readMailData,
  removeThread,
  storeCorrection,
  threadCount,
  visibleThreadIds,
} from "./mail/store";
import { markThreadsRead, runBulkAction, trashThreads } from "./mail/actions";
import { readProgress } from "./mail/progress";
import { scheduleLowPriorityCleanup } from "./mail/auto-clean";
import {
  composeMail,
  discardSavedDraft,
  listOutbox,
  OutboxNotFoundError,
  replyContextFor,
  retagOutboxItem,
  sendSavedDraft,
} from "./mail/compose";
import { MailPolishError, polishEmail } from "./mail/polish";
import { MimeError } from "./outreach/mime";
import { setAiEnabled, setAiModel } from "./ai-stack/settings";
import { normaliseWorkerModel } from "./ai-stack/model-names";
import { hasConfigurableModel, isToggleable, readAiStack } from "./ai-stack/stack";
import { SetAiEnabledRequestSchema } from "../shared/ai-stack-types";
import { SPOKEN_STYLE } from "../shared/voice-types";
import { runSeoAudit } from "./seo/audit";
import { markFindingFiled, readFinding, readProjectSeo } from "./seo/store";
import { getProjectVercelInfo, isVercelConfigured, listVercelProjects, VercelError } from "./vercel/client";
import { readProjectSite } from "./vercel/site";
import { RunSeoAuditRequestSchema } from "../shared/seo-types";
import {
  getRun,
  openRunEvents,
  startRun,
  steerRun,
  stopRun,
} from "./hermes/runs";
import { getSessionMessages, listSessions } from "./hermes/sessions";
import { getSkills } from "./hermes/skills";

// Secrets live in the server environment only. Loading is best-effort: the
// vault endpoints work fine without a Hermes key.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file — Hermes stays unconfigured until one exists.
}

/**
 * The AgentOS data adapter: a read-only view of `~/AgentOS` over HTTP.
 *
 * Bound to loopback only — this serves personal local data and must never be
 * reachable from the network. The frontend never names a path; the server
 * decides which vault files may be read.
 */

const PORT = Number(process.env.AGENTOS_PORT ?? 8787);
const HOST = "127.0.0.1";

const app = express();

app.disable("x-powered-by");
app.use("/api/business/ledger", express.json({ limit: "16mb" }));
// Attachments arrive base64-encoded: 18 MB of files is 24 MB of JSON.
app.use("/api/mail/compose", express.json({ limit: "26mb" }));
app.use(express.json({ limit: "1mb" }));

/** Traction: prospects, the daily acquisition queue, offers and experiments. */
app.use("/api/traction", tractionRouter);
/** Career: employment admin, the work log, growth, and the timesheet / soccer / LinkedIn runbooks. */
app.use("/api/career", careerRouter);

/** Business: the companies being run and their clients, read from Virtec. */
app.use("/api/business", businessRouter);
app.use("/api/outreach", outreachRouter);
app.use("/api/rebuilds", rebuildRouter);
app.use("/api/site-requests", siteRequestRouter);
app.use("/api/skills", skillsRouter);
recoverRebuildsAtStartup();
app.use("/api/compass", compassRouter);
app.use("/api/focus", focusRouter);
app.use("/api/calendar", calendarRouter);

/** Finance: Investec (read-only), the ledger, subscriptions, goals. No route here can move money. */
app.use("/api/finance", financeRouter);
app.use("/api/route-policy", routePolicyRouter);

/** Connectors: every service AgentOS can reach, its switch, and each capability's policy. */
app.use("/api/connectors", connectorsRouter);

/** Operator: one request in, planned against Connectors, approved, executed, and recorded as a run. */
app.use("/api/operator", operatorRouter);

/** Databases: named Supabase setups, their workspace links, and the Database tab's rows. */
app.use("/api/databases", databasesRouter);

/** Voice: speech to text and text to speech only. Words still go through Hermes. */
app.use("/api/voice", voiceRouter);

/** Memory: the Obsidian vault, indexed — notes, links, graph, and task context. Read-only. */
app.use("/api/memory", memoryRouter);

/** Coder: in-app IDE with Monaco editor, file tree, and PTY terminals. */
app.use("/api/coder", coderRouter);
app.use("/api/friction", frictionRouter);
app.use("/api/learning", learningRouter);
app.use("/api/spotify", spotifyRouter);

/** Grok Bot: its switch, SSD workspace path and connection test. Disk access stays server-side. */
app.use("/api/workers/grok-bot", grokBotRouter);

/** Motion studio: briefs in, Claude Code renders films, finished MP4s land in Creative. */
app.use("/api/designs/animate", animateRouter);
app.use("/api/designs/motion", motionRouter);

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", root: agentOSRoot() });
});

/**
 * Mission Control: what matters, what is running, what needs you, what is broken.
 *
 * A consolidation of systems that already exist, and the owner of none of them.
 * Every source is settled independently inside the builder, so this route
 * returns partial data with a degraded `sources` map rather than failing —
 * an unreachable Hermes must not cost the operator their worker queue.
 *
 * Costs no model call. Attention is computed from statuses, which is why the
 * screen can be polled every few seconds and says the same thing twice.
 */
app.get("/api/mission-control", async (_request, response) => {
  try {
    response.json(await getMissionControlData());
  } catch (error) {
    // Reached only if the aggregation itself broke; every individual source
    // failure is already handled inside.
    console.error("[agentos] mission control failed:", error);
    response.status(500).json({ error: "Unable to read mission control" });
  }
});

/** Today's Google Calendar events, read-only. Never fails: a missing calendar is a status. */
app.get("/api/today/calendar", async (_request, response) => {
  try {
    response.json(await getTodayCalendar());
  } catch (error) {
    console.error("[agentos] today calendar failed:", error);
    response.json({ status: "error", detail: "The calendar couldn't be read.", today: [] });
  }
});

/**
 * Today's calendar as plain text, for Hermes' morning brief (fetched by a
 * pre-run script, `~/.hermes/scripts/agentos-agenda.sh`). Always answers
 * with text, even when the calendar can't be read.
 */
app.get("/api/today/agenda", async (_request, response) => {
  let calendar;
  try {
    calendar = await getTodayCalendar();
  } catch (error) {
    console.error("[agentos] agenda failed:", error);
    calendar = { status: "error" as const, detail: "AgentOS couldn't read the calendar", today: [] };
  }
  const scheduled = await readCalendarTasks().catch(() => undefined);
  response.type("text/plain").send(formatAgenda(calendar, new Date(), scheduled?.tasks));
});

/** Hermes' newest morning brief, parsed into its plan. */
app.get("/api/today/brief", async (_request, response) => {
  try {
    response.json(await getMorningBrief());
  } catch (error) {
    console.error("[agentos] morning brief failed:", error);
    response.status(500).json({ error: "The morning brief couldn't be read." });
  }
});

/** Tech and AI news from Hacker News and trusted outlets. A failing source is named, never fatal. */
app.get("/api/today/news", async (_request, response) => {
  try {
    response.json(await getTodayNews());
  } catch (error) {
    console.error("[agentos] today news failed:", error);
    response.json({ items: [], failed: ["all sources"], fetchedAt: new Date().toISOString() });
  }
});

/** New GitHub repositories taking off this week. */
app.get("/api/today/trending", async (_request, response) => {
  try {
    response.json(await getTodayTrending());
  } catch (error) {
    console.error("[agentos] today trending failed:", error);
    response.json({ status: "error", detail: "Trending couldn't be read.", repos: [], windowDays: 7, fetchedAt: new Date().toISOString() });
  }
});

/** The end-of-day wrap: done today, and the open Now tasks tomorrow starts with. */
app.get("/api/today/wrap", async (_request, response) => {
  try {
    response.json(await getDayWrap());
  } catch (error) {
    console.error("[agentos] day wrap failed:", error);
    response.status(500).json({ error: "The day's wrap couldn't be read." });
  }
});

/** Clears cards from Today's Needs you. The jobs, automations and workspaces behind them are untouched. */
app.post("/api/mission-control/dismiss", async (request, response) => {
  const parsed = AttentionDismissRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Send the cards to clear, each with its id and createdAt." });
    return;
  }
  try {
    await dismissAttention(parsed.data.items);
    response.json({ ok: true });
  } catch (error) {
    console.error("[agentos] dismissing attention failed:", error);
    response.status(500).json({ error: "Unable to clear those cards" });
  }
});

app.post("/api/mission-control/restore", async (request, response) => {
  const parsed = AttentionRestoreRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send the card ids to restore, or nothing to restore all." });
    return;
  }
  try {
    await restoreAttention(parsed.data.ids);
    response.json({ ok: true });
  } catch (error) {
    console.error("[agentos] restoring attention failed:", error);
    response.status(500).json({ error: "Unable to restore those cards" });
  }
});

app.get("/api/dashboard", async (_request, response) => {
  try {
    response.json(await getDashboardData());
  } catch (error) {
    console.error("[agentos] dashboard read failed:", error);
    response.status(500).json({ error: "Unable to load AgentOS dashboard" });
  }
});

/**
 * Mail: Gmail, classified by Jev.
 *
 * Opening the page never calls Gmail or Jev — only Refresh and the explicit
 * actions below do. Access is `gmail.modify`: marking read, moving to Trash,
 * labelling, and sending or drafting mail the person wrote and pressed Send
 * or Save draft on. Nothing here deletes mail permanently.
 */
app.get("/api/mail/status", async (_request, response) => {
  try {
    // Gmail alone makes the Inbox usable. Classification is optional and
    // reported separately, so a missing Jev key never hides the mail.
    const configured = isGmailConfigured();
    const connected = configured && (await isGmailConnected());
    const titan = await titanAccount();
    const accounts: MailAccountSummary[] = [
      { id: "gmail", label: MAIL_ACCOUNT_LABEL.gmail, connected },
      { id: "titan", label: MAIL_ACCOUNT_LABEL.titan, connected: titan !== undefined, address: titan?.address, server: titan?.imapHost, senderName: titan?.senderName },
    ];

    response.json({
      configured,
      classifier: activeMailClassifier(),
      connected,
      canModify: connected && (await canModifyGmail()),
      lastSyncedAt: lastSyncedAt(),
      threadCount: threadCount(),
      accounts,
    });
  } catch (error) {
    console.error("[agentos] mail status failed:", error);
    response.status(500).json({ error: "Unable to read mail status" });
  }
});

app.get("/api/mail/connect", (request, response) => {
  try {
    // The proxy rewrites Host, so the page the person clicked from (Referer) is the reliable origin.
    response.redirect(buildConsentUrl(request.get("referer")));
  } catch (error) {
    response.status(409).json({
      error: error instanceof Error ? error.message : "Gmail is not configured.",
    });
  }
});

/** Where Google sends the browser back after consent. Never called by the frontend directly. */
app.get("/api/mail/oauth/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : undefined;

  if (!code) {
    // Google comes back without a code when consent is cancelled or refused
    // (for instance an account that is not a listed test user). For the
    // outreach mailbox, return to the page with the reason rather than
    // stranding the person on a blank error page.
    const returned = typeof request.query.state === "string" ? request.query.state : undefined;
    const outreachReturn = parseOutreachState(returned);

    if (outreachReturn) {
      const origin = outreachReturn.origin ?? process.env.AGENTOS_WEB_ORIGIN ?? "http://localhost:1420";
      const googleError = typeof request.query.error === "string" ? request.query.error : "no authorization code";
      const reason =
        googleError === "access_denied"
          ? "Google did not allow that account to connect. Cancelled, or the account is not a test user of the AgentOS Google app."
          : `Google returned ${googleError}.`;
      response.redirect(`${origin}/traction?tab=prospects&outreach=${encodeURIComponent(reason)}`);
      return;
    }

    response.status(400).send("Missing authorization code.");
    return;
  }

  try {
    const state = typeof request.query.state === "string" ? request.query.state : undefined;

    // The outreach mailbox shares this address with Google (one registered
    // redirect), and says which connection this is in `state`.
    const outreach = parseOutreachState(state);
    if (outreach) {
      const origin = outreach.origin ?? process.env.AGENTOS_WEB_ORIGIN ?? "http://localhost:1420";
      try {
        await completeOutreachConnection(code);
        response.redirect(`${origin}/traction?tab=prospects&outreach=connected`);
      } catch (error) {
        const reason = error instanceof OutreachAuthError ? error.message : "Could not connect the outreach mailbox.";
        response.redirect(`${origin}/traction?tab=prospects&outreach=${encodeURIComponent(reason)}`);
      }
      return;
    }

    await completeGmailConnection(code);
    const webOrigin = loopbackOrigin(state) ?? process.env.AGENTOS_WEB_ORIGIN ?? "http://localhost:1420";
    response.redirect(`${webOrigin}/inbox`);
  } catch (error) {
    console.error("[agentos] gmail connection failed:", error);
    response.status(502).send("Could not complete the Gmail connection. Return to AgentOS and try again.");
  }
});

app.post("/api/mail/disconnect", async (_request, response) => {
  await disconnectGmail();
  response.json({ ok: true });
});

/**
 * Links the Virtara (Titan) mailbox. The login is tried against the server
 * first and only saved when it works, sealed on this machine. The password
 * is never echoed back, logged, or sent anywhere but the mailbox's servers.
 */
app.post("/api/mail/accounts/titan", async (request, response) => {
  const parsed = TitanConnectRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Enter the mailbox address and password." });
    return;
  }
  try {
    await verifyTitanLogin(parsed.data);
    console.log(`[agentos] Virtara mailbox linked for ${parsed.data.address} at ${parsed.data.imapHost}:${parsed.data.imapPort}.`);
    closeTitanConnection();
    await saveTitanCredentials(parsed.data);
    response.json({ ok: true, address: parsed.data.address });
  } catch (error) {
    if (error instanceof TitanError) {
      // The reason and Titan's reply only: never the password.
      console.warn(`[agentos] Linking the Virtara mailbox failed (${error.reason}) for ${parsed.data.address} at ${parsed.data.imapHost}:${parsed.data.imapPort}: ${error.message}`);
      response.status(error.reason === "unauthorized" ? 401 : 409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] linking the Virtara mailbox failed:", error instanceof Error ? error.message : "unknown error");
    response.status(500).json({ error: "Unable to link the Virtara mailbox" });
  }
});

/** Sets the name shown next to the Virtara address on sent mail. No new login: the sealed password is kept. */
app.patch("/api/mail/accounts/titan", async (request, response) => {
  const parsed = TitanUpdateRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Send { senderName }." });
    return;
  }
  try {
    await updateTitanSenderName(parsed.data.senderName);
    response.json({ ok: true, senderName: parsed.data.senderName || undefined });
  } catch (error) {
    if (error instanceof TitanCredentialsError) {
      response.status(409).json({ error: error.message });
      return;
    }
    console.error("[agentos] updating the Virtara sender name failed:", error instanceof Error ? error.message : "unknown error");
    response.status(500).json({ error: "Unable to save the sender name" });
  }
});

/** Unlinks the Virtara mailbox: forgets the login. Its cached threads stay until they age out of the window. */
app.delete("/api/mail/accounts/titan", async (_request, response) => {
  closeTitanConnection();
  await forgetTitanCredentials();
  response.json({ ok: true });
});

/** A manual sync: fetches new INBOX threads and classifies anything unclassified. */
app.post("/api/mail/sync", async (_request, response) => {
  try {
    response.json(await runMailSync(await syncDepsFor(activeMailClassifier())));
  } catch (error) {
    if (error instanceof GmailAuthError || error instanceof GmailError || error instanceof JevError || error instanceof TitanError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] mail sync failed:", error);
    response.status(500).json({ error: "Unable to sync mail" });
  }
});

scheduleLowPriorityCleanup();

/** How far the current Refresh or "Ask Jev again" has got. Cheap to poll — memory only. */
app.get("/api/mail/progress", (_request, response) => {
  response.json(readProgress());
});

app.get("/api/mail", (_request, response) => {
  try {
    response.json(readMailData());
  } catch (error) {
    console.error("[agentos] mail read failed:", error);
    response.status(500).json({ error: "Unable to read mail" });
  }
});

/**
 * Removes a thread from the Mail view. Local only — access is
 * `gmail.readonly`, so the underlying Gmail message is never touched.
 */
app.post("/api/mail/:threadId/remove", (request, response) => {
  try {
    removeThread(request.params.threadId);
    response.json({ ok: true });
  } catch (error) {
    console.error("[agentos] mail remove failed:", error);
    response.status(500).json({ error: "Unable to remove that thread" });
  }
});

/** Answers a Gmail/Jev failure as a 409 the page can explain; anything else is a 500. */
function sendMailActionError(response: express.Response, error: unknown, fallback: string): void {
  if (error instanceof GmailAuthError || error instanceof GmailError || error instanceof JevError || error instanceof TitanError) {
    response.status(409).json({ error: error.message, reason: error.reason });
    return;
  }
  if (error instanceof TitanCredentialsError) {
    response.status(409).json({ error: error.message, reason: "unauthorized" });
    return;
  }
  console.error(`[agentos] ${fallback}:`, error);
  response.status(500).json({ error: fallback });
}

/** Answers a compose failure: a bad address or file is the person's to fix (422), a missing draft is 404. */
function sendComposeError(response: express.Response, error: unknown, fallback: string): void {
  if (error instanceof MimeError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof OutboxNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  sendMailActionError(response, error, fallback);
}

/** Sends an email, or saves it to Gmail Drafts, written in the Inbox. A person pressed the button. */
app.post("/api/mail/compose", async (request, response) => {
  const parsed = MailComposeRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That email is not complete." });
    return;
  }
  if (parsed.data.mode === "send" && !parsed.data.body.trim() && parsed.data.attachments.length === 0) {
    response.status(400).json({ error: "The email is empty." });
    return;
  }
  try {
    response.json(await composeMail(parsed.data));
  } catch (error) {
    sendComposeError(response, error, parsed.data.mode === "send" ? "Unable to send that email" : "Unable to save that draft");
  }
});

/** Fixes grammar and tone with Hermes. Nothing is sent; the person reviews the result. */
app.post("/api/mail/polish", async (request, response) => {
  const parsed = MailPolishRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Send { body }." });
    return;
  }
  try {
    response.json(await polishEmail(parsed.data));
  } catch (error) {
    if (error instanceof MailPolishError) {
      response.status(409).json({ error: error.message });
      return;
    }
    console.error("[agentos] mail polish failed:", error);
    response.status(500).json({ error: "Unable to polish that email" });
  }
});

/** Email written in AgentOS, sent and drafts, newest first. `?tag=business` narrows it. */
app.get("/api/mail/outbox", (request, response) => {
  const tag = MailSendTagSchema.safeParse(request.query.tag);
  try {
    response.json({ items: listOutbox(tag.success ? tag.data : undefined) });
  } catch (error) {
    console.error("[agentos] mail outbox read failed:", error);
    response.status(500).json({ error: "Unable to read sent mail" });
  }
});

app.post("/api/mail/outbox/:id/send", async (request, response) => {
  try {
    response.json(await sendSavedDraft(request.params.id));
  } catch (error) {
    sendComposeError(response, error, "Unable to send that draft");
  }
});

app.post("/api/mail/outbox/:id/tag", async (request, response) => {
  const tag = MailSendTagSchema.safeParse((request.body as { tag?: unknown } | undefined)?.tag);
  if (!tag.success) {
    response.status(400).json({ error: "Send { tag: normal | business | virtara }." });
    return;
  }
  try {
    response.json(await retagOutboxItem(request.params.id, tag.data));
  } catch (error) {
    sendComposeError(response, error, "Unable to change that tag");
  }
});

app.delete("/api/mail/outbox/:id", async (request, response) => {
  try {
    await discardSavedDraft(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    sendComposeError(response, error, "Unable to discard that draft");
  }
});

/** Who a reply to this thread goes to, and its subject, for the composer. */
app.get("/api/mail/:threadId/reply-context", async (request, response) => {
  try {
    response.json(await replyContextFor(request.params.threadId));
  } catch (error) {
    sendMailActionError(response, error, "Unable to read that thread");
  }
});

/** A person's correction of Jev. Stored locally and sent to Jev as an example on later calls. */
app.post("/api/mail/:threadId/correct", (request, response) => {
  const parsed = MailCorrectionSchema.safeParse(request.body);
  if (!parsed.success || (!parsed.data.bucket && !parsed.data.category)) {
    response.status(400).json({ error: "Send a bucket, a category, or both." });
    return;
  }
  if (visibleThreadIds([request.params.threadId]).length === 0) {
    response.status(404).json({ error: "That thread is not in the Inbox." });
    return;
  }
  storeCorrection(request.params.threadId, parsed.data);
  response.json({ ok: true });
});

/** Undoes a correction, handing the thread back to Jev's own judgment. */
app.post("/api/mail/:threadId/correct/clear", (request, response) => {
  clearCorrection(request.params.threadId);
  response.json({ ok: true });
});

app.post("/api/mail/:threadId/read", async (request, response) => {
  const read = (request.body as { read?: unknown } | undefined)?.read;
  if (typeof read !== "boolean") {
    response.status(400).json({ error: "Send { read: true | false }." });
    return;
  }
  try {
    response.json(await markThreadsRead([request.params.threadId], read));
  } catch (error) {
    sendMailActionError(response, error, "Unable to change read state");
  }
});

/** Moves one thread to Gmail's Trash — recoverable there for 30 days. */
app.post("/api/mail/:threadId/trash", async (request, response) => {
  try {
    response.json(await trashThreads([request.params.threadId]));
  } catch (error) {
    sendMailActionError(response, error, "Unable to move that thread to Trash");
  }
});

/** Mark read / Trash / ask Jev again for a list of threads — the page sends the current filter's ids. */
app.post("/api/mail/bulk", async (request, response) => {
  const parsed = MailBulkRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Send an action and up to 300 thread ids." });
    return;
  }
  try {
    response.json(await runBulkAction(parsed.data.action, parsed.data.threadIds));
  } catch (error) {
    sendMailActionError(response, error, "Unable to run that action");
  }
});

/** One thread's full plain-text body — fetched only when a person opens it, never stored. */
app.get("/api/mail/:threadId/body", async (request, response) => {
  try {
    const threadId = request.params.threadId;
    const body = mailAccountOf(threadId) === "titan" ? await getTitanThreadBody(threadId) : await getThreadBody(threadId);
    response.json({ body });
  } catch (error) {
    if (error instanceof GmailAuthError || error instanceof GmailError || error instanceof TitanError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] mail body read failed:", error);
    response.status(500).json({ error: "Unable to read that message" });
  }
});

/**
 * The AI stack: what is on this machine, what AgentOS uses, and a switch for
 * each AI AgentOS integrates. Reading changes nothing; the switch is the only
 * write, and it refuses any AI AgentOS has no integration with.
 */
app.get("/api/ai-stack", async (_request, response) => {
  try {
    response.json(await readAiStack());
  } catch (error) {
    console.error("[agentos] ai stack read failed:", error);
    response.status(500).json({ error: "Unable to read the AI stack" });
  }
});

app.put("/api/ai-stack/:id", (request, response) => {
  const parsed = SetAiEnabledRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "Say whether it should be enabled, or which model it should use." });
    return;
  }

  const { id } = request.params;
  const { enabled, model } = parsed.data;

  if (!isToggleable(id)) {
    response.status(404).json({ error: "AgentOS has no integration with that AI, so there is nothing to switch." });
    return;
  }

  if (model !== undefined && !hasConfigurableModel(id)) {
    response.status(400).json({ error: "That AI's model is not chosen here." });
    return;
  }

  const checked = model !== undefined ? normaliseWorkerModel(id, model) : {};
  if (checked.error) {
    response.status(400).json({ error: checked.error });
    return;
  }

  try {
    if (enabled !== undefined) setAiEnabled(id, enabled);
    if (model !== undefined) setAiModel(id, checked.model);
    response.json({ id, enabled, model: model === undefined ? undefined : (checked.model ?? "") });
  } catch (error) {
    console.error("[agentos] ai stack switch failed:", error);
    response.status(500).json({ error: "Unable to save that switch" });
  }
});

/**
 * Vercel, read-only: a project's live URL, domains, and recent deployments,
 * read from Vercel instead of typed in by hand. Every handler here only ever
 * issues `GET`s to Vercel — see `server/vercel/client.ts`.
 */
app.get("/api/vercel/projects", async (_request, response) => {
  try {
    if (!isVercelConfigured()) {
      response.status(409).json({ error: "VERCEL_API_TOKEN is not set.", reason: "not-configured" });
      return;
    }
    response.json({ projects: await listVercelProjects() });
  } catch (error) {
    if (error instanceof VercelError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] vercel projects read failed:", error);
    response.status(500).json({ error: "Unable to read Vercel projects" });
  }
});

app.get("/api/projects/:slug/vercel", async (request, response) => {
  try {
    const project = await readProjectSource(request.params.slug, "PROJECT.md");
    const configuration = parseConfiguration(project?.contents);

    if (!configuration.vercelProjectId) {
      response.status(404).json({ error: "No Vercel project is linked to this project." });
      return;
    }

    const info = await getProjectVercelInfo(
      configuration.vercelProjectId,
      configuration.vercelProjectName ?? configuration.vercelProjectId,
    );

    response.json(info);
  } catch (error) {
    if (error instanceof VercelError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] project vercel info read failed:", error);
    response.status(500).json({ error: "Unable to read Vercel data for this project" });
  }
});

/**
 * A workspace's Site tab: the production URL to frame inside AgentOS, the
 * deployment behind it, and whether the site allows being framed. Expected
 * states (nothing linked, no token, token rejected) answer 200 with a
 * `status`, so the tab can offer the matching fix.
 */
app.get("/api/projects/:slug/site", async (request, response) => {
  const project = await readProjectSource(request.params.slug, "PROJECT.md").catch(() => undefined);
  if (!project) {
    response.status(404).json({ error: "That project is not in the AgentOS portfolio." });
    return;
  }

  const configuration = parseConfiguration(project.contents);
  const projectId = configuration.vercelProjectId;
  if (!projectId) {
    response.json({ status: "unlinked" });
    return;
  }
  if (!isVercelConfigured()) {
    response.json({ status: "not-configured", message: "VERCEL_API_TOKEN is not set in .env." });
    return;
  }

  const projectName = configuration.vercelProjectName ?? projectId;
  try {
    response.json(await readProjectSite(projectId, projectName));
  } catch (error) {
    if (error instanceof VercelError) {
      response.json({ status: "unavailable", projectName, reason: error.reason, message: error.message });
      return;
    }
    console.error("[agentos] project site read failed:", error);
    response.status(500).json({ error: "Unable to read this project's site" });
  }
});

/**
 * SEO: a mechanical audit of a project's live site.
 *
 * `POST .../seo/audit` resolves a target (an explicit URL, or the linked
 * Vercel project's live domain), crawls it, and persists the result — see
 * `server/seo/audit.ts`. `GET .../seo` only ever reads what was already
 * recorded; opening the tab never triggers a crawl on its own.
 */
app.post("/api/projects/:slug/seo/audit", async (request, response) => {
  try {
    const slug = request.params.slug;
    const { targetUrl } = RunSeoAuditRequestSchema.parse(request.body ?? {});

    let resolvedUrl = targetUrl;

    if (!resolvedUrl) {
      const project = await readProjectSource(slug, "PROJECT.md");
      const configuration = parseConfiguration(project?.contents);

      if (configuration.vercelProjectId) {
        const info = await getProjectVercelInfo(
          configuration.vercelProjectId,
          configuration.vercelProjectName ?? configuration.vercelProjectId,
        );
        resolvedUrl = info.liveUrl;
      }
    }

    if (!resolvedUrl) {
      response.status(409).json({
        error: "No target URL for this project. Link a Vercel project in Settings, or pass a URL.",
      });
      return;
    }

    response.json(await runSeoAudit(slug, resolvedUrl));
  } catch (error) {
    if (error instanceof VercelError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    mutationFailed(error, response);
  }
});

app.get("/api/projects/:slug/seo", (request, response) => {
  try {
    response.json(readProjectSeo(request.params.slug));
  } catch (error) {
    console.error("[agentos] seo read failed:", error);
    response.status(500).json({ error: "Unable to read SEO data" });
  }
});

app.post("/api/projects/:slug/seo/findings/:findingId/task", async (request, response) => {
  try {
    const finding = readFinding(request.params.findingId);

    if (!finding) {
      response.status(404).json({ error: "No such finding." });
      return;
    }
    if (finding.taskId) {
      response.status(409).json({ error: "This finding already has a task." });
      return;
    }

    const result = await createTask({
      slug: request.params.slug,
      title: `SEO: ${finding.title}`,
    });

    markFindingFiled(finding.id, result.taskId);

    await recordActivity({
      type: "task.created",
      description: `${result.taskId}: SEO: ${finding.title}`,
      project: request.params.slug,
      metadata: { taskId: result.taskId },
    });

    response.status(201).json({ ...result, findingId: finding.id });
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.get("/api/projects", async (_request, response) => {
  try {
    // The projects screen browses the whole portfolio, so it reads detail for
    // parked and completed work too.
    response.json({ projects: await getProjects("all") });
  } catch (error) {
    console.error("[agentos] projects read failed:", error);
    response.status(500).json({ error: "Unable to load AgentOS projects" });
  }
});

app.get("/api/projects/:slug", async (request, response) => {
  try {
    // The slug is only ever matched against projects the portfolio lists; it
    // never becomes a filesystem path on its own.
    const project = await getProjectDetail(request.params.slug);

    if (!project) {
      response.status(404).json({ error: "Unknown AgentOS project" });
      return;
    }

    response.json(project);
  } catch (error) {
    console.error("[agentos] project read failed:", error);
    response.status(500).json({ error: "Unable to load AgentOS project" });
  }
});

/**
 * Delegating a project task.
 *
 * Three calls, in the order a person actually works: prepare a plan, read it,
 * then start it. Preparing and starting are deliberately not one endpoint —
 * the plan exists to be read, and a single call would mean a model's reading
 * of a task became running code without anyone seeing the terms of the work.
 */
app.post("/api/projects/:slug/tasks/:taskId/delegate", async (request, response) => {
  // Parsed rather than trusted: a malformed mode is dropped, never half-applied.
  const parsed = TaskDelegationRequestSchema.safeParse(request.body ?? {});
  const requested = parsed.success ? parsed.data.requestedWorker : "auto";

  try {
    const { preview, error } = await prepareDelegation(
      request.params.slug,
      request.params.taskId,
      requested,
      parsed.success ? { routingMode: parsed.data.routingMode, manualOptionId: parsed.data.manualOptionId } : {},
    );

    if (!preview) {
      // A task that is already being worked on is a conflict, not a mistake.
      response.status(409).json({ error });
      return;
    }

    response.json(preview);
  } catch (error) {
    console.error("[agentos] task scoping failed:", error);
    response.status(500).json({ error: "Unable to scope that task" });
  }
});

/**
 * Re-checks the route for a plan already on screen: after it is edited, or the
 * operator picks Auto / Local only / Manual. Scoping is not repeated; only the
 * routing, which is deterministic and cheap.
 */
app.post("/api/projects/:slug/tasks/:taskId/route", async (request, response) => {
  const parsed = TaskRouteRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "That delegation plan is not complete." });
    return;
  }

  try {
    const { route, error } = await previewTaskRoute(
      request.params.slug,
      request.params.taskId,
      parsed.data.plan,
      parsed.data.requestedWorker,
      { routingMode: parsed.data.routingMode, manualOptionId: parsed.data.manualOptionId },
    );

    if (!route) {
      response.status(409).json({ error });
      return;
    }

    response.json(route);
  } catch (error) {
    console.error("[agentos] task route check failed:", error);
    response.status(500).json({ error: "Unable to check that route" });
  }
});

/** Starts the work, from a plan a person has approved. */
app.post("/api/projects/:slug/tasks/:taskId/start", async (request, response) => {
  const parsed = TaskDelegationApprovalSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "That delegation plan is not complete." });
    return;
  }

  try {
    const { job, error } = await delegateTask(
      request.params.slug,
      request.params.taskId,
      parsed.data,
    );

    if (!job) {
      response.status(409).json({ error });
      return;
    }

    response.status(201).json({ job });
  } catch (error) {
    console.error("[agentos] task delegation failed:", error);
    response.status(500).json({ error: "Unable to delegate that task" });
  }
});

/** What has been delegated in this project, and where each job has got to. */
app.get("/api/projects/:slug/task-delegations", async (request, response) => {
  try {
    response.json({ delegations: await taskDelegations(request.params.slug) });
  } catch (error) {
    console.error("[agentos] task delegations failed:", error);
    response.status(500).json({ error: "Unable to read task delegations" });
  }
});

/**
 * Delegating a whole milestone: the same prepare-then-start shape as one
 * task, run over every eligible task in it. See `milestone-delegation.ts`.
 */
app.post("/api/projects/:slug/milestones/:id/delegate/prepare", async (request, response) => {
  const parsed = MilestoneDelegationRequestSchema.safeParse(request.body ?? {});
  const requested = parsed.success ? parsed.data.requestedWorker : "auto";

  try {
    const { preview, error } = await prepareMilestoneDelegation(
      request.params.slug,
      request.params.id,
      requested,
      { routingMode: parsed.success ? parsed.data.routingMode : undefined },
    );

    if (!preview) {
      response.status(404).json({ error });
      return;
    }

    response.json(preview);
  } catch (error) {
    console.error("[agentos] milestone scoping failed:", error);
    response.status(500).json({ error: "Unable to scope that milestone" });
  }
});

app.post("/api/projects/:slug/milestones/:id/delegate/start", async (request, response) => {
  const parsed = MilestoneDelegationStartRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "No approved tasks to start." });
    return;
  }

  try {
    response.status(201).json(await startMilestoneDelegation(request.params.slug, parsed.data));
  } catch (error) {
    console.error("[agentos] milestone delegation failed:", error);
    response.status(500).json({ error: "Unable to start that milestone" });
  }
});

/**
 * Whether a task can be closed, and what closing it would change.
 *
 * Returns the proposal either way. An operator asking why a task is not
 * closeable yet is owed the reason rather than a missing button.
 */
app.get("/api/projects/:slug/tasks/:taskId/completion", async (request, response) => {
  try {
    const link = await readTaskLink(request.params.slug, request.params.taskId);
    const job = link ? await readJob(link.jobId) : undefined;

    const proposal = await proposeCompletion(
      request.params.slug,
      request.params.taskId,
      job,
    );

    if (!proposal) {
      response.status(404).json({ error: "That task is not in TASKS.md." });
      return;
    }

    response.json({ proposal });
  } catch (error) {
    console.error("[agentos] completion proposal failed:", error);
    response.status(500).json({ error: "Unable to read that task" });
  }
});

/**
 * The closeout a task would complete with: summary, validation, artifacts,
 * proposed memory (with possible duplicates) and a proposed status update.
 * Nothing here writes.
 */
app.get("/api/projects/:slug/tasks/:taskId/closeout", async (request, response) => {
  try {
    const draft = await draftCloseout(memoryService(), request.params.slug, request.params.taskId);

    if (!draft) {
      response.status(404).json({ error: "That task is not in TASKS.md." });
      return;
    }

    response.json(draft);
  } catch (error) {
    if (error instanceof InvalidRequestError) {
      response.status(400).json({ error: error.message });
      return;
    }
    console.error("[agentos] closeout draft failed:", error);
    response.status(500).json({ error: "Unable to prepare the closeout" });
  }
});

/**
 * Ticks a task off in `TASKS.md`, with its closeout.
 *
 * Happens only here: after a person has approved the work, after it has been
 * integrated, and after they have seen the exact line that will change. The
 * body is optional — memory the person chose to keep and a status update —
 * and an empty one completes the task exactly as before.
 */
app.post("/api/projects/:slug/tasks/:taskId/complete", async (request, response) => {
  const { slug, taskId } = request.params;
  const parsed = CompleteTaskRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "That closeout could not be read." });
    return;
  }

  try {
    const record = await completeTaskWithCloseout(memoryService(), slug, taskId, parsed.data);
    response.json({ ok: true, record });
  } catch (error) {
    if (error instanceof CloseoutError) {
      response.status(error.status).json({ error: error.message, ...error.body });
      return;
    }
    if (error instanceof InvalidRequestError) {
      response.status(400).json({ error: error.message });
      return;
    }
    console.error("[agentos] task completion failed:", error);
    response.status(500).json({ error: "Unable to update TASKS.md" });
  }
});

/**
 * Generating design concepts.
 *
 * AgentOS runs the renderer itself, with arguments it chose. Hermes writes the
 * prompt; it is never asked to run the tool, because its own generation skill
 * answers that request by piping a remote installer into a shell.
 */
app.post("/api/designs/generate", async (request, response) => {
  const parsed = DesignGenerationRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({
      error: `A generation needs a prompt and at most ${MAX_VARIATIONS} variations.`,
    });
    return;
  }

  try {
    const generation = await generate(parsed.data);

    if (generation.status === "failed") {
      // A refused job is a precondition failing, not a server fault: the plan,
      // the session, or the renderer being absent.
      //
      // The reason is repeated at the top level as well as on the generation,
      // because that is where the transport looks for it — nested, it would be
      // replaced by a generic "could not be started", which is exactly the
      // message this error was written to avoid.
      response.status(409).json({ generation, error: generation.error });
      return;
    }

    response.status(201).json({ generation });
  } catch (error) {
    console.error("[agentos] design generation failed:", error);
    response.status(500).json({ error: "Unable to generate concepts" });
  }
});

/** Whether concepts can be generated at all, and why not when they cannot. */
/**
 * The Higgsfield account: plan, and credits remaining.
 *
 * Read before anything is spent, and shown beside every cost. Generation
 * through the CLI spends plan credits at standard rates even where a model is
 * unlimited on the website, so the balance is not a detail.
 */
app.get("/api/designs/higgsfield", async (_request, response) => {
  try {
    response.json({ account: await accountStatus() });
  } catch (error) {
    console.error("[agentos] higgsfield status failed:", error);
    response.status(500).json({ error: "Unable to read the Higgsfield account" });
  }
});

/** The renderable model catalogue, images and video. Cached upstream. */
app.get("/api/designs/models", async (_request, response) => {
  try {
    response.json({ models: await listModels() });
  } catch (error) {
    console.error("[agentos] higgsfield models failed:", error);
    response.json({ models: [] });
  }
});

/**
 * What a generation would cost, priced by Higgsfield.
 *
 * Replaces a hardcoded guess. The composer calls this as the model and the
 * number of variations change, so the number on the button is the number that
 * will be charged.
 */
app.post("/api/designs/cost", async (request, response) => {
  try {
    const { model, prompt, count } = request.body ?? {};

    if (typeof model !== "string" || model.trim().length === 0) {
      response.status(400).json({ error: "A model is required to price a generation." });
      return;
    }

    response.json({
      cost: await estimateCost({
        model,
        prompt: typeof prompt === "string" ? prompt : "",
        count: typeof count === "number" ? count : 1,
      }),
    });
  } catch (error) {
    console.error("[agentos] higgsfield cost failed:", error);
    response.status(500).json({ error: "Unable to price that generation" });
  }
});

app.get("/api/designs/generation-capability", async (_request, response) => {
  try {
    response.json({ generation: await generationCapability() });
  } catch (error) {
    console.error("[agentos] generation capability failed:", error);
    // Fails closed: an unreadable answer disables the feature.
    response.json({
      generation: {
        available: false,
        reason: "The image renderer could not be checked.",
      },
    });
  }
});

/** Past generations, newest first. Reopening one restores its results. */
app.get("/api/designs/generations", async (request, response) => {
  try {
    const project =
      typeof request.query.project === "string" ? request.query.project : undefined;

    response.json({ generations: await listGenerations(project) });
  } catch (error) {
    console.error("[agentos] generation listing failed:", error);
    response.status(500).json({ error: "Unable to list generations" });
  }
});

app.get("/api/designs/generations/:id", async (request, response) => {
  try {
    const generation = await readGeneration(request.params.id);

    if (!generation) {
      response.status(404).json({ error: "There is no such generation." });
      return;
    }

    response.json({ generation });
  } catch (error) {
    console.error("[agentos] generation read failed:", error);
    response.status(500).json({ error: "Unable to read that generation" });
  }
});

/**
 * Visual design intelligence.
 *
 * Reviews run as ordinary Hermes runs, so progress streams over the run event
 * endpoint the agent screen already uses — no second execution system. What is
 * new here is only what goes in and what comes back out.
 */
app.post("/api/designs/review", async (request, response) => {
  const parsed = DesignReviewRequestSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({
      error: `A review needs a project and between 1 and ${MAX_REVIEW_ASSETS} references.`,
    });
    return;
  }

  try {
    const { review, error } = await startReview(parsed.data);

    if (!review) {
      // Vision being unconfigured is a precondition, not a server fault.
      response.status(409).json({ error });
      return;
    }

    response.status(201).json({ review });
  } catch (error) {
    console.error("[agentos] design review failed:", error);
    response.status(500).json({ error: "Unable to start that review" });
  }
});

/** Reads a finished run into its review. Safe to call more than once. */
app.post("/api/designs/reviews/:id/finalise", async (request, response) => {
  try {
    const { review, error } = await finaliseReview(request.params.id);

    if (!review) {
      response.status(404).json({ error });
      return;
    }

    response.json({ review });
  } catch (error) {
    console.error("[agentos] design review finalise failed:", error);
    response.status(500).json({ error: "Unable to read that review" });
  }
});

/** Past reviews, newest first. Optionally for one project. */
app.get("/api/designs/reviews", async (request, response) => {
  try {
    const project =
      typeof request.query.project === "string" ? request.query.project : undefined;

    response.json({ reviews: await listReviews(project) });
  } catch (error) {
    console.error("[agentos] design review listing failed:", error);
    response.status(500).json({ error: "Unable to list reviews" });
  }
});

app.get("/api/designs/reviews/:id", async (request, response) => {
  try {
    const review = await readDesignReviewRecord(request.params.id);

    if (!review) {
      response.status(404).json({ error: "There is no such review." });
      return;
    }

    response.json({ review });
  } catch (error) {
    console.error("[agentos] design review read failed:", error);
    response.status(500).json({ error: "Unable to read that review" });
  }
});

/** Drafts a brief from a review. Proposes a file; writes nothing. */
app.post("/api/designs/reviews/:id/brief", async (request, response) => {
  const feature =
    typeof request.body?.feature === "string" ? request.body.feature.trim() : "";

  if (feature.length === 0) {
    response.status(400).json({ error: "A brief needs a feature name." });
    return;
  }

  try {
    const { proposal, error } = await proposeBrief(request.params.id, feature);

    if (!proposal) {
      response.status(409).json({ error });
      return;
    }

    response.json({ proposal });
  } catch (error) {
    console.error("[agentos] design brief failed:", error);
    response.status(500).json({ error: "Unable to draft that brief" });
  }
});

/**
 * Writes an approved brief into the project.
 *
 * One of only two places this server writes to the vault, and like the other
 * it happens after a person has seen the exact content and the exact path.
 */
app.post("/api/designs/briefs", async (request, response) => {
  const parsed = DesignBriefProposalSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "That brief is not complete." });
    return;
  }

  try {
    const { ok, error } = await saveBrief(parsed.data);

    if (!ok) {
      response.status(409).json({ error });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    console.error("[agentos] design brief save failed:", error);
    response.status(500).json({ error: "Unable to save that brief" });
  }
});

/**
 * The design library.
 *
 * The visual layer: images live in their own media directory and their meaning
 * lives in `~/.agentos-ui`, so the vault stays a human-owned knowledge layer
 * rather than a repository full of PNGs.
 */
app.get("/api/designs", async (_request, response) => {
  try {
    response.json(await getLibrary());
  } catch (error) {
    console.error("[agentos] design library read failed:", error);
    response.status(500).json({ error: "Unable to read the design library" });
  }
});

/** Images cap out well above a screenshot; videos get room for a real render. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 750 * 1024 * 1024;

function queryText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

const ASSET_TYPES = new Set(["uploaded", "generated", "reference", "screenshot"]);

/**
 * Adds one image to the library.
 *
 * The body is the file itself and the content type names the format — so the
 * server decides the extension, and the uploaded filename is kept only as a
 * label. A name can never become a path.
 */
app.post(
  "/api/designs/assets",
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (request, response) => {
    const extension = extensionFor(request.headers["content-type"] ?? "");

    if (!extension) {
      response
        .status(415)
        .json({ error: "That file type is not supported by the design library" });
      return;
    }

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "The upload was empty" });
      return;
    }

    const declared = queryText(request.query.type);
    const type = declared && ASSET_TYPES.has(declared) ? declared : "uploaded";
    const video = isVideoName(extension);

    if (!video && request.body.length > MAX_IMAGE_BYTES) {
      response.status(413).json({ error: "Images are limited to 25 MB" });
      return;
    }

    try {
      // The same file twice is one asset: a reference dropped into every
      // generation, or a screenshot uploaded again, reuses what is there.
      const sha256 = fingerprint(request.body);
      const existing = await findAssetByFingerprint(sha256);
      if (existing) {
        response.status(200).json({ asset: existing, duplicate: true });
        return;
      }

      const id = randomUUID();
      const stored = video
        ? await storeVideo(id, extension, request.body)
        : await storeImage(id, extension, request.body);

      const { asset, created } = await createAssetOnce({
        sha256,
        id,
        // A filename is a label here, never a location.
        filename: queryText(request.query.filename) ?? stored.storedName,
        storedName: stored.storedName,
        hasThumbnail: stored.hasThumbnail,
        dimensions: stored.dimensions,
        type: type as "uploaded" | "generated" | "reference" | "screenshot",
        project: queryText(request.query.project),
        mediaType: video ? "video" : "image",
        durationSec: (stored as { durationSec?: number }).durationSec,
      });

      if (!created) {
        // An identical upload finished first: keep its asset, drop these files.
        await deleteImage(stored.storedName);
        response.status(200).json({ asset, duplicate: true });
        return;
      }

      await recordActivity({
        type: "design.added",
        description: asset.filename,
        project: asset.project,
      });

      response.status(201).json({ asset });
    } catch (error) {
      console.error("[agentos] design upload failed:", error);
      response.status(500).json({ error: "Unable to store that image" });
    }
  },
);

/**
 * Serves one asset's file.
 *
 * The id is looked up in the library first, so only a file the library knows
 * about can be read — a request never names a path, and the stored name is one
 * the server generated.
 */
app.get("/api/designs/assets/:id/media", async (request, response) => {
  try {
    const asset = await findStoredAsset(request.params.id);

    if (!asset) {
      response.status(404).json({ error: "Unknown design asset" });
      return;
    }

    const wantsThumbnail =
      request.query.size === "thumbnail" && asset.hasThumbnail;

    // A video is streamed from disk: `sendFile` answers Range requests, which
    // is what lets a player seek without downloading the whole render first.
    if (isVideoName(asset.storedName)) {
      const file = wantsThumbnail
        ? resolveMedia(THUMBNAILS, thumbnailNameFor(asset.storedName))
        : resolveMedia(ORIGINALS, asset.storedName);

      response.sendFile(file, { headers: { "Cache-Control": "private, max-age=31536000, immutable" } }, (error) => {
        if (error && !response.headersSent) response.status(404).json({ error: "That video is no longer on disk" });
      });
      return;
    }

    const data =
      (await readImage(wantsThumbnail ? THUMBNAILS : ORIGINALS, asset.storedName)) ??
      // A missing thumbnail is not a missing image.
      (await readImage(ORIGINALS, asset.storedName));

    if (!data) {
      response.status(404).json({ error: "That image is no longer on disk" });
      return;
    }

    response.setHeader("Content-Type", contentTypeFor(asset.storedName));
    // Content at this URL never changes: a new upload is a new id.
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.send(data);
  } catch (error) {
    console.error("[agentos] design media read failed:", error);
    response.status(500).json({ error: "Unable to read that image" });
  }
});

/** Optional text field: absent leaves it alone, empty clears it. */
function patchText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

app.patch("/api/designs/assets/:id", async (request, response) => {
  const { tags, favorite, approved, type } = request.body ?? {};

  try {
    const asset = await updateAsset(request.params.id, {
      project: patchText(request.body?.project),
      product: patchText(request.body?.product),
      notes: patchText(request.body?.notes),
      approved: typeof approved === "boolean" ? approved : undefined,
      tags: Array.isArray(tags)
        ? tags.filter((tag: unknown): tag is string => typeof tag === "string")
        : undefined,
      favorite: typeof favorite === "boolean" ? favorite : undefined,
      type:
        typeof type === "string" && ASSET_TYPES.has(type)
          ? (type as "uploaded" | "generated" | "reference" | "screenshot")
          : undefined,
    });

    if (!asset) {
      response.status(404).json({ error: "Unknown design asset" });
      return;
    }

    response.json({ asset });
  } catch (error) {
    console.error("[agentos] design update failed:", error);
    response.status(500).json({ error: "Unable to update that asset" });
  }
});

app.delete("/api/designs/assets/:id", async (request, response) => {
  try {
    const removed = await deleteAsset(request.params.id);

    if (!removed) {
      response.status(404).json({ error: "Unknown design asset" });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    console.error("[agentos] design delete failed:", error);
    response.status(500).json({ error: "Unable to remove that asset" });
  }
});

app.post("/api/designs/boards", async (request, response) => {
  const name = queryText(request.body?.name);

  if (!name) {
    response.status(400).json({ error: "A board needs a name" });
    return;
  }

  try {
    response.status(201).json({
      board: await createBoard({
        name,
        description: patchText(request.body?.description) ?? undefined,
        project: patchText(request.body?.project) ?? undefined,
      }),
    });
  } catch (error) {
    console.error("[agentos] board create failed:", error);
    response.status(500).json({ error: "Unable to create that board" });
  }
});

app.patch("/api/designs/boards/:id", async (request, response) => {
  try {
    const board = await updateBoard(request.params.id, {
      name: queryText(request.body?.name),
      description: patchText(request.body?.description),
      project: patchText(request.body?.project),
      notes: patchText(request.body?.notes),
    });

    if (!board) {
      response.status(404).json({ error: "Unknown board" });
      return;
    }

    response.json({ board });
  } catch (error) {
    console.error("[agentos] board update failed:", error);
    response.status(500).json({ error: "Unable to update that board" });
  }
});

/** Removes the board. The assets it collected stay in the library. */
app.delete("/api/designs/boards/:id", async (request, response) => {
  try {
    const removed = await deleteBoard(request.params.id);

    if (!removed) {
      response.status(404).json({ error: "Unknown board" });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    console.error("[agentos] board delete failed:", error);
    response.status(500).json({ error: "Unable to remove that board" });
  }
});

/** Board membership: ids only, so an asset is never copied into a board. */
async function respondWithMembership(
  boardId: string,
  assetId: string,
  response: express.Response,
  member: boolean,
): Promise<void> {
  try {
    const board = await setBoardMembership(boardId, assetId, member);

    if (!board) {
      response.status(404).json({ error: "Unknown board or asset" });
      return;
    }

    response.json({ board });
  } catch (error) {
    console.error("[agentos] board membership change failed:", error);
    response.status(500).json({ error: "Unable to change that board" });
  }
}

app.put("/api/designs/boards/:id/assets/:assetId", (request, response) => {
  void respondWithMembership(
    request.params.id,
    request.params.assetId,
    response,
    true,
  );
});

app.delete("/api/designs/boards/:id/assets/:assetId", (request, response) => {
  void respondWithMembership(
    request.params.id,
    request.params.assetId,
    response,
    false,
  );
});

/**
 * The workers this build has, and whether each can be used.
 *
 * Every worker is listed, including the ones that are declared but not built:
 * hiding them would make the system look smaller than it is designed to be, and
 * an operator cannot fix a worker they cannot see.
 */
app.get("/api/workers", async (_request, response) => {
  try {
    response.json({ workers: await describeWorkers() });
  } catch (error) {
    console.error("[agentos] worker listing failed:", error);
    response.status(500).json({ error: "Unable to list workers" });
  }
});

/**
 * A routing decision as sent back by the console.
 *
 * Validated rather than trusted. It arrives from the browser, and a decision
 * this server did not check is a worker id chosen by whoever sent the request
 * — the job manager would then treat it as the resolved worker.
 */
/**
 * Reads a visual acceptance context off a request, or nothing.
 *
 * Nothing rather than a partial one: a job with half a visual contract would
 * either photograph the wrong routes or claim it was verified against
 * references it never saw.
 */
function parsedVisualAcceptance(
  value: unknown,
): VisualAcceptanceContext | undefined {
  if (value === undefined || value === null) return undefined;

  const parsed = VisualAcceptanceContextSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function parsedRouting(value: unknown) {
  if (value === undefined || value === null) return undefined;

  const result = WorkerRoutingDecisionSchema.safeParse(value);

  // A route-policy record is the server's own finding. One arriving from the
  // console is dropped, so the fallback plan and the local-only constraint
  // that a job later relies on are always the ones planned here, never ones
  // a request supplied.
  return result.success ? { ...result.data, policy: undefined } : undefined;
}

/** Optional route-policy fields of a job request, each validated on its own. */
function parsedRoutePolicyInputs(body: Record<string, unknown>) {
  const mode = RoutingModeSchema.safeParse(body.routingMode);
  const hints = TaskMetadataSchema.safeParse(body.routingHints);
  const expected = WorkerJobRequestSchema.shape.expectedOutput.safeParse(body.expectedOutput);

  return {
    routingMode: mode.success ? mode.data : undefined,
    manualOptionId: typeof body.manualOptionId === "string" ? body.manualOptionId : undefined,
    routingHints: hints.success ? hints.data : undefined,
    inputText: typeof body.inputText === "string" ? body.inputText : undefined,
    expectedOutput: expected.success ? expected.data : undefined,
  };
}

/**
 * A recommendation, made before anything is started.
 *
 * Deliberately separate from starting a job. The operator sees who was chosen
 * and why, and then decides — routing advises, it does not dispatch. Wiring
 * this into job creation would have been fewer endpoints and a system that
 * quietly acted on a model's choice.
 */
app.post("/api/worker-routing", async (request, response) => {
  const body = request.body ?? {};
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";

  if (objective.length === 0) {
    response.status(400).json({ error: "A job needs an objective." });
    return;
  }

  try {
    const { decision, candidates, error } = await routeJob({
      objective,
      project: typeof body.project === "string" ? body.project : "agentos",
    });

    if (!decision) {
      response.status(409).json({ error });
      return;
    }

    response.json({ decision, candidates });
  } catch (error) {
    console.error("[agentos] worker routing failed:", error);
    response.status(500).json({ error: "Unable to choose a worker" });
  }
});

/** What the job history says about each worker. The evidence behind routing. */
app.get("/api/workers/performance", async (_request, response) => {
  try {
    response.json({
      performance: await workerPerformance(
        listWorkers().map((worker) => worker.id),
      ),
    });
  } catch (error) {
    console.error("[agentos] worker performance failed:", error);
    response.status(500).json({ error: "Unable to read worker performance" });
  }
});

app.get("/api/workers/:id/health", async (request, response) => {
  const worker = getWorker(request.params.id as "grok" | "claude" | "mock");

  if (!worker) {
    response.status(404).json({ error: "Unknown worker" });
    return;
  }

  // Fails closed: a worker that cannot answer is unavailable, never assumed
  // ready.
  const health = await worker.healthCheck().catch(() => ({
    available: false,
    reason: "The worker could not report its health.",
  }));

  response.json({ id: worker.id, ...health });
});

/**
 * Delegates one scoped job.
 *
 * Returns as soon as the job is recorded and running; progress arrives on the
 * event stream. Everything refusable is refused before a worker starts, so an
 * invalid job never leaves a record or a worktree behind.
 */
app.post("/api/worker-jobs", async (request, response) => {
  const body = request.body ?? {};
  const invalid = validateJobRequest(body);

  if (invalid) {
    response.status(400).json({ error: invalid });
    return;
  }

  try {
    const { job, error } = await startJob({
      worker: body.worker ?? "mock",
      project: String(body.project),
      objective: String(body.objective),
      // Checked and copied by startJob: a disabled or unknown skill refuses the job.
      skillId: typeof body.skillId === "string" && body.skillId.trim() ? body.skillId.trim() : undefined,
      repoPath: body.repoPath,
      baseRef: body.baseRef,
      contextFiles: body.contextFiles,
      constraints: body.constraints,
      acceptanceCriteria: body.acceptanceCriteria,
      validationCommands: body.validationCommands,
      // What the operator started from, and the recommendation they were
      // shown. Both are the console's to report: the server cannot tell an
      // override from a plain choice by looking at the worker alone.
      requestedWorker: body.requestedWorker,
      routing: parsedRouting(body.routing),
      // Route-policy inputs. Parsed against the shared schema, not trusted: a
      // malformed value is dropped, never half-applied, and `localOnly` in
      // particular can only ever be honoured or refused, not misread.
      ...parsedRoutePolicyInputs(body),
      // Parsed rather than trusted: this decides whether a browser is driven
      // and which local files a review is shown, so a malformed one is dropped
      // rather than half-applied.
      visualAcceptance: parsedVisualAcceptance(body.visualAcceptance),
    });

    if (!job) {
      response.status(400).json({ error });
      return;
    }

    response.status(201).json({ job });
  } catch (error) {
    console.error("[agentos] worker job failed to start:", error);
    response.status(500).json({ error: "Unable to start that job" });
  }
});

app.get("/api/worker-jobs", async (_request, response) => {
  try {
    response.json({ jobs: (await listJobs()).map(withLiveness) });
  } catch (error) {
    console.error("[agentos] worker job listing failed:", error);
    response.status(500).json({ error: "Unable to list jobs" });
  }
});

app.get("/api/worker-jobs/:id", async (request, response) => {
  const job = await readJob(request.params.id);

  if (!job) {
    response.status(404).json({ error: "Unknown job" });
    return;
  }

  response.json({ job: withLiveness(job) });
});

/**
 * A job's activity, as it happens.
 *
 * Recorded events are replayed first, then live ones follow — so a screen
 * opened halfway through a job sees the whole story rather than only the rest
 * of it. A finished job simply replays and closes.
 */
app.get("/api/worker-jobs/:id/events", async (request, response) => {
  const jobId = request.params.id;
  const job = await readJob(jobId);

  if (!job) {
    response.status(404).json({ error: "Unknown job" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();

  const send = (event: unknown) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const event of await readEvents(jobId)) send(event);

  if (!isRunning(jobId)) {
    response.end();
    return;
  }

  const unsubscribe = subscribe(jobId, (event) => {
    send(event);
    // The stream has nothing left to carry once the job is over.
    if (event.type.startsWith("job.") && event.type !== "job.progress" && event.type !== "job.started") {
      response.end();
    }
  });

  request.on("close", () => {
    unsubscribe();
    response.end();
  });
});

app.post("/api/worker-jobs/:id/cancel", async (request, response) => {
  try {
    const result = await cancelJob(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ ok: true, stopped: result.stopped, job: result.job });
  } catch (error) {
    console.error("[agentos] cancel failed:", error);
    response.status(500).json({ error: "Unable to cancel that job" });
  }
});

/**
 * Runs a finished job again from scratch — the answer to "interrupted" and to
 * "failed". A new job with a fresh worktree that remembers what it replaced.
 */
app.post("/api/worker-jobs/:id/retry", async (request, response) => {
  // Optional: retry on a different worker. An unknown id is refused, never passed on.
  const requested = (request.body as { worker?: unknown } | undefined)?.worker;
  const worker = requested === undefined ? undefined : WorkerIdSchema.safeParse(requested);
  if (worker && !worker.success) {
    response.status(400).json({ error: "That isn't a worker AgentOS knows." });
    return;
  }
  const { job, error } = await retryJob(request.params.id, { worker: worker?.data });

  if (!job) {
    response.status(409).json({ error: error ?? "That job could not be retried." });
    return;
  }

  response.status(201).json({ job });
});

app.post("/api/worker-jobs/:id/steer", async (request, response) => {
  const instruction = request.body?.instruction;

  if (typeof instruction !== "string" || instruction.trim().length === 0) {
    response.status(400).json({ error: "Guidance is required" });
    return;
  }

  const result = await steerJob(request.params.id, instruction.trim());

  if (!result.ok) {
    response.status(409).json({ error: result.error });
    return;
  }

  response.json({ ok: true });
});

/**
 * Has Hermes review a finished job.
 *
 * Synchronous because a review is one question with one answer, and the console
 * has nothing useful to show between asking and hearing back.
 *
 * A pass does not approve anything. The job returns to waiting, now carrying a
 * verdict, and a person decides — which is the whole point of the step.
 */
app.post("/api/worker-jobs/:id/review", async (request, response) => {
  try {
    const result = await reviewJob(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ job: result.job, review: result.job?.review });
  } catch (error) {
    console.error("[agentos] worker review failed:", error);
    response.status(500).json({ error: "Unable to review that job" });
  }
});

/**
 * Re-runs a finished job's validation commands in its own worktree.
 *
 * A 409 when there is nothing to run or the job is still live: both are
 * conditions the operator resolves, not server faults.
 */
app.post("/api/worker-jobs/:id/validate", async (request, response) => {
  try {
    const result = await validateJob(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ job: result.job });
  } catch (error) {
    console.error("[agentos] validation run failed:", error);
    response.status(500).json({ error: "Unable to validate that job" });
  }
});

app.get("/api/worker-jobs/:id/review", async (request, response) => {
  const job = await readJob(request.params.id);

  if (!job) {
    response.status(404).json({ error: "Unknown job" });
    return;
  }

  if (!job.review) {
    response.status(404).json({ error: "That job has not been reviewed." });
    return;
  }

  response.json({ review: job.review });
});

/** The diff a review and an operator both read, straight from git. */
app.get("/api/worker-jobs/:id/diff", async (request, response) => {
  try {
    const diff = await getJobDiff(request.params.id);

    if (!diff) {
      response.status(404).json({ error: "That job has no worktree to diff." });
      return;
    }

    response.json({ diff });
  } catch (error) {
    console.error("[agentos] worker diff failed:", error);
    response.status(500).json({ error: "Unable to read that diff" });
  }
});

/**
 * Whether this job could be integrated right now, and what is stopping it.
 *
 * Read before the approve button is offered, so the console can say which
 * condition failed rather than presenting an action that would be refused.
 */
app.get("/api/worker-jobs/:id/integration", async (request, response) => {
  const job = await readJob(request.params.id);

  if (!job) {
    response.status(404).json({ error: "Unknown job" });
    return;
  }

  try {
    const detailed = await integrationBlockerDetails(job);
    response.json({
      ready: detailed.length === 0,
      // Prose for anything still reading the old shape; `details` carries the
      // cure each blocker can actually be resolved by.
      blockers: detailed.map((entry) => entry.message),
      details: detailed,
    });
  } catch (error) {
    console.error("[agentos] integration check failed:", error);
    response.status(500).json({ error: "Unable to check that job" });
  }
});

/**
 * What the implementation actually looked like, and what Hermes made of it.
 *
 * Every revision, not just the current one. "Did the revision fix what we sent
 * back?" is only answerable when the attempt before it is still there, so the
 * history is served alongside — the console shows the current verdict and can
 * offer the earlier ones beside it.
 */
app.get("/api/worker-jobs/:id/visual", async (request, response) => {
  const job = await readJob(request.params.id);

  if (!job) {
    response.status(404).json({ error: "Unknown job" });
    return;
  }

  try {
    const history = await readVerificationHistory(job.id);

    response.json({
      jobId: job.id,
      // The record on the job is the current one by definition; the file is
      // the fallback for a job written before the record carried it.
      current:
        job.visualVerification ??
        (await readVerification(job.id, job.revision ?? 1)),
      history,
    });
  } catch (error) {
    console.error("[agentos] visual verification read failed:", error);
    response.status(500).json({ error: "Unable to read that verification" });
  }
});

/**
 * One captured screenshot.
 *
 * The browser asks by revision and name; the server decides what file that is.
 * A name this system did not generate is refused rather than resolved, which
 * is why the path is built inside `visual-verification/storage` and nowhere
 * else.
 */
app.get(
  "/api/worker-jobs/:id/visual/:revision/:filename",
  async (request, response) => {
    const job = await readJob(request.params.id);

    if (!job) {
      response.status(404).json({ error: "Unknown job" });
      return;
    }

    const revision = Number(request.params.revision);

    let file: string;

    try {
      file = resolveScreenshot(job.id, revision, request.params.filename);
    } catch {
      response.status(400).json({ error: "That is not a screenshot name." });
      return;
    }

    try {
      const data = await fs.readFile(file);

      response.setHeader("Content-Type", "image/png");
      // Content at this URL never changes: a new capture is a new revision.
      response.setHeader(
        "Cache-Control",
        "private, max-age=31536000, immutable",
      );
      response.send(data);
    } catch {
      response.status(404).json({ error: "That screenshot is not on disk." });
    }
  },
);

/**
 * Runs the visual verification again, on work that has settled.
 *
 * Offered because the reasons a verification comes back `unverifiable` are
 * usually transient and fixable — Hermes was down, a port was taken, the
 * dependencies had not installed — and re-running is cheaper than re-doing the
 * work. It re-photographs the same revision rather than asking the worker for
 * anything.
 */
app.post("/api/worker-jobs/:id/visual", async (request, response) => {
  const job = await readJob(request.params.id);

  if (!job) {
    response.status(404).json({ error: "Unknown job" });
    return;
  }

  if (!wantsVisualVerification(job)) {
    response
      .status(409)
      .json({ error: "This job did not ask for visual verification." });
    return;
  }

  if (isRunning(job.id)) {
    response.status(409).json({ error: "That job is still running." });
    return;
  }

  if (job.status !== "awaiting_review" && job.status !== "changes_required") {
    response.status(409).json({
      error: `Only settled work can be re-photographed. This job is ${job.status}.`,
    });
    return;
  }

  try {
    // Recorded on the job's own log, like the pipeline's own run. A
    // re-verification that left no trace would leave an operator unable to
    // tell a fresh verdict from the one they were already looking at.
    const verification = await verifyJobVisually(job, (type, message, metadata) =>
      void appendEvent(createWorkerEvent(job.id, type, message, metadata)),
    );

    // A fresh verdict replaces the stale one on the job, and moves the job the
    // same way the pipeline would have. It never moves work forwards on its
    // own: a pass returns it to the operator, exactly as before.
    const next = {
      ...job,
      visualVerification: verification,
      status:
        verification.verdict === "changes_required"
          ? ("changes_required" as const)
          : ("awaiting_review" as const),
    };

    await saveJob(next);

    await recordActivity({
      type:
        verification.verdict === "pass"
          ? "worker.visual.passed"
          : verification.verdict === "changes_required"
            ? "worker.visual.changes"
            : "worker.visual.unverifiable",
      description: verification.summary,
      project: job.project,
      metadata: {
        jobId: job.id,
        revision: verification.revision,
        verdict: verification.verdict,
        issues: verification.issues.length,
      },
    });

    response.json({ job: next, verification });
  } catch (error) {
    console.error("[agentos] visual verification failed:", error);
    response.status(500).json({ error: "Unable to verify that job visually" });
  }
});

/**
 * Sends the visual findings back to the worker, in the same worktree.
 *
 * Separate from `/revise` because it sends a different brief: the code is
 * fine, and these are the only things to change.
 */
app.post("/api/worker-jobs/:id/visual-revision", async (request, response) => {
  try {
    const result = await requestVisualRevision(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ job: result.job });
  } catch (error) {
    console.error("[agentos] visual revision request failed:", error);
    response.status(500).json({ error: "Unable to request a visual revision" });
  }
});

/** Sends the review's findings back to the worker, in the same worktree. */
app.post("/api/worker-jobs/:id/revise", async (request, response) => {
  try {
    const result = await requestRevision(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ job: result.job });
  } catch (error) {
    console.error("[agentos] revision request failed:", error);
    response.status(500).json({ error: "Unable to request a revision" });
  }
});

/**
 * Approves the work and integrates it.
 *
 * The one route in this file that changes the operator's own repository. Every
 * precondition is re-checked inside, at the moment of acting, rather than
 * trusted from whenever the console last looked.
 */
app.post("/api/worker-jobs/:id/approve", async (request, response) => {
  try {
    const result = await approveJob(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error, job: result.job });
      return;
    }

    response.json({ job: result.job });
  } catch (error) {
    console.error("[agentos] approval failed:", error);
    response.status(500).json({ error: "Unable to approve that job" });
  }
});

/** Turns work down. Keeps everything: the record, the events, the worktree. */
app.post("/api/worker-jobs/:id/reject", async (request, response) => {
  try {
    const result = await rejectJob(request.params.id, request.body?.reason);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ job: result.job });
  } catch (error) {
    console.error("[agentos] rejection failed:", error);
    response.status(500).json({ error: "Unable to reject that job" });
  }
});

/** Throws away a settled job's checkout, once someone says so explicitly. */
app.delete("/api/worker-jobs/:id/worktree", async (request, response) => {
  try {
    const result = await discardWorktree(request.params.id);

    if (!result.ok) {
      response.status(409).json({ error: result.error });
      return;
    }

    response.json({ job: result.job });
  } catch (error) {
    console.error("[agentos] discard failed:", error);
    response.status(500).json({ error: "Unable to discard that worktree" });
  }
});

/**
 * The unified activity timeline.
 *
 * An aggregation of state that already exists — vault files, Hermes sessions,
 * Hermes' cron history, and the decisions recorded in the UI event store. It
 * costs no model call, and a source that cannot be read is named in the
 * response rather than silently omitted.
 */
app.get("/api/activity", async (request, response) => {
  const query: ActivityQuery = {
    limit: readLimit(request.query.limit),
    source: readSource(request.query.source),
    project:
      typeof request.query.project === "string" && request.query.project.trim()
        ? request.query.project.trim()
        : undefined,
  };

  try {
    response.json(await getActivity(query));
  } catch (error) {
    console.error("[agentos] activity read failed:", error);
    response.status(500).json({ error: "Unable to build the activity timeline" });
  }
});

/**
 * Records an outcome only the browser witnessed.
 *
 * A run's end arrives on the event stream, which the browser holds — so the
 * console reports it here. The event *type* is all that is accepted: the
 * wording, level and source come from the adapter's own table, so nothing can
 * write arbitrary prose into an audit trail, and only outcomes are reportable.
 */
app.post("/api/activity", async (request, response) => {
  const { type, project, runId, sessionId, description } = request.body ?? {};

  if (!isReportableType(type)) {
    response.status(400).json({ error: "Unknown activity event" });
    return;
  }

  const event = await recordActivity({
    type,
    description: typeof description === "string" ? description : undefined,
    project: typeof project === "string" ? project : undefined,
    runId: typeof runId === "string" ? runId : undefined,
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
  });

  response.json({ ok: event !== undefined });
});

/**
 * Turns a mutation failure into the right status code.
 *
 * The interesting one is 409. A stale write is not an error the operator did
 * anything wrong to cause — the file moved under them, usually because they
 * edited it in a real editor or Hermes did — so it carries the current revision
 * back, letting the console re-read and show what changed rather than only
 * saying that something did.
 */
function mutationFailed(error: unknown, response: express.Response): void {
  if (error instanceof RevisionConflictError) {
    response.status(409).json({
      error: error.message,
      code: error.code,
      path: error.path,
      revision: error.actual,
    });
    return;
  }

  if (error instanceof NotFoundError) {
    response.status(404).json({ error: error.message, code: error.code });
    return;
  }

  if (error instanceof InvalidRequestError || error instanceof DocumentInvalidError) {
    response.status(400).json({ error: error.message, code: error.code });
    return;
  }

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";

    response.status(400).json({
      error: `${where}${issue?.message ?? "Invalid request."}`,
      code: "invalid_request",
    });
    return;
  }

  console.error("[agentos] a vault mutation failed:", error);
  response.status(500).json({ error: "That change could not be saved." });
}

/**
 * Editing the workspace.
 *
 * These are **human** mutations and they take effect immediately. That is the
 * rule change this whole layer exists for: a person editing their own notes
 * does not need an agent's permission, so there is no approval step between
 * this handler and the file.
 *
 * What has not changed is the other half of the rule. Everything an *agent*
 * proposes still goes through Hermes and an approval before it reaches the
 * vault — those routes are untouched, and nothing here is reachable by a model.
 *
 * Every one of these carries an `expectedRevision` from the read that composed
 * it, so a screen that has gone stale is refused rather than silently winning.
 */
/**
 * Plan a project with Hermes. Declared before `/api/projects/:slug` routes
 * would matter — it is a POST on a fixed path — and it writes nothing: the
 * plan goes back to the operator to review, and creation is a separate
 * request they make.
 */
app.post("/api/projects/plan", async (request, response) => {
  try {
    const { brief } = ProjectPlanRequestSchema.parse(request.body ?? {});
    const plan = await planProject(brief);

    await recordActivity({
      type: "project.planned",
      description: plan.name,
    });

    response.json({ plan });
  } catch (error) {
    if (error instanceof PlanningUnavailableError) {
      response.status(503).json({ error: error.message, code: error.code });
      return;
    }

    mutationFailed(error, response);
  }
});

app.post("/api/projects", async (request, response) => {
  try {
    const input = CreateProjectRequestSchema.parse(request.body ?? {});
    const created = await createProject(input);

    await recordActivity({
      type: "project.created",
      description: created.name,
      project: created.slug,
    });

    response.status(201).json(created);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.patch("/api/projects/:slug", async (request, response) => {
  try {
    const patch = ProjectPatchRequestSchema.parse(request.body ?? {});
    const result = await patchProject({ slug: request.params.slug, ...patch });

    if (patch.configuration || patch.repoPath !== undefined) {
      await recordActivity({
        type: "project.configured",
        project: request.params.slug,
      });
    }

    response.json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/archive", async (request, response) => {
  try {
    const result = await archiveProject(request.params.slug);

    await recordActivity({
      type: "project.archived",
      project: request.params.slug,
    });

    response.json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/restore", async (request, response) => {
  try {
    const { state } = request.body ?? {};

    response.json(
      await restoreProject(
        request.params.slug,
        typeof state === "string" ? (state as never) : undefined,
      ),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * Everything the settings sheet edits, with both revisions it has to be
 * composed against. Identity comes from the portfolio, the rest from the
 * project's own file — the same split `PATCH` writes back through.
 */
app.get("/api/projects/:slug/settings", async (request, response) => {
  try {
    const summary = await findProject(request.params.slug);

    if (!summary) {
      response.status(404).json({ error: "No such project." });
      return;
    }

    const [portfolio, project] = await Promise.all([
      readPortfolioForEdit(),
      readProjectSource(request.params.slug, "PROJECT.md"),
    ]);

    response.json({
      slug: summary.slug,
      name: summary.name,
      type: summary.type,
      state: summary.state,
      priority: summary.priority,
      goal: portfolio.contents ? readPortfolioGoal(portfolio.contents, summary.slug) : undefined,
      repoPath: project?.contents ? parseRepositoryPath(project.contents) : undefined,
      configuration: parseConfiguration(project?.contents),
      revisions: { portfolio: portfolio.revision, project: project?.revision ?? "" },
    });
  } catch (error) {
    mutationFailed(error, response);
  }
});

/** Tasks, with the revision any edit to them has to be composed against. */
app.get("/api/projects/:slug/tasks", async (request, response) => {
  try {
    response.json(await readTasks(request.params.slug));
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/tasks", async (request, response) => {
  try {
    const { title, section, expectedRevision } = request.body ?? {};

    if (typeof title !== "string") {
      response.status(400).json({ error: "A task needs a title." });
      return;
    }

    const result = await createTask({
      slug: request.params.slug,
      title,
      section: typeof section === "string" ? section : undefined,
      expectedRevision:
        typeof expectedRevision === "string" ? expectedRevision : undefined,
    });

    await recordActivity({
      type: "task.created",
      description: `${result.taskId}: ${title}`,
      project: request.params.slug,
      metadata: { taskId: result.taskId },
    });

    response.status(201).json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * Several tasks, one write.
 *
 * Declared before `/tasks/:taskId` for the same reason `reorder` is.
 */
app.post("/api/projects/:slug/tasks/bulk", async (request, response) => {
  try {
    const input = BulkTaskActionSchema.parse(request.body ?? {});
    const result = await bulkTasks(request.params.slug, input);

    await recordActivity({
      type: input.action === "complete" ? "task.completed" : "task.updated",
      description: `${result.applied.length} tasks ${input.action}d`,
      project: request.params.slug,
      metadata: { taskIds: result.applied, action: input.action },
    });

    response.json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/tasks/:taskId/archive", async (request, response) => {
  try {
    const { expectedRevision } = request.body ?? {};

    response.json(
      await archiveTask({
        slug: request.params.slug,
        taskId: request.params.taskId,
        expectedRevision:
          typeof expectedRevision === "string" ? expectedRevision : undefined,
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/tasks/:taskId/restore", async (request, response) => {
  try {
    const { section, expectedRevision } = request.body ?? {};

    response.json(
      await restoreTask({
        slug: request.params.slug,
        taskId: request.params.taskId,
        section: typeof section === "string" ? section : undefined,
        expectedRevision:
          typeof expectedRevision === "string" ? expectedRevision : undefined,
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * Reordering.
 *
 * Declared before `/tasks/:taskId` because Express matches in order, and
 * `reorder` would otherwise be read as a task id.
 */
app.post("/api/projects/:slug/tasks/reorder", async (request, response) => {
  try {
    const { section, taskIds, expectedRevision } = request.body ?? {};

    if (typeof section !== "string" || !Array.isArray(taskIds)) {
      response.status(400).json({ error: "A section and an order are required." });
      return;
    }

    response.json(
      await reorderTasks({
        slug: request.params.slug,
        section,
        taskIds: taskIds.filter((id): id is string => typeof id === "string"),
        expectedRevision:
          typeof expectedRevision === "string" ? expectedRevision : undefined,
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.patch("/api/projects/:slug/tasks/:taskId", async (request, response) => {
  try {
    const { title, completed, section, position, ready, after, milestone, expectedRevision } =
      request.body ?? {};

    const shared = {
      slug: request.params.slug,
      taskId: request.params.taskId,
      expectedRevision:
        typeof expectedRevision === "string" ? expectedRevision : undefined,
    };

    // Milestone membership lives in MILESTONES.md, so it is a separate write
    // against that file's own revision (`milestoneRevision`), never the task
    // file's. A patch may carry either kind of change, or both.
    const membership =
      milestone !== undefined
        ? await assignTask(
            request.params.slug,
            request.params.taskId,
            typeof milestone === "string" && milestone.length > 0 ? milestone : undefined,
            typeof request.body?.milestoneRevision === "string"
              ? request.body.milestoneRevision
              : undefined,
          )
        : undefined;

    const touchesLine =
      title !== undefined ||
      completed !== undefined ||
      section !== undefined ||
      ready !== undefined ||
      after !== undefined;

    // Completing and reopening are their own operations rather than a raw
    // `completed` flag, because each one also decides where the task now
    // belongs — and a screen should not have to know that.
    const result = !touchesLine
      ? { taskId: request.params.taskId }
      : completed === true && section === undefined
        ? await completeTask(shared)
        : completed === false && section === undefined
          ? await reopenTask(shared)
          : await updateTask({
              ...shared,
              title: typeof title === "string" ? title : undefined,
              completed: typeof completed === "boolean" ? completed : undefined,
              section: typeof section === "string" ? section : undefined,
              position: typeof position === "number" ? position : undefined,
              ready: typeof ready === "boolean" ? ready : undefined,
              after: Array.isArray(after)
                ? after.filter((id: unknown): id is string => typeof id === "string")
                : undefined,
            });

    if (completed === true) {
      await recordActivity({
        type: "task.completed",
        description: request.params.taskId,
        project: request.params.slug,
        metadata: { taskId: request.params.taskId },
      });
    }

    response.json({ ...result, milestone: membership });
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.delete("/api/projects/:slug/tasks/:taskId", async (request, response) => {
  try {
    const expectedRevision =
      typeof request.query.expectedRevision === "string"
        ? request.query.expectedRevision
        : undefined;

    response.json(
      await deleteTask({
        slug: request.params.slug,
        taskId: request.params.taskId,
        expectedRevision,
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * The roadmap. Computed on every read from TASKS.md, MILESTONES.md and the
 * job links, so it can never disagree with the tasks it describes.
 */
app.get("/api/projects/:slug/roadmap", async (request, response) => {
  try {
    response.json(await getRoadmap(request.params.slug));
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/milestones", async (request, response) => {
  try {
    const input = CreateMilestoneRequestSchema.parse(request.body ?? {});
    const result = await createMilestone(request.params.slug, input);

    await recordActivity({
      type: "milestone.created",
      description: input.title,
      project: request.params.slug,
      metadata: { milestoneId: result.milestoneId },
    });

    response.status(201).json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/milestones/reorder", async (request, response) => {
  try {
    const { ids, expectedRevision } = request.body ?? {};

    if (!Array.isArray(ids)) {
      response.status(400).json({ error: "An order is required." });
      return;
    }

    response.json(
      await reorderMilestones(
        request.params.slug,
        ids.filter((id: unknown): id is string => typeof id === "string"),
        typeof expectedRevision === "string" ? expectedRevision : undefined,
      ),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.get("/api/projects/:slug/milestones/:id", async (request, response) => {
  try {
    const detail = await getMilestoneDetail(request.params.slug, request.params.id);

    if (!detail) {
      response.status(404).json({ error: "No such milestone." });
      return;
    }

    response.json(detail);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.patch("/api/projects/:slug/milestones/:id", async (request, response) => {
  try {
    const input = PatchMilestoneRequestSchema.parse(request.body ?? {});
    response.json(await patchMilestone(request.params.slug, request.params.id, input));
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.delete("/api/projects/:slug/milestones/:id", async (request, response) => {
  try {
    const expectedRevision =
      typeof request.query.expectedRevision === "string" ? request.query.expectedRevision : undefined;

    response.json(await deleteMilestone(request.params.slug, request.params.id, expectedRevision));
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * Completing a milestone is a human verdict. The review screen showed the
 * criteria and the count; whatever it said, this records the decision and the
 * review text the operator settled on.
 */
app.post("/api/projects/:slug/milestones/:id/complete", async (request, response) => {
  try {
    const { review, expectedRevision } = request.body ?? {};

    const result = await completeMilestone(request.params.slug, request.params.id, {
      review: typeof review === "string" ? review : undefined,
      expectedRevision: typeof expectedRevision === "string" ? expectedRevision : undefined,
    });

    await recordActivity({
      type: "milestone.completed",
      description: request.params.id,
      project: request.params.slug,
      metadata: { milestoneId: request.params.id },
    });

    response.json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

for (const [action, status] of [
  ["activate", "active"],
  ["pause", "paused"],
  ["resume", "active"],
  ["archive", "archived"],
  ["restore", "planned"],
] as const) {
  app.post(`/api/projects/:slug/milestones/:id/${action}`, async (request, response) => {
    try {
      const { expectedRevision } = request.body ?? {};

      response.json(
        await setMilestoneStatus(
          request.params.slug,
          request.params.id,
          status,
          typeof expectedRevision === "string" ? expectedRevision : undefined,
        ),
      );
    } catch (error) {
      mutationFailed(error, response);
    }
  });
}

app.put("/api/projects/:slug/milestones/:id/criteria/:index", async (request, response) => {
  try {
    const { done, expectedRevision } = request.body ?? {};
    const index = Number.parseInt(request.params.index, 10);

    if (typeof done !== "boolean" || !Number.isInteger(index) || index < 0) {
      response.status(400).json({ error: "A criterion index and a done flag are required." });
      return;
    }

    response.json(
      await setCriterion(
        request.params.slug,
        request.params.id,
        index,
        done,
        typeof expectedRevision === "string" ? expectedRevision : undefined,
      ),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

/** Hermes proposes; nothing is written. */
app.post("/api/projects/:slug/milestones/:id/plan", async (request, response) => {
  try {
    const roadmap = await getRoadmap(request.params.slug);
    const milestone = roadmap.milestones.find((entry) => entry.id === request.params.id);

    if (!milestone) {
      response.status(404).json({ error: "No such milestone." });
      return;
    }

    const directory = `projects/${request.params.slug}`;
    const [projectMarkdown, statusMarkdown, decisionsMarkdown] = await Promise.all([
      readOptionalFile(`${directory}/PROJECT.md`),
      readOptionalFile(`${directory}/STATUS.md`),
      readOptionalFile(`${directory}/DECISIONS.md`),
    ]);

    const plan = await planMilestone({
      project: request.params.slug,
      milestone,
      tasks: milestone.tasks,
      projectMarkdown,
      statusMarkdown,
      decisionsMarkdown,
    });

    await recordActivity({
      type: "milestone.planned",
      description: milestone.title,
      project: request.params.slug,
      metadata: { milestoneId: milestone.id },
    });

    response.json({ plan });
  } catch (error) {
    if (error instanceof PlanningUnavailableError) {
      response.status(503).json({ error: error.message, code: error.code });
      return;
    }

    mutationFailed(error, response);
  }
});

/**
 * Applies an edited plan: new tasks through the ordinary task mutation, filed
 * under the milestone, and criteria appended. Two files, two revisions.
 */
app.post("/api/projects/:slug/milestones/:id/apply-plan", async (request, response) => {
  try {
    const input = ApplyMilestonePlanRequestSchema.parse(request.body ?? {});
    const slug = request.params.slug;
    const milestoneId = request.params.id;

    const created: string[] = [];

    for (const task of input.tasks) {
      const result = await createTask({ slug, title: task.title, section: task.section });
      created.push(result.taskId);
    }

    const roadmap = await getRoadmap(slug);
    const milestone = roadmap.milestones.find((entry) => entry.id === milestoneId);

    if (!milestone) {
      response.status(404).json({ error: "No such milestone." });
      return;
    }

    const existing = new Set(milestone.criteria.map((criterion) => criterion.text.toLowerCase()));
    const criteria = [
      ...milestone.criteria,
      ...input.criteria
        .filter((text) => !existing.has(text.trim().toLowerCase()))
        .map((text) => ({ text: text.trim(), done: false })),
    ];

    const result = await patchMilestone(slug, milestoneId, {
      criteria,
      taskIds: [...milestone.taskIds, ...created],
    });

    await recordActivity({
      type: "milestone.plan.applied",
      description: `${milestone.title}: ${created.length} tasks, ${input.criteria.length} criteria`,
      project: slug,
      metadata: { milestoneId, taskIds: created },
    });

    response.json({ ...result, createdTaskIds: created });
  } catch (error) {
    mutationFailed(error, response);
  }
});

/** A drafted review, for the completion screen. Saved only if the operator completes with it. */
app.post("/api/projects/:slug/milestones/:id/review-draft", async (request, response) => {
  try {
    const roadmap = await getRoadmap(request.params.slug);
    const milestone = roadmap.milestones.find((entry) => entry.id === request.params.id);

    if (!milestone) {
      response.status(404).json({ error: "No such milestone." });
      return;
    }

    const directory = `projects/${request.params.slug}`;
    const [statusMarkdown, decisionsMarkdown] = await Promise.all([
      readOptionalFile(`${directory}/STATUS.md`),
      readOptionalFile(`${directory}/DECISIONS.md`),
    ]);

    const review = await draftMilestoneReview({
      project: request.params.slug,
      milestone,
      tasks: milestone.tasks,
      statusMarkdown,
      decisionsMarkdown,
    });

    response.json({ review });
  } catch (error) {
    if (error instanceof PlanningUnavailableError) {
      response.status(503).json({ error: error.message, code: error.code });
      return;
    }

    mutationFailed(error, response);
  }
});

/**
 * Documents: the vault's under `docs/` and `artifacts/`, and the repository's
 * own, listed side by side and never conflated.
 */
/**
 * A project's repository: branches, working tree, recent commits, job pins.
 *
 * Total by design — a project that links no repository still answers, with
 * `unavailable` saying why, because the page has to render either way.
 */
app.get("/api/projects/:slug/repository", async (request, response) => {
  try {
    response.json(await readRepositoryStatus(request.params.slug));
  } catch (error) {
    console.error("[agentos] could not read repository:", error);
    response.status(500).json({ error: "Unable to read that repository" });
  }
});

/** The commit graph: lanes, edges and refs, newest first. */
app.get("/api/projects/:slug/repository/graph", async (request, response) => {
  try {
    const repositoryPath = await repositoryPathFor(request.params.slug);
    if (!repositoryPath) {
      response.json({ commits: [], lanes: 1, truncated: false, workersHidden: true, unavailable: "No local repository is linked to this project." });
      return;
    }
    response.json(
      await readGitGraph(repositoryPath, {
        limit: Number(request.query.limit) || undefined,
        includeWorkers: request.query.workers === "1",
      }),
    );
  } catch (error) {
    console.error("[agentos] could not read the commit graph:", error);
    response.status(500).json({ error: "Unable to read that repository's history" });
  }
});

/**
 * One write against a project's real repository.
 *
 * The action is parsed against a closed schema before anything runs, so an
 * unknown `kind` is a 400 rather than something that reaches git. A refusal —
 * a dirty tree, a running job, a name git would read as a flag — is a 409 and
 * carries the reason verbatim: these are conditions the operator resolves,
 * not errors.
 */
app.post("/api/projects/:slug/repository/action", async (request, response) => {
  const parsed = RepositoryActionSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "That is not an action this can run." });
    return;
  }

  try {
    const result = await runRepositoryAction(request.params.slug, parsed.data);
    response.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    console.error("[agentos] repository action failed:", error);
    response.status(500).json({ error: "Unable to run that action" });
  }
});

app.get("/api/projects/:slug/documents", async (request, response) => {
  try {
    response.json(await getProjectDocuments(request.params.slug));
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * One document's body. The path comes from the request and is validated
 * against the origin's root before anything is read.
 */
app.get("/api/projects/:slug/document", async (request, response) => {
  const relativePath = typeof request.query.path === "string" ? request.query.path : "";
  const origin = request.query.origin === "repo" ? "repo" : "agentos";

  if (!relativePath) {
    response.status(400).json({ error: "A document path is required." });
    return;
  }

  try {
    const document = await readProjectDocument(request.params.slug, relativePath, origin);

    if (!document) {
      response.status(404).json({ error: "No such document." });
      return;
    }

    response.json(document);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/documents", async (request, response) => {
  try {
    const input = CreateDocumentRequestSchema.parse(request.body ?? {});
    const result = await createDocument(request.params.slug, input);

    await recordActivity({
      type: input.source && input.source !== "human" ? "document.created" : "document.saved",
      description: `${input.title}${input.taskId ? ` (${input.taskId})` : ""}`,
      project: request.params.slug,
      metadata: { path: result.artifact.relativePath, type: input.type, taskId: input.taskId, runId: input.runId },
    });

    response.status(201).json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

/** Hermes drafts a document. Nothing is written until the operator saves it. */
app.post("/api/projects/:slug/documents/propose", async (request, response) => {
  try {
    const { brief, taskId } = DocumentProposalRequestSchema.parse(request.body ?? {});
    const slug = request.params.slug;
    const directory = `projects/${slug}`;

    const [projectMarkdown, statusMarkdown, decisionsMarkdown, documents, tasks] = await Promise.all([
      readOptionalFile(`${directory}/PROJECT.md`),
      readOptionalFile(`${directory}/STATUS.md`),
      readOptionalFile(`${directory}/DECISIONS.md`),
      getProjectDocuments(slug).catch(() => undefined),
      taskId ? readTasks(slug).catch(() => undefined) : undefined,
    ]);

    const proposal = await proposeDocument({
      project: slug,
      brief,
      taskId: taskId?.toUpperCase(),
      taskTitle: tasks?.tasks.find((task) => task.id === taskId?.toUpperCase())?.title,
      projectMarkdown,
      statusMarkdown,
      decisionsMarkdown,
      existing: documents?.agentos.map((document) => document.title),
    });

    response.json({ proposal });
  } catch (error) {
    if (error instanceof PlanningUnavailableError) {
      response.status(503).json({ error: error.message, code: error.code });
      return;
    }

    mutationFailed(error, response);
  }
});

/** The newest documents across the portfolio, for Mission Control. */
app.get("/api/documents/recent", async (request, response) => {
  try {
    const limit = typeof request.query.limit === "string" ? Number.parseInt(request.query.limit, 10) : 6;
    const projects = await getProjects("all");

    response.json({
      documents: await listRecentDocuments(projects, Number.isFinite(limit) ? limit : 6),
    });
  } catch (error) {
    console.error("[agentos] recent documents failed:", error);
    response.status(500).json({ error: "Unable to list recent documents" });
  }
});

/** Every document and decision across the portfolio, for Knowledge. */
app.get("/api/knowledge", async (_request, response) => {
  try {
    response.json(await getKnowledge(await getProjects("all")));
  } catch (error) {
    console.error("[agentos] knowledge failed:", error);
    response.status(500).json({ error: "Unable to list knowledge" });
  }
});

/** Notes waiting in `inbox/CAPTURE.md`. */
app.get("/api/capture", async (_request, response) => {
  try {
    response.json({ items: parseCaptures(await readOptionalFile(CAPTURE_PATH)) });
  } catch (error) {
    console.error("[agentos] capture read failed:", error);
    response.status(500).json({ error: "Unable to read captured notes" });
  }
});

/** The inbox with Hermes' suggested home for each note, and the homes there are. */
app.get("/api/capture/triage", async (_request, response) => {
  try {
    response.json(await readTriage());
  } catch (error) {
    console.error("[agentos] capture triage read failed:", error);
    response.status(500).json({ error: "Unable to read captured notes" });
  }
});

/** Asks Hermes where each unsorted note belongs. One call; answers are cached per note. */
app.post("/api/capture/suggest", async (_request, response) => {
  try {
    response.json(await suggestHomes());
  } catch (error) {
    if (error instanceof CaptureTriageError) {
      response.status(502).json({ error: error.message });
      return;
    }
    mutationFailed(error, response);
  }
});

/** Files a note where the person chose and takes it out of the inbox. */
app.post("/api/capture/:id/accept", async (request, response) => {
  const body = CaptureAcceptSchema.safeParse({ ...(request.body ?? {}), id: request.params.id });
  if (!body.success) {
    response.status(400).json({ error: "That is not a place a note can be filed." });
    return;
  }
  try {
    response.json(await acceptCapture(body.data.id, body.data.destination));
  } catch (error) {
    if (error instanceof CaptureTriageError) {
      response.status(409).json({ error: error.message });
      return;
    }
    mutationFailed(error, response);
  }
});

app.delete("/api/capture/:id", async (request, response) => {
  try {
    await deleteCapture(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    if (error instanceof CaptureTriageError) {
      response.status(409).json({ error: error.message });
      return;
    }
    mutationFailed(error, response);
  }
});

/**
 * Captures a note. Appends one line; no model is consulted, so this answers
 * as fast as the disk does and cannot fail because Hermes is down.
 */
app.post("/api/capture", async (request, response) => {
  try {
    const body = CaptureRequestSchema.parse(request.body);
    const result = await captureNote(body.note, body.workspace);
    response.status(201).json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.get("/api/projects/:slug/decisions", async (request, response) => {
  try {
    response.json(await readDecisions(request.params.slug));
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.post("/api/projects/:slug/decisions", async (request, response) => {
  try {
    const { title, body, decidedOn, expectedRevision } = request.body ?? {};

    if (typeof title !== "string" || typeof body !== "string") {
      response.status(400).json({ error: "A decision needs a title and a body." });
      return;
    }

    response.json(
      await writeDecision({
        slug: request.params.slug,
        title,
        body,
        decidedOn: typeof decidedOn === "string" ? decidedOn : undefined,
        expectedRevision:
          typeof expectedRevision === "string" ? expectedRevision : undefined,
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.delete("/api/projects/:slug/decisions/:title", async (request, response) => {
  try {
    response.json(
      await deleteDecision({
        slug: request.params.slug,
        title: decodeURIComponent(request.params.title),
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

/** The two prose fields the overview edits in place. */
app.get("/api/projects/:slug/prose", async (request, response) => {
  try {
    const [status, purpose, milestone] = await Promise.all([
      readStatus(request.params.slug),
      readPurpose(request.params.slug),
      readMilestone(request.params.slug),
    ]);

    response.json({ status, purpose, milestone });
  } catch (error) {
    mutationFailed(error, response);
  }
});

app.put("/api/projects/:slug/prose/:field", async (request, response) => {
  try {
    const { body, expectedRevision } = request.body ?? {};

    if (typeof body !== "string") {
      response.status(400).json({ error: "A body is required." });
      return;
    }

    const field = request.params.field;

    if (!isProseField(field)) {
      response.status(404).json({ error: "No such field." });
      return;
    }

    response.json(
      await writeProse(field, {
        slug: request.params.slug,
        body,
        expectedRevision:
          typeof expectedRevision === "string" ? expectedRevision : undefined,
      }),
    );
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * The markdown underneath.
 *
 * The console is not a replacement for the vault, and hiding the files it edits
 * would make it one. A closed list of four filenames, never a path.
 */
app.get("/api/projects/:slug/source/:file", async (request, response) => {
  try {
    const source = await readProjectSource(
      request.params.slug,
      request.params.file,
    );

    if (!source) {
      response.status(404).json({ error: "No such project file." });
      return;
    }

    response.json(source);
  } catch (error) {
    mutationFailed(error, response);
  }
});

/** Recent human edits, and putting one back. */
/**
 * Global search. Read-only, over the same readers the screens use, so a hit
 * is never something the operator could not have found by navigating.
 */
app.get("/api/search", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q : "";
  const limit =
    typeof request.query.limit === "string" ? Number.parseInt(request.query.limit, 10) : undefined;

  try {
    response.json(await search(query, Number.isFinite(limit) ? limit : undefined));
  } catch (error) {
    console.error("[agentos] search failed:", error);
    response.status(500).json({ error: "Search is unavailable right now." });
  }
});

app.get("/api/backups", async (_request, response) => {
  response.json({ backups: await listBackups(20) });
});

app.post("/api/backups/:id/restore", async (request, response) => {
  try {
    const result = await restoreBackup(request.params.id);

    if (!result) {
      response.status(404).json({ error: "That edit can no longer be undone." });
      return;
    }

    response.json(result);
  } catch (error) {
    mutationFailed(error, response);
  }
});

/**
 * Operations.
 *
 * Where the tokens went, what it cost, and what the workforce is doing. Read
 * only — nothing here starts, stops or bills anything, and the ledger it reads
 * is telemetry rather than truth: every figure could be recomputed from the
 * job store and the providers if the database were thrown away.
 */
app.get("/api/operations", async (request, response) => {
  try {
    const range = UsageRangeSchema.safeParse(request.query.range);
    response.json(await getOperationsData(new Date(), range.success ? range.data : "month"));
  } catch (error) {
    console.error("[agentos] operations read failed:", error);
    response.status(500).json({ error: "Unable to read operations" });
  }
});

/**
 * The one-line version, for Mission Control.
 *
 * A separate, much cheaper read. Building the whole Operations payload to put
 * two numbers on the morning's first screen would make every page load pay for
 * a report nobody asked for.
 */
app.get("/api/usage/summary", async (_request, response) => {
  try {
    response.json(await getUsageSummary());
  } catch (error) {
    console.error("[agentos] usage summary failed:", error);
    response.status(500).json({ error: "Unable to read usage" });
  }
});

app.get("/api/operations/agents/:id", async (request, response) => {
  try {
    const agent = await getAgentDetail(request.params.id);

    if (!agent) {
      response.status(404).json({ error: "No such agent" });
      return;
    }

    response.json({ agent });
  } catch (error) {
    console.error("[agentos] agent detail failed:", error);
    response.status(500).json({ error: "Unable to read that agent" });
  }
});

/**
 * What one task cost, step by step.
 *
 * Scoping, implementation, review, visual review and every revision as its own
 * line — the view that answers what a feature actually costs to build with
 * agents rather than what one run of one worker cost.
 */
app.get("/api/usage/tasks/:taskId", (request, response) => {
  try {
    const records = readUsage({ taskId: request.params.taskId });

    response.json({ task: taskUsage(records, request.params.taskId) });
  } catch (error) {
    console.error("[agentos] task usage failed:", error);
    response.status(500).json({ error: "Unable to read that task's usage" });
  }
});

/**
 * Subscriptions.
 *
 * Manual, because a wrong-but-automatic figure is harder to notice than a
 * stale typed one, and because five billing integrations is days of work to
 * learn numbers the operator already knows.
 */
app.get("/api/subscriptions", (_request, response) => {
  response.json({ subscriptions: listSubscriptions() });
});

app.post("/api/subscriptions", (request, response) => {
  const parsed = SubscriptionSchema.partial({ id: true }).safeParse(
    request.body ?? {},
  );

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid subscription" });
    return;
  }

  const subscription = saveSubscription(parsed.data);

  if (!subscription) {
    response.status(500).json({ error: "Unable to save the subscription" });
    return;
  }

  response.status(201).json({ subscription });
});

app.delete("/api/subscriptions/:id", (request, response) => {
  response.json({ ok: deleteSubscription(request.params.id) });
});

/**
 * Budgets.
 *
 * Advisory. Crossing one warns and then asks for attention; it never kills a
 * running job — a worker stopped halfway through an implementation because a
 * counter crossed a threshold costs far more than the dollar it saved.
 */
app.get("/api/budgets", (_request, response) => {
  response.json({ budgets: listBudgets() });
});

app.put("/api/budgets", (request, response) => {
  const parsed = UsageBudgetSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid budget" });
    return;
  }

  const budget = saveBudget(parsed.data);

  if (!budget) {
    response.status(500).json({ error: "Unable to save the budget" });
    return;
  }

  response.json({ budget });
});

app.delete("/api/budgets/:scope", (request, response) => {
  const scopeId =
    typeof request.query.scopeId === "string" ? request.query.scopeId : "";

  response.json({ ok: deleteBudget(request.params.scope, scopeId) });
});

/**
 * The validation sprint.
 *
 * Instrumentation, not workflow. These four routes are the whole of it, and
 * none of them can start, route, review, approve or integrate anything — the
 * sprint measures the pipeline from beside it, and a measurement that could
 * reach into what it measures would stop being one.
 *
 * The read joins what a person recorded onto what the job store already knows,
 * so nothing here is a second copy of a revision count or a cost.
 */
app.get("/api/validation", async (_request, response) => {
  try {
    response.json(await getValidationSprint());
  } catch (error) {
    console.error("[agentos] validation sprint read failed:", error);
    response.status(500).json({ error: "Unable to read the validation sprint" });
  }
});

app.post("/api/validation/tasks", async (request, response) => {
  const parsed = StartValidationTaskSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid validation task" });
    return;
  }

  try {
    response.status(201).json({ task: await startTask(parsed.data) });
  } catch (error) {
    console.error("[agentos] could not start a validation task:", error);
    response.status(500).json({ error: "Unable to start the validation task" });
  }
});

/**
 * Records what happened to a task.
 *
 * An intervention appends; nothing in this request shape can shorten the list.
 * That is the point of the metric — a count of the times a person had to step
 * in is only worth trending if it cannot be quietly revised downward.
 */
app.patch("/api/validation/tasks/:id", async (request, response) => {
  const parsed = UpdateValidationTaskSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid validation task update" });
    return;
  }

  try {
    const task = await updateValidationTask(request.params.id, parsed.data);

    if (!task) {
      response.status(404).json({ error: "No such validation task" });
      return;
    }

    response.json({ task });
  } catch (error) {
    console.error("[agentos] could not update a validation task:", error);
    response.status(500).json({ error: "Unable to update the validation task" });
  }
});

/**
 * Files one friction report.
 *
 * The category is a closed vocabulary and the note is kept verbatim — nothing
 * classifies, summarises or acts on either. Reporting is meant to cost two
 * seconds and interrupt nothing, so a failure to record is logged rather than
 * returned as an error the operator has to deal with mid-review.
 */
app.post("/api/validation/friction", async (request, response) => {
  const parsed = ReportFrictionSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    response.status(400).json({ error: "Unknown friction category" });
    return;
  }

  const friction = await reportFriction(parsed.data);

  if (!friction) {
    response.status(500).json({ error: "Unable to record the friction report" });
    return;
  }

  response.status(201).json({ friction });
});

/**
 * The scheduled jobs Hermes already runs.
 *
 * Displaying automations costs no model call — this is a CLI read, not a
 * run. The only changes AgentOS makes are pause / resume / run-now on a job
 * and pause / resume on the curator; creating and editing stay in Hermes.
 */
app.get("/api/automations", async (_request, response) => {
  try {
    response.json(await getAutomations());
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** Hermes' other automation surfaces: curator, kanban, hooks, webhooks, scheduler, emergency stop. */
app.get("/api/hermes/automation-surfaces", async (_request, response) => {
  try {
    response.json(await getAutomationSurfaces());
  } catch (error) {
    respondWithFailure(response, error);
  }
});

app.post("/api/hermes/curator/:control", async (request, response) => {
  const control = CuratorControlSchema.safeParse(request.params.control);
  if (!control.success) {
    response.status(400).json({ error: "The curator can only be paused or resumed from here." });
    return;
  }
  try {
    await controlCurator(control.data);
    response.json({ ok: true });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** Pause, resume, or run a scheduled job now. */
app.post("/api/automations/:id/:control", async (request, response) => {
  const control = AutomationControlSchema.safeParse(request.params.control);
  if (!control.success) {
    response.status(400).json({ error: "A job can only be paused, resumed, or run from here." });
    return;
  }
  try {
    if (!(await controlAutomation(request.params.id, control.data))) {
      response.status(404).json({ error: "Unknown automation" });
      return;
    }
    response.json({ ok: true });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** One automation, with the execution attempts Hermes has recorded for it. */
app.get("/api/automations/:id", async (request, response) => {
  try {
    // The id is matched against Hermes' own listing before it is used, so an
    // unknown id is a 404 rather than an argument passed to the CLI.
    const detail = await getAutomation(request.params.id);

    if (!detail) {
      response.status(404).json({ error: "Unknown automation" });
      return;
    }

    response.json(detail);
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** Whether Hermes is configured. Never contacts Hermes. */
app.get("/api/agent/status", (_request, response) => {
  response.json(getHermesStatus());
});

app.post("/api/agent/message", async (request, response) => {
  const { message, project } = request.body ?? {};

  if (typeof message !== "string" || message.trim().length === 0) {
    response.status(400).json({ error: "Message is required" });
    return;
  }

  // Naming the project lets Hermes load that project's context from the vault
  // itself, rather than the UI trying to assemble it.
  const prompt =
    typeof project === "string" && project.trim().length > 0
      ? `Current project: ${project}\n\n${message}`
      : message;

  try {
    const content = await sendToHermes(prompt, {
      operation: "chat",
      project: typeof project === "string" ? project : undefined,
    });

    response.json({
      message: {
        id: randomUUID(),
        role: "assistant",
        content,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** Classified failure response, shared by every Hermes-backed endpoint. */
function respondWithFailure(response: express.Response, error: unknown): void {
  const isKnown = error instanceof HermesError;
  if (!isKnown) console.error("[agentos] hermes request failed:", error);

  response
    .status(isKnown && error.reason === "not-configured" ? 503 : 502)
    .json({
      error: isKnown ? error.message : "Unable to contact Hermes",
      reason: isKnown ? error.reason : "failed",
    });
}

/** What this Hermes build supports. The UI gates features on this. */
app.get("/api/agent/capabilities", async (_request, response) => {
  try {
    response.json(await getCapabilities());
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/**
 * The skills this Hermes actually has.
 *
 * Quick actions and the command palette are built from this, so adding a skill
 * to Hermes makes it appear in the console without a frontend change. An
 * unreachable Hermes reports none, and the console falls back to its baseline.
 */
app.get("/api/agent/skills", async (_request, response) => {
  try {
    const skills = await getSkills();
    response.json({ skills, discovered: skills.length > 0 });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

app.post("/api/agent/runs", async (request, response) => {
  const { message, project, spoken } = request.body ?? {};

  if (typeof message !== "string" || message.trim().length === 0) {
    response.status(400).json({ error: "Message is required" });
    return;
  }

  // Said out loud to Jarvis: ask for an answer worth hearing. The style is
  // fixed here, so the flag can only ever add this one known line.
  const said = spoken === true ? `${SPOKEN_STYLE}\n\n${message}` : message;
  const input =
    typeof project === "string" && project.trim().length > 0
      ? `Current project: ${project}\n\n${said}`
      : said;

  try {
    // The session is resolved here, from the project, so a run can never be
    // attached to another project's conversation lane.
    const session = await resolveProjectSession({
      project: typeof project === "string" ? project : undefined,
    });

    const run = await startRun({ input, sessionId: session.id });

    // The adapter is the only place that knows a run began. Its end is known
    // to whoever holds the event stream, and is reported separately.
    await recordActivity({
      type: "run.started",
      description: input.split("\n").at(-1)?.slice(0, 160),
      project: typeof project === "string" ? project : undefined,
      runId: run.runId,
      sessionId: session.id,
    });

    response.json(run);
  } catch (error) {
    respondWithFailure(response, error);
  }
});

app.get("/api/agent/runs/:id", async (request, response) => {
  try {
    response.json(await getRun(request.params.id));
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/**
 * Forwards the run's SSE stream.
 *
 * The browser cannot attach a bearer token to an `EventSource`, so the stream
 * is proxied here. Bytes are passed through untouched — events are interpreted
 * in the browser, which keeps unknown event types working without a server
 * change.
 */
app.get("/api/agent/runs/:id/events", async (request, response) => {
  const upstream = new AbortController();
  request.on("close", () => upstream.abort());

  let stream: Response;

  try {
    stream = await openRunEvents(request.params.id, upstream.signal);
  } catch (error) {
    respondWithFailure(response, error);
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();

  try {
    if (!stream.body) throw new Error("Hermes returned no event stream");

    for await (const chunk of stream.body) {
      response.write(chunk);
    }
  } catch {
    // A closed client or a dropped upstream both simply end the stream.
  } finally {
    response.end();
  }
});

app.post("/api/agent/runs/:id/stop", async (request, response) => {
  try {
    const run = await stopRun(request.params.id);
    response.json(run ?? { runId: request.params.id, status: "stopping" });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** How each decision is worded in the audit trail. */
const APPROVAL_SCOPE: Record<ApprovalDecision, string> = {
  once: "This action only",
  session: "For this session",
  always: "From now on",
  deny: "Refused",
};

/**
 * Records a decision on a pending approval.
 *
 * The system's only write path, and it writes nothing itself: it forwards a
 * decision to Hermes, which is what actually acts. The adapter stays read-only,
 * so no change can reach the vault without passing this gate.
 */
app.post("/api/agent/runs/:runId/approval", async (request, response) => {
  const { requestId, decision } = request.body ?? {};

  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    response.status(400).json({ error: "An approval request id is required" });
    return;
  }

  const choice = readDecision(decision);

  if (!choice) {
    response.status(400).json({ error: "Unknown approval decision" });
    return;
  }

  try {
    await respondToApproval(request.params.runId, requestId.trim(), choice);

    // Recorded only after Hermes acknowledged it: the audit trail must not
    // claim a decision that never landed.
    await recordActivity({
      type: choice === "deny" ? "approval.denied" : "approval.accepted",
      description: APPROVAL_SCOPE[choice],
      runId: request.params.runId,
    });

    response.json({ ok: true, runId: request.params.runId, decision: choice });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

app.post("/api/agent/runs/:id/steer", async (request, response) => {
  const { message } = request.body ?? {};

  if (typeof message !== "string" || message.trim().length === 0) {
    response.status(400).json({ error: "Guidance is required" });
    return;
  }

  try {
    await steerRun(request.params.id, message.trim());
    response.json({ ok: true });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

function projectParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** The active session for a project, created on first use. */
app.get("/api/agent/session", async (request, response) => {
  try {
    response.json(
      await resolveProjectSession({
        project: projectParam(request.query.project),
      }),
    );
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** The canonical transcript, read from Hermes rather than reconstructed here. */
app.get("/api/agent/session/messages", async (request, response) => {
  try {
    const session = await resolveProjectSession({
      project: projectParam(request.query.project),
    });

    response.json({
      sessionId: session.id,
      messages: await getSessionMessages(session.id),
    });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** Starts a fresh session. The previous one stays in Hermes. */
app.post("/api/agent/session/new", async (request, response) => {
  const project = projectParam(request.body?.project);

  try {
    const session = await resolveProjectSession({ project, forceNew: true });

    await recordActivity({
      type: "session.created",
      project,
      sessionId: session.id,
    });

    response.json(session);
  } catch (error) {
    respondWithFailure(response, error);
  }
});

app.post("/api/agent/session/fork", async (request, response) => {
  const project = projectParam(request.body?.project);

  try {
    const session = await forkProjectSession({ project });

    await recordActivity({
      type: "session.forked",
      project,
      sessionId: session.id,
    });

    response.json(session);
  } catch (error) {
    respondWithFailure(response, error);
  }
});

/** Recent Hermes sessions, for the session history control. */
app.get("/api/agent/sessions", async (_request, response) => {
  try {
    response.json({ sessions: await listSessions() });
  } catch (error) {
    respondWithFailure(response, error);
  }
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  
  if (url.pathname.startsWith("/api/coder/terminal/ws/")) {
    const pathToken = url.pathname.replace("/api/coder/terminal/ws/", "");
    const token = pathToken || null;
    
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleTerminalWebSocket(ws, request, token);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AgentOS data adapter: http://${HOST}:${PORT}`);
  console.log(`Vault: ${agentOSRoot()}`);
  startTrendingTracker();
  // Indexes the vault and watches it; an unplugged drive is reported, not recreated.
  void memoryService().start().then(() => {
    const status = memoryService().status();
    console.log(`[memory] ${status.state}: ${status.notes} notes, ${status.links} links${status.reason ? ` (${status.reason})` : ""}`);
  });

  // Jobs run inside this process, so a restart kills them. Settle whatever the
  // last process left claiming to be live, then start watching for silence.
  void reconcileInterruptedJobs().then((interrupted) => {
    if (interrupted.length > 0) {
      console.log(
        `[agentos] ${interrupted.length} worker job${interrupted.length === 1 ? "" : "s"} marked interrupted from the previous run: ${interrupted.map((job) => job.id).join(", ")}`,
      );
    }
  });

  // Operator runs are held in this process too: one caught mid-run is marked
  // stopped with what it had finished, never resumed.
  void reconcileOperatorRuns().catch((error: unknown) => {
    console.error("[agentos] could not settle interrupted operator runs:", error);
  });

  startStallWatch();
  startOutreachSyncTimer();
  // Finance's monthly review writes itself once a month is over. See server/finance/monthly-review.ts.
  startMonthlyReviewSchedule();
});

function cleanupCoder() {
  console.log("[coder] Cleaning up terminals...");
  killAllTerminals();
}

process.on("SIGINT", () => {
  cleanupCoder();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupCoder();
  process.exit(0);
});

/**
 * Going down cleanly.
 *
 * `tsx watch` sends SIGTERM before every restart, so in development this runs
 * on every saved server file. Live jobs are marked interrupted with the reason
 * before the process exits, so the console sees a failure it can retry rather
 * than a job that says "running" forever.
 */
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await interruptRunningJobs(`AgentOS stopped (${signal}) while this job was running`);
  } catch (error) {
    console.error("[agentos] could not settle running jobs on shutdown:", error);
  } finally {
    process.exit(0);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(signal));
}
