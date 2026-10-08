import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import { JarvisConverseResponseSchema, JarvisRequestProfileSchema, type JarvisRequestProfile } from "../../../shared/jarvis-routing-types";
import type { MailComposeInput } from "../../../shared/mail-compose-types";
import type { CapabilityDecision, Initiator } from "../../connectors/policy";
import type { OllamaChatMessage } from "../../workers/providers/ollama-client";
import { hermesHandoffWorker } from "../default-jarvis-workers";
import { JarvisConversationStore, resolveOutputReference } from "../jarvis-conversation-store";
import { JarvisModelError, type JarvisChatOptions, type JarvisModelClient } from "../jarvis-model-client";
import { jarvisRoutingConfig, type JarvisModelRef, type JarvisRoutingConfig } from "../jarvis-routing-config";
import { JarvisWorkerRegistry, type JarvisWorker } from "../jarvis-worker-registry";
import { validateProfile } from "../jev-request-profiler";
import { JevRequestRouter, type JarvisRouteLog } from "../jev-request-router";
import { draftReviserWorker, draftWriterWorker } from "../workers/draft-writer-workers";
import { mailSendWorker } from "../workers/mail-send-worker";
import { findOverdueInvoices, overdueInvoicesWorker, type BusinessLedgerSnapshot } from "../workers/overdue-invoices-worker";

// ------------------------------------------------------------------ fixtures

const BASE_CONFIG: JarvisRoutingConfig = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  quick: { runtime: "ollama", model: "qwen3:4b" },
  strong: { runtime: "ollama", model: "qwen3:14b" },
  fallback: { runtime: "ollama", model: "llama3.2:3b" },
  address: "sir",
  profileTimeoutMs: 5_000,
  strongTimeoutMs: 5_000,
  inlineWaitMs: 200,
};

function profile(overrides: Partial<JarvisRequestProfile> = {}): string {
  return JSON.stringify({
    intent: "chat",
    complexity: "low",
    requires_tools: false,
    requires_current_information: false,
    needs_clarification: false,
    clarification_question: null,
    target_worker: null,
    response_model: "local_fast",
    execution_policy: "answer_directly",
    inputs: {},
    direct_response: "Good morning, sir.",
    ...overrides,
  });
}

const delegateTo = (target_worker: string | null, intent: JarvisRequestProfile["intent"], inputs: JarvisRequestProfile["inputs"] = {}) =>
  profile({ intent, complexity: "medium", requires_tools: true, target_worker, execution_policy: "delegate", direct_response: null, inputs, response_model: "local_fast" });

interface ModelCall {
  model: string;
  profiling: boolean;
  messages: OllamaChatMessage[];
}

type Script = (call: ModelCall) => string | Promise<string>;

class FakeModels implements JarvisModelClient {
  readonly calls: ModelCall[] = [];
  constructor(private readonly script: Script) {}
  async chat(ref: JarvisModelRef, messages: OllamaChatMessage[], options: JarvisChatOptions): Promise<string> {
    const call = { model: ref.model, profiling: Boolean(options.jsonSchema), messages };
    this.calls.push(call);
    return this.script(call);
  }
  profileCalls(): ModelCall[] {
    return this.calls.filter((call) => call.profiling);
  }
}

const TODAY = new Date("2026-10-08T09:00:00");

const ledger = (records: Partial<BusinessLedgerRecord>[]): BusinessLedgerSnapshot[] => [
  { entity: { id: "virtec", name: "Virtec" }, records: records as BusinessLedgerRecord[] },
];

const invoice = (id: string, extra: Record<string, unknown>) =>
  ({ id, entityId: "virtec", source: "agentos", sourceId: id, kind: "invoice", title: "Website retainer", detail: "complete", currency: "ZAR", ...extra }) as Partial<BusinessLedgerRecord>;

const LEDGER = ledger([
  { id: "c1", entityId: "virtec", source: "agentos", sourceId: "c1", kind: "client", name: "Jane", companyName: "Acme Ltd" } as Partial<BusinessLedgerRecord>,
  invoice("inv-overdue", { number: "INV-001", clientId: "c1", status: "issued", dueOn: "2026-09-30", amountMinor: 1_250_000 }),
  invoice("inv-part-paid", { number: "INV-002", clientName: "Beta Co", status: "issued", dueOn: "2026-10-01", amountMinor: 500_000 }),
  invoice("inv-future", { number: "INV-003", status: "issued", dueOn: "2026-11-01", amountMinor: 100_000 }),
  invoice("inv-paid", { number: "INV-004", status: "issued", dueOn: "2026-09-01", amountMinor: 200_000 }),
  invoice("inv-draft", { status: "draft", dueOn: "2026-09-01", amountMinor: 999_900 }),
  invoice("inv-void", { number: "INV-005", status: "issued", dueOn: "2026-09-01", amountMinor: 300_000, voided: { at: "2026-09-02T00:00:00Z", reason: "duplicate" } }),
  { id: "p1", entityId: "virtec", source: "agentos", sourceId: "p1", kind: "payment", clientId: "c1", currency: "ZAR", amountMinor: 400_000, receivedOn: "2026-10-02", allocations: [{ invoiceId: "inv-paid", amountMinor: 200_000 }, { invoiceId: "inv-part-paid", amountMinor: 200_000 }] } as Partial<BusinessLedgerRecord>,
]);

interface Harness {
  router: JevRequestRouter;
  models: FakeModels;
  store: JarvisConversationStore;
  logs: JarvisRouteLog[];
  sent: MailComposeInput[];
  decisions: Initiator[];
}

function harness(
  script: Script,
  options: { config?: Partial<JarvisRoutingConfig>; sendPolicy?: CapabilityDecision; extraWorkers?: JarvisWorker[]; hermesOn?: boolean } = {},
): Harness {
  const models = new FakeModels(script);
  const store = new JarvisConversationStore();
  const logs: JarvisRouteLog[] = [];
  const sent: MailComposeInput[] = [];
  const decisions: Initiator[] = [];
  const registry = new JarvisWorkerRegistry()
    .register(overdueInvoicesWorker(async () => LEDGER, () => TODAY))
    .register(draftWriterWorker)
    .register(draftReviserWorker)
    .register(
      mailSendWorker({
        decide: (_capability, initiator) => {
          decisions.push(initiator);
          if (options.sendPolicy) return options.sendPolicy;
          return initiator === "agent"
            ? { allowed: false, code: "approval-required", reason: "“Send email” on Gmail needs a person to approve it." }
            : { allowed: true, policy: "approval" };
        },
        send: async (input) => {
          sent.push(input);
          return { item: { id: "o1", kind: "sent", to: input.to, subject: input.subject, tag: "normal", attachmentCount: 0, labelApplied: true, createdAt: "", sentAt: "" } };
        },
      }),
    )
    .register({ ...hermesHandoffWorker, available: () => (options.hermesOn === false ? { ok: false, reason: "Hermes is switched off in AI Stack." } : { ok: true }) });
  for (const worker of options.extraWorkers ?? []) registry.register(worker);

  const router = new JevRequestRouter({
    registry,
    store,
    models: () => models,
    config: () => ({ ...BASE_CONFIG, ...options.config }),
    log: (entry) => logs.push(entry),
    now: () => TODAY.getTime(),
  });
  return { router, models, store, logs, sent, decisions };
}

const CONVERSATION = "conv_test_0001";
const say = (h: Harness, message: string) => h.router.converse({ conversationId: CONVERSATION, message }).then((response) => JarvisConverseResponseSchema.parse(response));

// ------------------------------------------------------------------ tests

describe("Jev request profile schema", () => {
  it("accepts the ticket's example and rejects inconsistent profiles", () => {
    assert.equal(JarvisRequestProfileSchema.safeParse(JSON.parse(profile({ direct_response: "Good morning, Dylan." }))).success, true);
    // answer_directly without a response
    assert.equal(JarvisRequestProfileSchema.safeParse(JSON.parse(profile({ direct_response: null }))).success, false);
    // a retrieve cannot be answered directly
    assert.equal(JarvisRequestProfileSchema.safeParse(JSON.parse(profile({ intent: "retrieve", requires_tools: true }))).success, false);
    // clarify needs its question
    assert.equal(JarvisRequestProfileSchema.safeParse(JSON.parse(profile({ execution_policy: "clarify", needs_clarification: true, direct_response: null }))).success, false);
    // unknown fields are refused, so a model cannot smuggle in "approved": true
    assert.equal(JarvisRequestProfileSchema.safeParse({ ...JSON.parse(profile()), approved: true }).success, false);
    // values outside the enums
    assert.equal(JarvisRequestProfileSchema.safeParse(JSON.parse(profile({ complexity: "extreme" as never }))).success, false);
  });

  it("only accepts worker ids from the registry, for intents they support", () => {
    const registry = new JarvisWorkerRegistry().register(draftWriterWorker);
    assert.equal(validateProfile(delegateTo("writer.draft", "task"), registry).ok, true);
    const unknown = validateProfile(delegateTo("crm.magic", "retrieve"), registry);
    assert.equal(unknown.ok, false);
    assert.match(unknown.ok ? "" : unknown.issues, /not a registered worker/);
    assert.equal(validateProfile(delegateTo("writer.draft", "act"), registry).ok, false);
    assert.equal(validateProfile("Sure! Here's my answer", registry).ok, false);
  });
});

describe("Jev routing", () => {
  it("answers a greeting with one quick-model call and no worker", async () => {
    const h = harness(() => profile({ direct_response: "Good morning, sir. What's first?" }));
    const response = await say(h, "Good morning Jarvis");
    assert.equal(response.outcome, "answered");
    assert.equal(response.reply, "Good morning, sir. What's first?");
    assert.equal(h.models.calls.length, 1);
    assert.equal(h.models.calls[0].model, "qwen3:4b");
    assert.equal(response.route.workerId, undefined);
    assert.equal(response.route.decidedBy, "quick_model");
    assert.equal(response.job, undefined);
  });

  it("answers a simple question directly, and allows a longer answer when asked for detail", async () => {
    const short = harness(() => profile({ intent: "answer", direct_response: "A webhook is an HTTP callback one system sends another when something happens." }));
    const brief = await say(short, "What is a webhook?");
    assert.equal(brief.outcome, "answered");
    assert.equal(short.models.calls.length, 1);

    const detail = "A webhook is an HTTP request a service sends to a URL you register. ".repeat(30).trim();
    const long = harness(() => profile({ intent: "answer", complexity: "medium", direct_response: detail }));
    const detailed = await say(long, "Explain webhooks in detail");
    assert.equal(detailed.outcome, "answered");
    assert.equal(detailed.reply, detail);
    assert.ok(detailed.reply.length > 1_500);
    // The prompt tells the quick model that detail is allowed when asked.
    assert.match(long.models.calls[0].messages[0].content, /unless the user asks for detail/);
  });

  it("sends a complex technical question to the stronger model", async () => {
    const h = harness((call) =>
      call.profiling
        ? profile({ intent: "answer", complexity: "high", response_model: "strong", execution_policy: "delegate", direct_response: null })
        : "Raft elects a leader per term; a log entry commits once a majority stores it.",
    );
    const response = await say(h, "Compare Raft and Paxos leader election under network partitions");
    assert.equal(response.outcome, "answered");
    assert.equal(response.route.model, "qwen3:14b");
    assert.deepEqual(h.models.calls.map((call) => call.model), ["qwen3:4b", "qwen3:14b"]);
    assert.match(response.reply, /majority/);
  });

  it("hands a complex question to Hermes when Hermes is the configured strong model", async () => {
    const h = harness(() => profile({ intent: "answer", complexity: "high", response_model: "strong", execution_policy: "delegate", direct_response: null }), {
      config: { strong: { runtime: "hermes", model: "hermes" } },
    });
    const response = await say(h, "Design a sharding strategy for a multi-tenant Postgres");
    assert.equal(response.outcome, "handoff");
    assert.deepEqual(response.handoff, { workerId: "hermes", message: "Design a sharding strategy for a multi-tenant Postgres" });
  });

  it("retrieves overdue invoices from the ledger instead of letting the model answer", async () => {
    const h = harness(() => delegateTo("business.overdue_invoices", "retrieve"));
    const response = await say(h, "Which invoices are overdue?");
    assert.equal(response.outcome, "answered");
    assert.equal(response.route.workerId, "business.overdue_invoices");
    assert.equal(h.models.calls.length, 1, "only the profile call; the data comes from the ledger");
    assert.match(response.reply, /^2 overdue invoices, R 15,500\.00 outstanding/);
    assert.match(response.display ?? "", /INV-001 · Acme Ltd/);
    assert.match(response.display ?? "", /INV-002 · Beta Co .* R 3,000\.00/);
    assert.doesNotMatch(response.display ?? "", /INV-003|INV-004|INV-005/);
  });

  it("computes overdue exactly as the Billing tab does", () => {
    const overdue = findOverdueInvoices(LEDGER, "2026-10-08");
    assert.deepEqual(overdue.map((entry) => [entry.number, entry.balanceMinor]), [["INV-001", 1_250_000], ["INV-002", 300_000]]);
    assert.deepEqual(findOverdueInvoices(LEDGER, "2026-09-30").map((entry) => entry.number), []);
  });

  it("drafts a proposal without sending it, then resolves 'send it' to that draft behind a confirmation", async () => {
    let step = 0;
    const h = harness((call) => {
      if (!call.profiling) return "Proposal for Acme: a four-week website rebuild.";
      step += 1;
      return step === 1
        ? delegateTo("writer.draft", "task", { topic: "client proposal for Acme's website rebuild" })
        : delegateTo("mail.send_draft", "act", { to: "jane@acme.co.za" });
    });

    const drafted = await say(h, "Draft a client proposal for Acme's website rebuild");
    assert.equal(drafted.outcome, "answered");
    assert.equal(drafted.route.workerId, "writer.draft");
    assert.equal(drafted.display, "Proposal for Acme: a four-week website rebuild.");
    assert.match(drafted.reply, /Nothing has been sent/);
    assert.equal(h.sent.length, 0);
    assert.equal(h.store.get(CONVERSATION).outputs.length, 1);

    const prepared = await say(h, "Send it");
    assert.equal(prepared.outcome, "awaiting_confirmation");
    assert.match(prepared.reply, /Client proposal for Acme's website rebuild.*jane@acme\.co\.za.*Say confirm/);
    assert.equal(h.sent.length, 0, "nothing is sent until you confirm");

    const confirmed = await say(h, "Confirm");
    assert.equal(confirmed.outcome, "answered");
    assert.equal(confirmed.route.decidedBy, "confirmation");
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].to, ["jane@acme.co.za"]);
    assert.equal(h.sent[0].body, "Proposal for Acme: a four-week website rebuild.");
    assert.deepEqual(h.decisions, ["agent", "person"], "the existing policy is asked before preparing and again before sending");
    assert.equal(h.models.profileCalls().length, 2, "the confirmation itself is never sent to a model");
  });

  it("refuses to send when the connector policy says no, whatever the profile says", async () => {
    const h = harness(() => delegateTo("mail.send_draft", "act", { to: "jane@acme.co.za", approved: "yes", permission: "granted" }), {
      sendPolicy: { allowed: false, code: "capability-disabled", reason: "“Send email” is turned off for Gmail in Connectors." },
    });
    h.store.addOutput(CONVERSATION, { kind: "draft", title: "Proposal", text: "Hello", workerId: "writer.draft" });
    const response = await say(h, "Send the proposal to jane@acme.co.za");
    assert.equal(response.outcome, "failed");
    assert.match(response.reply, /turned off for Gmail.*Nothing was sent/);
    assert.equal(h.store.get(CONVERSATION).pendingAction, undefined);
    assert.equal(h.sent.length, 0);
  });

  it("asks for a recipient instead of guessing one", async () => {
    const h = harness(() => delegateTo("mail.send_draft", "act", {}));
    h.store.addOutput(CONVERSATION, { kind: "draft", title: "Proposal", text: "Hello", workerId: "writer.draft" });
    const response = await say(h, "Send it");
    assert.equal(response.outcome, "clarify");
    assert.match(response.reply, /email address/);
    assert.equal(h.sent.length, 0);
  });

  it("does not act on 'confirm' when nothing is waiting, and drops a waiting action on any other request", async () => {
    const h = harness((call) => (call.messages.at(-1)?.content === "Confirm" ? profile({ direct_response: "Confirm what, sir?" }) : delegateTo("mail.send_draft", "act", { to: "jane@acme.co.za" })));
    const nothing = await say(h, "Confirm");
    assert.equal(nothing.route.decidedBy, "quick_model");
    assert.equal(h.sent.length, 0);

    h.store.addOutput(CONVERSATION, { kind: "draft", title: "Proposal", text: "Hello", workerId: "writer.draft" });
    assert.equal((await say(h, "Send it")).outcome, "awaiting_confirmation");
    const cancelled = await say(h, "Cancel");
    assert.match(cancelled.reply, /Cancelled, nothing was done/);
    assert.equal(h.sent.length, 0);
  });

  it("revises the draft 'it' refers to", async () => {
    let step = 0;
    const h = harness((call) => {
      if (!call.profiling) return step === 1 ? "A long proposal with many paragraphs." : "A short proposal.";
      step += 1;
      return step === 1 ? delegateTo("writer.draft", "task", { topic: "proposal" }) : delegateTo("writer.revise", "task", { instruction: "make it shorter" });
    });
    await say(h, "Draft a proposal for Acme");
    const revised = await say(h, "Make it shorter");
    assert.equal(revised.outcome, "answered");
    assert.equal(revised.display, "A short proposal.");
    const reviseCall = h.models.calls.at(-1);
    assert.match(reviseCall?.messages.at(-1)?.content ?? "", /A long proposal with many paragraphs/);
  });

  it("asks which draft when the reference is ambiguous, and when there is nothing to refer to", async () => {
    const empty = harness(() => delegateTo("writer.revise", "task", { instruction: "shorter" }));
    const none = await say(empty, "Make it shorter");
    assert.equal(none.outcome, "clarify");
    assert.match(none.reply, /haven't written anything/);

    const h = harness(() => delegateTo("mail.send_draft", "act", { to: "jane@acme.co.za" }));
    h.store.addOutput(CONVERSATION, { kind: "draft", title: "Acme proposal", text: "A", workerId: "writer.draft" });
    h.store.addOutput(CONVERSATION, { kind: "draft", title: "Beta follow-up", text: "B", workerId: "writer.draft" });
    h.store.addTurn(CONVERSATION, { role: "assistant", text: "Good afternoon, sir." });
    const ambiguous = await say(h, "Send it");
    assert.equal(ambiguous.outcome, "clarify");
    assert.match(ambiguous.reply, /"Acme proposal" or "Beta follow-up"/);
    assert.equal(h.sent.length, 0);
    assert.equal(h.store.get(CONVERSATION).pendingAction, undefined);
  });

  it("resolves 'it' to the output the previous reply produced when there are several", () => {
    const store = new JarvisConversationStore();
    store.addOutput(CONVERSATION, { kind: "draft", title: "Old", text: "A", workerId: "writer.draft" });
    const latest = store.addOutput(CONVERSATION, { kind: "draft", title: "New", text: "B", workerId: "writer.draft" });
    store.addTurn(CONVERSATION, { role: "assistant", text: "Draft ready: New.", outputId: latest.id });
    const resolved = resolveOutputReference(store.get(CONVERSATION), undefined);
    assert.equal(resolved.kind === "resolved" ? resolved.output.id : undefined, latest.id);
  });

  it("asks a focused clarification when the model says information is missing", async () => {
    const h = harness(() =>
      profile({ intent: "task", needs_clarification: true, execution_policy: "clarify", clarification_question: "Which client is the proposal for?", direct_response: null }),
    );
    const response = await say(h, "Draft a proposal");
    assert.equal(response.outcome, "clarify");
    assert.equal(response.reply, "Which client is the proposal for?");
    assert.equal(h.models.calls.length, 1);
  });

  it("clarifies before executing two steps where the second sends something", async () => {
    const h = harness(() => delegateTo("writer.draft", "task", { topic: "proposal" }));
    const response = await say(h, "Draft a proposal and send it to jane@acme.co.za");
    assert.equal(response.outcome, "clarify");
    assert.match(response.reply, /draft it first/);
    assert.equal(h.models.calls.length, 1, "no worker ran");
    assert.equal(h.store.get(CONVERSATION).outputs.length, 0);
  });

  it("explains when no registered worker fits, instead of inventing an answer", async () => {
    const h = harness(() => delegateTo(null, "retrieve"));
    const response = await say(h, "What's my Stripe balance?");
    assert.equal(response.outcome, "unsupported");
    assert.match(response.reply, /don't have a worker that can look that up/);
  });

  it("explains when the chosen worker is unavailable", async () => {
    const h = harness(() => delegateTo("hermes.agent", "retrieve"), { hermesOn: false });
    const response = await say(h, "What's on my calendar tomorrow?");
    assert.equal(response.outcome, "unsupported");
    assert.match(response.reply, /switched off/);
  });

  it("hands general work to Hermes with your words, not the model's", async () => {
    const h = harness(() => delegateTo("hermes.agent", "task", { objective: "rewritten by the model" }));
    const response = await say(h, "Add a pricing page to Pantry Pilot");
    assert.equal(response.outcome, "handoff");
    assert.equal(response.handoff?.message, "Add a pricing page to Pantry Pilot");
  });

  it("retries an invalid profile once with a correction, then succeeds", async () => {
    let call = 0;
    const h = harness(() => (++call === 1 ? '{"intent":"chat"}' : profile()));
    const response = await say(h, "Hello");
    assert.equal(response.outcome, "answered");
    assert.equal(h.models.calls.length, 2);
    assert.match(h.models.calls[1].messages.at(-1)?.content ?? "", /That reply is invalid/);
    assert.equal(h.logs[0].modelCalls, 2);
  });

  it("uses the fallback model after two invalid profiles, and an unknown worker counts as invalid", async () => {
    const h = harness((call) => (call.model === "qwen3:4b" ? delegateTo("crm.magic", "retrieve") : profile()));
    const response = await say(h, "Hello");
    assert.equal(response.outcome, "answered");
    assert.equal(response.route.decidedBy, "fallback_model");
    assert.deepEqual(h.models.calls.map((call) => call.model), ["qwen3:4b", "qwen3:4b", "llama3.2:3b"]);
  });

  it("fails clearly, executing nothing, when every model returns invalid profiles", async () => {
    const executed: string[] = [];
    const spy: JarvisWorker = { id: "spy", name: "Spy", description: "", capabilities: [], intents: ["act"], requiredInputs: [], safeRetry: false, run: async () => (executed.push("ran"), { status: "completed", reply: "done" }) };
    const h = harness(() => '{"intent":"act","target_worker":"spy"}', { extraWorkers: [spy] });
    const response = await say(h, "Do the thing");
    assert.equal(response.outcome, "failed");
    assert.match(response.reply, /haven't done anything/);
    assert.deepEqual(executed, []);
    assert.equal(h.models.calls.length, 4, "two per model, no more");
  });

  it("goes straight to the fallback when Ollama is down, and fails clearly when that is down too", async () => {
    const down = harness((call) => {
      if (call.model === "qwen3:4b") throw new JarvisModelError("offline", "Ollama is not reachable (ECONNREFUSED). Is it running?");
      return profile();
    });
    const viaFallback = await say(down, "Hi");
    assert.equal(viaFallback.route.decidedBy, "fallback_model");
    assert.deepEqual(down.models.calls.map((call) => call.model), ["qwen3:4b", "llama3.2:3b"]);

    const allDown = harness(() => {
      throw new JarvisModelError("offline", "Ollama is not reachable (ECONNREFUSED). Is it running?");
    });
    const failed = await say(allDown, "Hi");
    assert.equal(failed.outcome, "failed");
    assert.match(failed.reply, /not reachable/);

    const noFallback = harness(() => {
      throw new JarvisModelError("model_missing", "Model qwen3:4b is not available in Ollama.");
    }, { config: { fallback: undefined } });
    const unconfigured = await say(noFallback, "Hi");
    assert.equal(unconfigured.outcome, "failed");
    assert.match(unconfigured.reply, /No fallback model is configured \(JARVIS_FALLBACK_MODEL\)/);
  });

  it("reports routing as off when no quick model is configured", async () => {
    const h = harness(() => profile(), { config: { quick: undefined } });
    const response = await say(h, "Good morning");
    assert.equal(response.outcome, "not_configured");
    assert.equal(h.models.calls.length, 0);
  });

  it("acknowledges slow work, then reports its real completion", async () => {
    let release: () => void = () => undefined;
    const slow: JarvisWorker = {
      id: "slow.report",
      name: "Slow report",
      description: "",
      capabilities: [],
      intents: ["retrieve"],
      requiredInputs: [],
      safeRetry: true,
      run: () => new Promise((resolve) => (release = () => resolve({ status: "completed", reply: "Report ready." }))),
    };
    const h = harness(() => delegateTo("slow.report", "retrieve"), { extraWorkers: [slow], config: { inlineWaitMs: 10 } });
    const response = await say(h, "Run the slow report");
    assert.equal(response.outcome, "delegated");
    assert.match(response.reply, /On it: slow report/);
    assert.equal(response.job?.status, "running");

    release();
    const settled = await h.router.settled(response.job!.id);
    assert.equal(settled?.status, "completed");
    assert.equal(settled?.reply, "Report ready.");
    assert.equal(h.router.getJob(response.job!.id, "conv_someone_else")?.status, undefined, "a job is only visible to its own conversation");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.store.get(CONVERSATION).turns.at(-1)?.text, "Report ready.");
  });

  it("reports a worker that throws as a failure, without retrying it", async () => {
    let runs = 0;
    const broken: JarvisWorker = {
      id: "broken",
      name: "Broken",
      description: "",
      capabilities: [],
      intents: ["act"],
      requiredInputs: [],
      safeRetry: false,
      run: async () => {
        runs += 1;
        throw new Error("upstream 502");
      },
    };
    const h = harness(() => delegateTo("broken", "act"), { extraWorkers: [broken] });
    const response = await say(h, "Do the broken thing");
    assert.equal(response.outcome, "failed");
    assert.match(response.reply, /Broken failed: upstream 502/);
    assert.equal(runs, 1);
  });

  it("logs ids, the decision and timings, never what was said", async () => {
    const h = harness(() => delegateTo("business.overdue_invoices", "retrieve"));
    await say(h, "Which invoices are overdue for my secret client Zebra?");
    assert.equal(h.logs.length, 1);
    const [entry] = h.logs;
    assert.equal(entry.outcome, "answered");
    assert.equal(entry.workerId, "business.overdue_invoices");
    assert.equal(entry.model, "qwen3:4b");
    assert.equal(typeof entry.durationMs, "number");
    assert.ok(entry.requestId);
    assert.doesNotMatch(JSON.stringify(entry), /Zebra|secret|invoices are overdue/);
  });
});

describe("Jarvis routing config", () => {
  it("is off without a quick model, and defaults the strong model to Hermes", () => {
    const off = jarvisRoutingConfig({});
    assert.equal(off.quick, undefined);
    assert.deepEqual(off.strong, { runtime: "hermes", model: "hermes" });

    const on = jarvisRoutingConfig({ JARVIS_QUICK_MODEL: "qwen3:4b", JARVIS_STRONG_MODEL: "qwen3:14b", JARVIS_FALLBACK_MODEL: "llama3.2:3b" });
    assert.deepEqual(on.quick, { runtime: "ollama", model: "qwen3:4b" });
    assert.deepEqual(on.strong, { runtime: "ollama", model: "qwen3:14b" });
    assert.deepEqual(on.fallback, { runtime: "ollama", model: "llama3.2:3b" });
  });

  it("ignores a model name that is not a model name", () => {
    assert.equal(jarvisRoutingConfig({ JARVIS_QUICK_MODEL: "qwen3:4b; rm -rf /" }).quick, undefined);
  });
});
