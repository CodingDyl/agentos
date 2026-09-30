import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionOption } from "../../../shared/route-policy-types";
import { RoutePolicyRecordSchema } from "../../../shared/route-policy-types";
import { WorkerRoutingDecisionSchema } from "../../../shared/worker-routing-types";
import { buildOllamaOptions, defaultModelConfig, isEmbeddingOnly } from "../ollama-config";
import { decideRoute } from "../policy";
import { profileTask } from "../profile";

/** A configured, enabled qwen3:4b as the adapter will present it. */
const qwen: ExecutionOption = {
  id: "ollama:qwen3:4b",
  workerId: "ollama",
  modelId: "qwen3:4b",
  location: "local",
  enabled: true,
  available: true,
  capabilities: ["text", "structured_output"],
  categories: ["summarisation", "extraction", "rewriting", "classification", "explanation"],
  maxInputTokens: 2000,
  maxOutputTokens: 512,
  timeoutMs: 30_000,
  concurrencyLimit: 1,
  toolAccess: false,
  costUsdPerJob: 0,
  loaded: true,
};

const claude: ExecutionOption = {
  id: "claude",
  workerId: "claude",
  location: "cloud",
  enabled: true,
  available: true,
  capabilities: ["text", "structured_output", "tools", "repository", "file_writes", "web"],
  categories: [],
  toolAccess: true,
};

const route = (
  objective: string,
  options: ExecutionOption[],
  extra: Partial<Parameters<typeof profileTask>[0]> = {},
  mode: "auto" | "local_only" | "manual" = "auto",
  manualOptionId?: string,
) =>
  decideRoute({
    profile: profileTask({ objective, ...extra }),
    options,
    mode,
    manualOptionId,
  });

const NOTES = "Meeting notes: we agreed to ship Friday. Dana owns QA. Budget approved.";

describe("profileTask", () => {
  it("reads a short summary as simple text work", () => {
    const profile = profileTask({ objective: "Summarise these meeting notes into five bullets", context: NOTES });
    assert.equal(profile.category, "summarisation");
    assert.equal(profile.complexity, "simple");
    assert.deepEqual(profile.requiredCapabilities, ["text"]);
    assert.equal(profile.routingUncertain, false);
    assert.equal(profile.constraints.reviewRequired, true);
  });

  it("flags a task that refers to supplied notes when none were supplied", () => {
    const profile = profileTask({ objective: "Summarise these meeting notes into five bullets" });
    assert.equal(profile.missingInformation.length, 1);
    assert.equal(profile.routingUncertain, true);
  });

  it("reads repository work as complex and tool-requiring", () => {
    const profile = profileTask({
      objective: "Implement authentication across this application and run its tests",
      repoPath: "/repo",
    });
    assert.equal(profile.category, "coding");
    assert.equal(profile.complexity, "complex");
    for (const need of ["tools", "repository", "file_writes"] as const) {
      assert.ok(profile.requiredCapabilities.includes(need), need);
    }
  });

  it("requires structured output for JSON extraction", () => {
    const profile = profileTask({ objective: "Extract all the dates from this text as JSON", context: NOTES });
    assert.equal(profile.category, "extraction");
    assert.ok(profile.requiredCapabilities.includes("structured_output"));
  });

  it("requires web access for current information", () => {
    const profile = profileTask({ objective: "Find the latest pricing for Ollama hosting online" });
    assert.ok(profile.requiredCapabilities.includes("web"));
  });

  it("prefers explicit metadata over rules", () => {
    const profile = profileTask({
      objective: "Summarise these notes",
      context: NOTES,
      metadata: { category: "classification", localOnly: true, complexity: "moderate" },
    });
    assert.equal(profile.category, "classification");
    assert.equal(profile.constraints.locality, "local_only");
    assert.equal(profile.complexity, "moderate");
    assert.equal(profile.source, "metadata");
  });

  it("marks an unmatched task uncertain rather than guessing a category", () => {
    const profile = profileTask({ objective: "Handle the thing from yesterday" });
    assert.equal(profile.category, "other");
    assert.equal(profile.routingUncertain, true);
  });
});

describe("decideRoute", () => {
  it("sends a short summary to the enabled local model", () => {
    const record = route("Summarise these meeting notes into five bullets", [claude, qwen], { context: NOTES });
    assert.equal(record.status, "selected");
    assert.equal(record.selected?.modelId, "qwen3:4b");
    assert.equal(record.selected?.location, "local");
    assert.match(record.reason, /qwen3:4b/);
    // The fallback is the existing worker, and only one is planned.
    assert.deepEqual(record.fallbackPlan.map((f) => f.optionId), ["claude"]);
  });

  it("sends a repository change to the tool-capable worker, not the text-only model", () => {
    const record = route(
      "Implement authentication across this application and run its tests",
      [qwen, claude],
      { repoPath: "/repo" },
    );
    assert.equal(record.selected?.optionId, "claude");
    const why = record.rejected.find((r) => r.optionId === qwen.id)?.reason;
    assert.match(why ?? "", /Lacks required capability: .*tools/);
    // The text-only model is never a fallback for tool work either.
    assert.equal(record.fallbackPlan.length, 0);
  });

  it("does not truncate: input over the local limit is rejected, and routed elsewhere", () => {
    const big = "notes ".repeat(2_000); // ~3,000 tokens
    const record = route("Summarise these notes", [qwen, claude], { context: big });
    assert.equal(record.selected?.optionId, "claude");
    assert.match(record.rejected.find((r) => r.optionId === qwen.id)?.reason ?? "", /will not be truncated/);
  });

  it("blocks an oversize local-only task instead of using the cloud", () => {
    const big = "notes ".repeat(2_000);
    const record = route("Summarise these notes", [qwen, claude], {
      context: big,
      metadata: { localOnly: true },
    });
    assert.equal(record.status, "blocked");
    assert.equal(record.selected, undefined);
    assert.match(record.rejected.find((r) => r.optionId === "claude")?.reason ?? "", /local-only/);
  });

  it("never plans a cloud fallback for a local-only task", () => {
    const second = { ...qwen, id: "ollama:llama3.2:3b", modelId: "llama3.2:3b", loaded: false };
    const record = route("Summarise these meeting notes", [claude, qwen, second], {
      context: NOTES,
      metadata: { localOnly: true },
    });
    assert.equal(record.status, "selected");
    assert.equal(record.selected?.optionId, qwen.id); // loaded model preferred
    assert.ok(record.fallbackPlan.every((f) => f.location === "local"));
  });

  it("blocks local-only work as retryable when Ollama is down, and does not go to the cloud", () => {
    const offline = { ...qwen, available: false, unavailableReason: "Ollama is not reachable." };
    const record = route("Summarise these meeting notes", [offline, claude], {
      context: NOTES,
      metadata: { localOnly: true },
    });
    assert.equal(record.status, "blocked");
    assert.equal(record.retryable, true);
    assert.match(record.blockedReason ?? "", /not sent to the cloud/);
  });

  it("'local only' mode tightens a cloud-allowed task", () => {
    const record = route("Summarise these meeting notes", [claude], { context: NOTES }, "local_only");
    assert.equal(record.status, "blocked");
  });

  it("falls to the cloud worker when Ollama is offline and the task allows it", () => {
    const offline = { ...qwen, available: false, unavailableReason: "Ollama is not reachable." };
    const record = route("Summarise these meeting notes", [offline, claude], { context: NOTES });
    assert.equal(record.selected?.optionId, "claude");
  });

  it("routes uncertain tasks to the capable worker, not the local model", () => {
    const record = route("Handle the thing from yesterday", [qwen, claude]);
    assert.equal(record.selected?.optionId, "claude");
  });

  it("excludes embedding-only and non-enabled models from generation", () => {
    const embed: ExecutionOption = { ...qwen, id: "ollama:nomic-embed-text", modelId: "nomic-embed-text", embeddingOnly: true };
    const off: ExecutionOption = { ...qwen, id: "ollama:phi3", modelId: "phi3", enabled: false };
    const record = route("Summarise these meeting notes", [embed, off, qwen], { context: NOTES });
    assert.equal(record.selected?.optionId, qwen.id);
    assert.match(record.rejected.find((r) => r.optionId === embed.id)?.reason ?? "", /Embedding-only/);
    assert.match(record.rejected.find((r) => r.optionId === off.id)?.reason ?? "", /not enabled/);
  });

  it("applies budget as a hard filter and treats unknown cost as unknown", () => {
    const record = route("Implement the feature in this repo", [claude], { repoPath: "/r", metadata: { budgetUsd: 1 } });
    assert.equal(record.status, "blocked");
    assert.match(record.rejected[0].reason, /cost is unknown/);
  });

  it("notes queuing when the local model is at its concurrency limit", () => {
    const record = decideRoute({
      profile: profileTask({ objective: "Summarise these meeting notes", context: NOTES }),
      options: [qwen, claude],
      mode: "auto",
      activeCounts: { [qwen.id]: 1 },
    });
    assert.equal(record.selected?.optionId, qwen.id);
    assert.equal(record.queued, true);
  });

  it("manual override succeeds when eligible and is recorded", () => {
    const record = route("Summarise these meeting notes", [qwen, claude], { context: NOTES }, "manual", "claude");
    assert.equal(record.selected?.optionId, "claude");
    assert.equal(record.overriddenByOperator, true);
  });

  it("manual override explains the missing capability", () => {
    const record = route("Implement auth in this repo and run tests", [qwen, claude], { repoPath: "/r" }, "manual", qwen.id);
    assert.equal(record.status, "blocked");
    assert.match(record.blockedReason ?? "", /Override rejected: Lacks required capability/);
  });

  it("manual override cannot pick a cloud option for a local-only task", () => {
    const record = route("Summarise these notes", [qwen, claude], { context: NOTES, metadata: { localOnly: true } }, "manual", "claude");
    assert.equal(record.status, "blocked");
  });

  it("produces a record that round-trips through the persisted schemas", () => {
    const record = route("Summarise these meeting notes", [qwen, claude], { context: NOTES });
    assert.doesNotThrow(() => RoutePolicyRecordSchema.parse(JSON.parse(JSON.stringify(record))));

    // Old decisions without a policy still parse.
    const legacy = WorkerRoutingDecisionSchema.parse({
      selectedWorker: "claude",
      confidence: "low",
      reasons: [],
      decidedBy: "agentos",
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(legacy.policy, undefined);
  });
});

describe("ollama-config", () => {
  const installed = [
    { name: "qwen3:4b", digest: "abc123", capabilities: ["completion", "tools"] },
    { name: "nomic-embed-text:latest", digest: "def456", capabilities: ["embedding"] },
    { name: "llama3.2:3b" },
  ];

  it("discovers qwen3:4b but does not enable it", () => {
    const options = buildOllamaOptions(undefined, { reachable: true, installed, loaded: ["qwen3:4b"] });
    const q = options.find((o) => o.modelId === "qwen3:4b");
    assert.ok(q);
    assert.equal(q.enabled, false);
    assert.equal(q.available, true);
    assert.equal(q.loaded, true);
    assert.equal(q.modelDigest, "abc123");
  });

  it("enables only on an explicit entry, and never for embedding models", () => {
    const settings = {
      baseUrl: "http://127.0.0.1:11434",
      maxConcurrent: 1,
      fallback: "none" as const,
      models: {
        "qwen3:4b": { ...defaultModelConfig(), enabled: true },
        "nomic-embed-text:latest": { ...defaultModelConfig(), enabled: true },
      },
    };
    const options = buildOllamaOptions(settings, { reachable: true, installed, loaded: [] });
    assert.equal(options.find((o) => o.modelId === "qwen3:4b")?.enabled, true);
    assert.equal(options.find((o) => o.modelId === "nomic-embed-text:latest")?.enabled, false);
    assert.equal(options.find((o) => o.modelId === "nomic-embed-text:latest")?.embeddingOnly, true);
    assert.equal(options.find((o) => o.modelId === "llama3.2:3b")?.enabled, false);
  });

  it("offers structured output only to models configured for it", () => {
    const withSchema = { ...defaultModelConfig(), enabled: true, structuredOutput: true };
    const settings = { baseUrl: "x", maxConcurrent: 1, fallback: "none" as const, models: { "qwen3:4b": withSchema, "llama3.2:3b": { ...withSchema, structuredOutput: false, capabilities: ["text" as const, "structured_output" as const] } } };
    const options = buildOllamaOptions(settings, { reachable: true, installed, loaded: [] });
    assert.ok(options.find((o) => o.modelId === "qwen3:4b")?.capabilities.includes("structured_output"));
    assert.ok(!options.find((o) => o.modelId === "llama3.2:3b")?.capabilities.includes("structured_output"));
  });

  it("marks everything unavailable, with a reason, when Ollama is offline", () => {
    const settings = { baseUrl: "x", maxConcurrent: 1, fallback: "none" as const, models: { "qwen3:4b": { ...defaultModelConfig(), enabled: true } } };
    const options = buildOllamaOptions(settings, { reachable: false, unreachableReason: "connection refused", installed: [], loaded: [] });
    assert.equal(options.length, 1);
    assert.equal(options[0].available, false);
    assert.match(options[0].unavailableReason ?? "", /connection refused/);
  });

  it("reports a configured-but-missing model as unavailable (unmounted SSD)", () => {
    const settings = { baseUrl: "x", maxConcurrent: 1, fallback: "none" as const, models: { "qwen3:4b": { ...defaultModelConfig(), enabled: true } } };
    const options = buildOllamaOptions(settings, { reachable: true, installed: [], loaded: [] });
    assert.match(options[0].unavailableReason ?? "", /not installed/);
  });

  it("detects embedding models from capabilities, falling back to name", () => {
    assert.equal(isEmbeddingOnly({ name: "x", capabilities: ["embedding"] }), true);
    assert.equal(isEmbeddingOnly({ name: "qwen3:4b", capabilities: ["completion"] }), false);
    assert.equal(isEmbeddingOnly({ name: "nomic-embed-text" }), true);
    assert.equal(isEmbeddingOnly({ name: "bge-m3" }), true);
    assert.equal(isEmbeddingOnly({ name: "qwen3:4b" }), false);
  });
});

describe("suitability test results in routing", () => {
  const other: ExecutionOption = { ...qwen, id: "ollama:qwen2.5-coder:7b", modelId: "qwen2.5-coder:7b", loaded: false };

  it("does not route to a model that failed its test, even when it is the loaded one", () => {
    const failing = { ...qwen, loaded: true, probeVerdict: "unsuitable" as const };
    const passing = { ...other, probeVerdict: "suitable" as const };
    const record = route("Summarise these meeting notes", [failing, passing, claude], { context: NOTES });

    assert.equal(record.selected?.optionId, passing.id);
    assert.match(record.rejected.find((r) => r.optionId === failing.id)?.reason ?? "", /Failed its suitability test/);
    assert.ok(record.fallbackPlan.every((f) => f.optionId !== failing.id), "never a fallback either");
  });

  it("prefers a tested-good model over an untested loaded one", () => {
    const loadedUntested = { ...qwen, loaded: true };
    const testedGood = { ...other, probeVerdict: "suitable" as const };
    const record = route("Summarise these meeting notes", [loadedUntested, testedGood], { context: NOTES });
    assert.equal(record.selected?.optionId, testedGood.id);
    assert.match(record.reason, /passed its suitability test/);
  });

  it("still uses an untested model when nothing has been tested (testing is advice, not a gate on new models)", () => {
    const record = route("Summarise these meeting notes", [qwen, claude], { context: NOTES });
    assert.equal(record.selected?.optionId, qwen.id);
  });

  it("blocks a local-only task when its only model failed the test, and does not use the cloud", () => {
    const failing = { ...qwen, probeVerdict: "unsuitable" as const };
    const record = route("Summarise these meeting notes", [failing, claude], {
      context: NOTES,
      metadata: { localOnly: true },
    });
    assert.equal(record.status, "blocked");
  });

  it("a manual override of a failed model is refused with the reason", () => {
    const failing = { ...qwen, probeVerdict: "unsuitable" as const };
    const record = route("Summarise these meeting notes", [failing], { context: NOTES }, "manual", failing.id);
    assert.equal(record.status, "blocked");
    assert.match(record.blockedReason ?? "", /Override rejected: Failed its suitability test/);
  });
});
