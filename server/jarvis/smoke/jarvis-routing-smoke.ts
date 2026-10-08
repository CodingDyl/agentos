/**
 * Live smoke test for Jev's routing against your running Ollama.
 *
 *   npm run smoke:jarvis                         # the greeting fast path (the acceptance check)
 *   npm run smoke:jarvis -- --all                # also the other ticket examples, as routing evidence
 *   npm run smoke:jarvis -- --model qwen3:4b --base-url http://127.0.0.1:11434
 *
 * Nothing is mocked except where work would leave this machine: the mail
 * sender is replaced by a recorder, so "send it" can be exercised end to end
 * without sending anything. State goes to a throwaway directory. Exit code 0
 * means every scenario passed, 1 means one failed, 2 means Ollama or the model
 * was not there to test (inconclusive, never a pass).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const BASE_URL = option("base-url", "http://127.0.0.1:11434");
const MODEL = option("model", process.env.JARVIS_QUICK_MODEL || "qwen3:4b");
const STRONG = option("strong-model", process.env.JARVIS_STRONG_MODEL || MODEL);

// Must be set before any AgentOS module reads its state directory.
process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jarvis-smoke-"));

async function main(): Promise<number> {
  const { ollamaJarvisModelClient } = await import("../jarvis-model-client");
  const { JarvisConversationStore } = await import("../jarvis-conversation-store");
  const { JarvisWorkerRegistry } = await import("../jarvis-worker-registry");
  const { JevRequestRouter } = await import("../jev-request-router");
  const { draftReviserWorker, draftWriterWorker } = await import("../workers/draft-writer-workers");
  const { mailSendWorker } = await import("../workers/mail-send-worker");
  const { overdueInvoicesWorker } = await import("../workers/overdue-invoices-worker");
  const { hermesHandoffWorker } = await import("../default-jarvis-workers");

  let installed: string[];
  try {
    const tags = (await (await fetch(new URL("/api/tags", BASE_URL), { signal: AbortSignal.timeout(3_000) })).json()) as { models?: { name: string }[] };
    installed = (tags.models ?? []).map((model) => model.name);
  } catch {
    console.log(`[----] Ollama is not reachable at ${BASE_URL}. Start it (ollama serve) and run again. INCONCLUSIVE.`);
    return 2;
  }
  if (!installed.includes(MODEL)) {
    console.log(`[----] ${MODEL} is not installed in Ollama (installed: ${installed.join(", ") || "none"}). INCONCLUSIVE.`);
    return 2;
  }

  const client = ollamaJarvisModelClient(BASE_URL);
  let calls = 0;
  const counted = { chat: (...params: Parameters<typeof client.chat>) => ((calls += 1), client.chat(...params)) };
  const sent: string[] = [];

  const registry = new JarvisWorkerRegistry()
    .register(overdueInvoicesWorker(async () => [
      {
        entity: { id: "virtec", name: "Virtec" },
        records: [
          { id: "inv-1", entityId: "virtec", source: "agentos", sourceId: "inv-1", kind: "invoice", title: "Website retainer", number: "INV-101", clientName: "Acme Ltd", detail: "complete", currency: "ZAR", status: "issued", issuedOn: "2026-08-01", dueOn: "2026-09-01", amountMinor: 1_250_000 },
        ],
      },
    ]))
    .register(draftWriterWorker)
    .register(draftReviserWorker)
    .register(
      mailSendWorker({
        decide: (_capability, initiator) => (initiator === "agent" ? { allowed: false, code: "approval-required", reason: "Needs a person." } : { allowed: true, policy: "approval" }),
        send: async (input) => {
          sent.push(input.to.join(","));
          return { item: { id: "smoke", kind: "sent", to: input.to, subject: input.subject, tag: "normal", attachmentCount: 0, labelApplied: true, createdAt: "", sentAt: "" } };
        },
      }),
    )
    .register({ ...hermesHandoffWorker, available: () => ({ ok: true }) });

  const router = new JevRequestRouter({
    registry,
    store: new JarvisConversationStore(),
    models: () => counted,
    config: () => ({
      ollamaBaseUrl: BASE_URL,
      quick: { runtime: "ollama", model: MODEL },
      strong: { runtime: "ollama", model: STRONG },
      address: "sir",
      profileTimeoutMs: 60_000,
      strongTimeoutMs: 180_000,
      inlineWaitMs: 180_000,
    }),
    log: () => undefined,
  });

  let failures = 0;
  const conversation = `smoke_${Date.now()}`;
  async function scenario(title: string, message: string, check: (response: Awaited<ReturnType<typeof router.converse>>, modelCalls: number) => string | undefined) {
    calls = 0;
    const started = Date.now();
    const response = await router.converse({ conversationId: conversation, message });
    const problem = check(response, calls);
    const mark = problem ? "FAIL" : "PASS";
    if (problem) failures += 1;
    console.log(`\n[${mark}] ${title}`);
    console.log(`       "${message}" → ${response.outcome}${response.route.workerId ? ` via ${response.route.workerId}` : ""} · ${response.route.intent ?? "-"}/${response.route.complexity ?? "-"} · ${calls} model call(s) · ${Date.now() - started} ms`);
    console.log(`       reply: ${response.reply.slice(0, 200).replace(/\s+/g, " ")}`);
    if (problem) console.log(`       why: ${problem}`);
  }

  console.log(`Jev routing smoke · quick ${MODEL} · strong ${STRONG} · ${BASE_URL}`);

  // The acceptance check: one quick call, no worker, a brief answer.
  await scenario("Greeting fast path", "Good morning Jarvis", (response, modelCalls) =>
    response.outcome !== "answered"
      ? `expected answered, got ${response.outcome}`
      : response.route.workerId
        ? `a worker (${response.route.workerId}) was used`
        : modelCalls !== 1
          ? `${modelCalls} model calls, expected 1`
          : response.reply.length > 300
            ? `reply is ${response.reply.length} chars; a greeting should be brief`
            : undefined,
  );

  if (flag("all")) {
    await scenario("Simple question answered directly", "What is a webhook?", (response, modelCalls) =>
      response.outcome === "answered" && modelCalls === 1 ? undefined : `expected a direct answer in one call, got ${response.outcome} in ${modelCalls}`,
    );
    await scenario("Overdue invoices come from the ledger", "Which invoices are overdue?", (response) =>
      response.route.workerId === "business.overdue_invoices" && /INV-101|Acme/.test(`${response.reply} ${response.display ?? ""}`) ? undefined : `routed to ${response.route.workerId ?? response.outcome}`,
    );
    await scenario("Drafting does not send", "Draft a short client proposal for Acme Ltd's website rebuild, R25,000, four weeks", (response) =>
      response.route.workerId === "writer.draft" && sent.length === 0 ? undefined : `routed to ${response.route.workerId ?? response.outcome}; sent ${sent.length}`,
    );
    await scenario("'Send it' resolves the draft and waits for confirmation", "Send it to jane@acme.co.za", (response) =>
      response.outcome === "awaiting_confirmation" && sent.length === 0 ? undefined : `got ${response.outcome}; sent ${sent.length}`,
    );
    await scenario("Two steps with a send are clarified first", "Draft a follow-up email to Beta Co and send it", (response) =>
      response.outcome === "clarify" ? undefined : `got ${response.outcome}`,
    );
  }

  console.log(`\n${failures === 0 ? "All scenarios passed." : `${failures} scenario(s) failed.`}`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
