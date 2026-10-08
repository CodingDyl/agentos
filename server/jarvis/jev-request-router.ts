import { randomUUID } from "node:crypto";
import {
  JARVIS_ROUTING_VERSION,
  type JarvisConverseRequest,
  type JarvisConverseResponse,
  type JarvisJob,
  type JarvisOutcome,
  type JarvisRequestProfile,
  type JarvisRouteSummary,
} from "../../shared/jarvis-routing-types";
import { resolveOutputReference, type JarvisConversation, type JarvisConversationStore } from "./jarvis-conversation-store";
import type { JarvisModelClient } from "./jarvis-model-client";
import { describeModel, type JarvisRoutingConfig } from "./jarvis-routing-config";
import type { JarvisWorker, JarvisWorkerContext, JarvisWorkerResult, JarvisWorkerRegistry } from "./jarvis-worker-registry";
import { profileRequest } from "./jev-request-profiler";

/**
 * Jev: what Jarvis does with a sentence.
 *
 *   pending action + "confirm"  → execute it (deterministic; no model involved)
 *   otherwise                   → one quick-model profile, validated, then:
 *     clarify                   → ask the one question
 *     chat / simple answer      → the profile's own direct_response
 *     deep tool-free question   → the strong model (or Hermes)
 *     retrieve / task / act     → the registered worker it names
 *     no suitable worker        → say so
 *
 * Delegated work runs as a job. If it finishes within `inlineWaitMs` the
 * answer comes back at once; otherwise Jarvis acknowledges it and the browser
 * polls the job for the real outcome.
 */

/**
 * Every prepared action here is external, so, as on Operator, it takes the
 * word "confirm": a mis-heard "yes" must not be able to send anything.
 */
const CONFIRM = /^(yes[,!.]?\s*)?(confirm(ed)?|i confirm)( please)?[.!]?$/i;
const CANCEL = /^(no|nope|cancel( it| that)?|don'?t( send it)?|stop|never ?mind|forget it|abort)[.!]?$/i;
/** Two steps where the second changes something outside: clarified before anything runs. */
const TASK_THEN_ACT = /\b(draft|write|prepare|create|make)\b.{1,80}\b(and|then|&)\s+(then\s+)?(send|email|post|publish|submit|share)\b/i;

const MAX_JOBS = 100;

export interface JarvisRouteLog {
  requestId: string;
  conversationId: string;
  version: string;
  outcome: JarvisOutcome;
  intent?: string;
  complexity?: string;
  executionPolicy?: string;
  workerId?: string;
  model?: string;
  decidedBy: JarvisRouteSummary["decidedBy"];
  modelCalls: number;
  durationMs: number;
  jobId?: string;
  reason?: string;
}

export interface JevRequestRouterDeps {
  registry: JarvisWorkerRegistry;
  store: JarvisConversationStore;
  models: (config: JarvisRoutingConfig) => JarvisModelClient;
  config: () => JarvisRoutingConfig;
  /**
   * Where decisions go. Ids, labels, timings: never what was said. The
   * default follows the server's console convention.
   */
  log?: (entry: JarvisRouteLog) => void;
  now?: () => number;
}

interface JobEntry {
  job: JarvisJob;
  conversationId: string;
  done: Promise<void>;
}

function normalise(message: string): string {
  return message.replace(/^\s*(?:(?:hey|ok|okay)\s+)?jarvis\b[\s,.!:;-]*/i, "").trim().replace(/\s+/g, " ");
}

function defaultLog(entry: JarvisRouteLog): void {
  console.info("[jarvis] route", entry);
}

export class JevRequestRouter {
  private readonly jobs = new Map<string, JobEntry>();
  private readonly now: () => number;
  private readonly log: (entry: JarvisRouteLog) => void;

  constructor(private readonly deps: JevRequestRouterDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? defaultLog;
  }

  getJob(jobId: string, conversationId: string): JarvisJob | undefined {
    const entry = this.jobs.get(jobId);
    return entry && entry.conversationId === conversationId ? entry.job : undefined;
  }

  /** Resolves once the job has settled. For tests and the smoke script. */
  async settled(jobId: string): Promise<JarvisJob | undefined> {
    const entry = this.jobs.get(jobId);
    if (!entry) return undefined;
    await entry.done;
    return entry.job;
  }

  async converse(request: JarvisConverseRequest): Promise<JarvisConverseResponse> {
    const requestId = randomUUID();
    const started = this.now();
    const config = this.deps.config();
    const { conversationId } = request;
    const message = request.message.trim();

    let modelCalls = 0;
    const finish = (
      outcome: JarvisOutcome,
      reply: string,
      route: JarvisRouteSummary,
      extra: Partial<Pick<JarvisConverseResponse, "display" | "job" | "handoff">> & { reason?: string; outputId?: string } = {},
    ): JarvisConverseResponse => {
      const { reason, outputId, ...rest } = extra;
      if (outcome !== "not_configured") {
        // A job's reply is recorded when the job settles, not as its acknowledgement.
        if (outcome !== "delegated") this.deps.store.addTurn(conversationId, { role: "assistant", text: reply, outputId });
      }
      this.log({
        requestId,
        conversationId,
        version: JARVIS_ROUTING_VERSION,
        outcome,
        intent: route.intent,
        complexity: route.complexity,
        executionPolicy: route.executionPolicy,
        workerId: route.workerId,
        model: route.model,
        decidedBy: route.decidedBy,
        modelCalls,
        durationMs: this.now() - started,
        jobId: rest.job?.id,
        reason,
      });
      return { requestId, conversationId, outcome, reply, route, ...rest };
    };

    if (!config.quick) {
      return finish("not_configured", "Jev routing is off: no quick model is configured.", { decidedBy: "none" });
    }

    const models = this.deps.models(config);
    const conversation = this.deps.store.get(conversationId);
    const plain = normalise(message);

    // 1. An action waiting for you. Only these exact words act on it.
    const pending = conversation.pendingAction;
    if (pending) {
      this.deps.store.clearPendingAction(conversationId);
      if (CONFIRM.test(plain)) {
        this.deps.store.addTurn(conversationId, { role: "user", text: message });
        const worker = this.deps.registry.get(pending.workerId);
        const route: JarvisRouteSummary = { intent: "act", workerId: pending.workerId, decidedBy: "confirmation" };
        if (!worker?.executeConfirmed) return finish("failed", "That action can no longer be run. Nothing was done.", route, { reason: "worker-missing" });
        const output = pending.outputId ? conversation.outputs.find((entry) => entry.id === pending.outputId) : undefined;
        const context = this.workerContext(conversationId, message, {}, conversation, models, config, output);
        const execute = worker.executeConfirmed.bind(worker);
        return this.runAsJob(worker, () => execute({ ...context, pendingInputs: pending.inputs }), config, route, finish, conversationId);
      }
      if (CANCEL.test(plain)) {
        this.deps.store.addTurn(conversationId, { role: "user", text: message });
        return finish("answered", `Cancelled, nothing was done. (${pending.summary})`, { decidedBy: "confirmation" });
      }
      // Anything else moves on; the prepared action is dropped, never kept waiting silently.
    }

    // 2. One profile from the quick model (retry and fallback inside).
    const profiled = await profileRequest({ message, conversation, registry: this.deps.registry, config, models, now: new Date(this.now()) });
    modelCalls += profiled.calls;
    this.deps.store.addTurn(conversationId, { role: "user", text: message });

    if (!profiled.ok) {
      return finish("failed", `I couldn't work out how to handle that, so I haven't done anything. ${profiled.reason}`, { decidedBy: "none" }, { reason: "profile-failed" });
    }

    const { profile } = profiled;
    const route: JarvisRouteSummary = {
      intent: profile.intent,
      complexity: profile.complexity,
      executionPolicy: profile.execution_policy,
      model: profiled.model,
      decidedBy: profiled.decidedBy,
    };

    // 3. Routing rules, in the order the ticket gives them.
    if (profile.execution_policy === "clarify") {
      return finish("clarify", profile.clarification_question ?? "Could you say a little more about what you need?", route);
    }

    if ((profile.intent === "task" || profile.intent === "act") && TASK_THEN_ACT.test(plain)) {
      return finish(
        "clarify",
        "That's two steps, and the second one sends something out. Shall I draft it first so you can check it before anything is sent?",
        { ...route, executionPolicy: "clarify" },
        { reason: "multiple-intents" },
      );
    }

    if (profile.execution_policy === "answer_directly") {
      return finish("answered", profile.direct_response ?? "", route);
    }

    const toolFree = (profile.intent === "chat" || profile.intent === "answer") && !profile.requires_tools && !profile.requires_current_information;
    if (toolFree && !profile.target_worker) return this.answerWithStrongModel(message, conversation, conversationId, models, config, route, finish);

    return this.delegate(profile, message, conversation, conversationId, models, config, route, finish);
  }

  private workerContext(
    conversationId: string,
    message: string,
    inputs: JarvisRequestProfile["inputs"],
    conversation: JarvisConversation,
    models: JarvisModelClient,
    config: JarvisRoutingConfig,
    output?: JarvisWorkerContext["output"],
  ): JarvisWorkerContext {
    return { conversationId, message, inputs, conversation, store: this.deps.store, models, config, output };
  }

  private answerWithStrongModel(
    message: string,
    conversation: JarvisConversation,
    conversationId: string,
    models: JarvisModelClient,
    config: JarvisRoutingConfig,
    route: JarvisRouteSummary,
    finish: FinishFn,
  ): Promise<JarvisConverseResponse> | JarvisConverseResponse {
    const strongRoute = { ...route, model: describeModel(config.strong) };
    if (config.strong.runtime === "hermes") {
      const hermes = this.deps.registry.get("hermes.agent");
      const availability = hermes?.available?.() ?? { ok: true as const };
      if (!hermes || !availability.ok) {
        return finish("unsupported", `That needs a stronger model, and none is available: ${availability.ok ? "Hermes is not registered." : availability.reason}`, strongRoute, { reason: "strong-unavailable" });
      }
      return finish("handoff", "Thinking about it properly.", { ...strongRoute, workerId: "hermes.agent" }, { handoff: { workerId: "hermes", message } });
    }

    const strong = config.strong;
    const history = conversation.turns.slice(-8).map((turn) => ({ role: turn.role, content: turn.text }));
    const pseudoWorker: JarvisWorker = {
      id: "model.strong",
      name: "Strong model",
      description: "",
      capabilities: [],
      intents: ["answer"],
      requiredInputs: [],
      safeRetry: true,
    };
    return this.runAsJob(
      pseudoWorker,
      async (): Promise<JarvisWorkerResult> => {
        try {
          const answer = await models.chat(
            strong,
            [
              { role: "system", content: `You are Jarvis, a capable assistant. Address the user as "${config.address}" at most once. Answer accurately and clearly; go into detail only where the question needs it. Say plainly when you are not sure.` },
              ...history,
            ],
            { maxTokens: 2_000, timeoutMs: config.strongTimeoutMs, temperature: 0.3 },
          );
          return { status: "completed", reply: answer.trim() };
        } catch (error) {
          return { status: "failed", reply: `The stronger model couldn't answer: ${error instanceof Error ? error.message : "unknown error"}` };
        }
      },
      config,
      { ...strongRoute, workerId: undefined },
      finish,
      conversationId,
    );
  }

  private delegate(
    profile: JarvisRequestProfile,
    message: string,
    conversation: JarvisConversation,
    conversationId: string,
    models: JarvisModelClient,
    config: JarvisRoutingConfig,
    route: JarvisRouteSummary,
    finish: FinishFn,
  ): Promise<JarvisConverseResponse> | JarvisConverseResponse {
    // Validation already rejected unknown ids; null means the model found nothing that fits.
    const worker = this.deps.registry.get(profile.target_worker);
    if (!worker) {
      const can = this.deps.registry
        .list()
        .filter((entry) => entry.available?.().ok ?? true)
        .map((entry) => entry.name.toLowerCase())
        .join(", ");
      const what = profile.intent === "act" ? "make that change" : profile.intent === "task" ? "do that" : "look that up";
      return finish("unsupported", `I don't have a worker that can ${what} yet, so I haven't guessed. What I can use right now: ${can || "nothing"}.`, route, { reason: "no-worker" });
    }

    const workerRoute = { ...route, workerId: worker.id };
    const availability = worker.available?.() ?? { ok: true as const };
    if (!availability.ok) return finish("unsupported", `${worker.name} can't take that right now: ${availability.reason}`, workerRoute, { reason: "worker-unavailable" });

    if (worker.handoff) {
      return finish("handoff", "Handing that to Hermes.", { ...workerRoute, model: "hermes" }, { handoff: { workerId: "hermes", message } });
    }

    let output: JarvisWorkerContext["output"];
    if (worker.requiredInputs.some((input) => input.source === "output_reference")) {
      const reference = resolveOutputReference(conversation, profile.inputs.output_id);
      if (reference.kind === "none") {
        return finish("clarify", "I haven't written anything in this conversation yet. What should I work from?", workerRoute, { reason: "no-reference" });
      }
      if (reference.kind === "ambiguous") {
        const names = reference.candidates.map((candidate) => `"${candidate.title}"`);
        return finish("clarify", `Which one do you mean: ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`, workerRoute, { reason: "ambiguous-reference" });
      }
      output = reference.output;
    }

    const context = this.workerContext(conversationId, message, profile.inputs, conversation, models, config, output);
    const run = worker.run!.bind(worker);
    return this.runAsJob(worker, () => run(context), config, workerRoute, finish, conversationId);
  }

  /**
   * Runs delegated work, waits briefly for it, and reports what actually
   * happened. A worker that throws is a failed job, never a crash, and is not
   * retried here: a retry is the person's call, and only `safeRetry` workers
   * would even be candidates.
   */
  private async runAsJob(
    worker: JarvisWorker,
    work: () => Promise<JarvisWorkerResult>,
    config: JarvisRoutingConfig,
    route: JarvisRouteSummary,
    finish: FinishFn,
    owner: string,
  ): Promise<JarvisConverseResponse> {
    const job: JarvisJob = {
      id: `job_${randomUUID().slice(0, 12)}`,
      status: "running",
      workerId: worker.id.startsWith("model.") ? undefined : worker.id,
      model: route.model,
      startedAt: new Date(this.now()).toISOString(),
    };

    let settledResult: JarvisWorkerResult | undefined;
    const done = Promise.resolve()
      .then(work)
      .catch((error: unknown): JarvisWorkerResult => ({ status: "failed", reply: `${worker.name} failed: ${error instanceof Error ? error.message : "unknown error"}` }))
      .then((result) => {
        settledResult = result;
        job.status = result.status;
        job.reply = result.reply;
        job.display = result.display;
        job.output = result.output ? { id: result.output.id, kind: result.output.kind, title: result.output.title } : undefined;
        job.endedAt = new Date(this.now()).toISOString();
      });

    this.jobs.set(job.id, { job, conversationId: owner, done });
    this.trimJobs();

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([done, new Promise<void>((resolve) => (timer = setTimeout(resolve, config.inlineWaitMs)))]);
    if (timer) clearTimeout(timer);

    if (settledResult) {
      const outcome: JarvisOutcome =
        settledResult.status === "completed" ? "answered" : settledResult.status === "needs_input" ? "clarify" : settledResult.status === "awaiting_confirmation" ? "awaiting_confirmation" : "failed";
      return finish(outcome, settledResult.reply, route, { display: settledResult.display, job: { ...job }, outputId: settledResult.output?.id });
    }

    // Still working: acknowledge now, and record the real outcome when it lands.
    void done.then(() => {
      this.deps.store.addTurn(owner, { role: "assistant", text: job.reply ?? "", outputId: job.output?.id });
      console.info("[jarvis] job settled", { jobId: job.id, workerId: job.workerId, status: job.status, durationMs: Date.parse(job.endedAt ?? "") - Date.parse(job.startedAt) });
    });
    const ack = worker.id === "model.strong" ? "Let me think that through properly." : `On it: ${worker.name.toLowerCase()}. I'll tell you when it's done.`;
    return finish("delegated", ack, route, { job: { ...job } });
  }

  private trimJobs(): void {
    while (this.jobs.size > MAX_JOBS) {
      const oldest = this.jobs.keys().next().value;
      if (oldest === undefined) break;
      this.jobs.delete(oldest);
    }
  }
}

type FinishFn = (
  outcome: JarvisOutcome,
  reply: string,
  route: JarvisRouteSummary,
  extra?: Partial<Pick<JarvisConverseResponse, "display" | "job" | "handoff">> & { reason?: string; outputId?: string },
) => JarvisConverseResponse;
