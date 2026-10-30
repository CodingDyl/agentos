import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OllamaModelConfig, RoutePolicyRecord } from "../../../../shared/route-policy-types";
import {
  describeAttempt,
  explainBlock,
  enableWarning,
  failureLabel,
  fellBack,
  formatMs,
  modelConfigProblem,
  optionLabel,
  probeBadge,
  parseSchemaInput,
  providerChargeLabel,
  shortDigest,
  toggleCategory,
} from "../route-policy-model";

const config = (over: Partial<OllamaModelConfig> = {}): OllamaModelConfig => ({
  enabled: true,
  categories: ["summarisation"],
  capabilities: ["text"],
  maxInputTokens: 2000,
  maxOutputTokens: 512,
  timeoutMs: 30_000,
  structuredOutput: false,
  allowThinking: false,
  ...over,
});

describe("cost wording", () => {
  it("calls a local run a $0 provider charge, never free", () => {
    const label = providerChargeLabel({ location: "local", costUsd: 0 });
    assert.match(label, /\$0 provider API charge/);
    assert.doesNotMatch(label, /free/i);
  });

  it("leaves unknown costs unknown", () => {
    assert.equal(providerChargeLabel(undefined), "Cost unknown");
    assert.equal(providerChargeLabel({ location: "cloud" }), "Cost unknown");
    assert.equal(providerChargeLabel({ location: "cloud", costUsd: 0.4 }), "$0.40");
  });
});

describe("attempt wording", () => {
  it("names the failure, usage and timings including cold load", () => {
    const text = describeAttempt({
      attempt: 1, optionId: "ollama:qwen3:4b", workerId: "ollama", location: "local",
      startedAt: "", outcome: "succeeded", trigger: "initial",
      inputTokens: 40, outputTokens: 12, queueMs: 0, loadMs: 900, totalMs: 1500,
    });
    assert.match(text, /40 in \/ 12 out tokens/);
    assert.match(text, /model load 900ms/);
    assert.match(text, /total 1\.5s/);
  });

  it("explains a failure by kind, and falls back to the raw kind if unknown", () => {
    assert.match(failureLabel("model_missing"), /SSD/);
    assert.equal(failureLabel("something_new"), "something new");
    assert.equal(failureLabel(undefined), "Failed");
  });

  it("detects a fallback from the attempt count", () => {
    assert.equal(fellBack({ attempts: undefined }), false);
    assert.equal(fellBack({ attempts: [{}, {}] as never }), true);
  });

  it("formats durations and missing values", () => {
    assert.equal(formatMs(840), "840ms");
    assert.equal(formatMs(1234), "1.2s");
    assert.equal(formatMs(undefined), undefined);
  });
});

describe("labels", () => {
  it("shows worker and exact model", () => {
    assert.equal(optionLabel({ workerId: "ollama", modelId: "qwen3:4b" }, () => "Ollama"), "Ollama · qwen3:4b");
    assert.equal(optionLabel({ workerId: "claude" }), "claude");
  });

  it("shortens a digest for display", () => {
    assert.equal(shortDigest("sha256:0123456789abcdef0123"), "0123456789ab");
    assert.equal(shortDigest(undefined), undefined);
  });
});

describe("model configuration", () => {
  it("rejects nonsense limits before they are saved", () => {
    assert.match(modelConfigProblem(config({ maxInputTokens: 0 })) ?? "", /Input limit/);
    assert.match(modelConfigProblem(config({ maxOutputTokens: 1.5 })) ?? "", /Output limit/);
    assert.match(modelConfigProblem(config({ timeoutMs: 200 })) ?? "", /Timeout/);
    assert.equal(modelConfigProblem(config()), undefined);
  });

  it("will not enable a model with no categories", () => {
    assert.match(modelConfigProblem(config({ categories: [] })) ?? "", /category/);
    assert.equal(modelConfigProblem(config({ categories: [], enabled: false })), undefined);
  });

  it("toggles categories without mutating", () => {
    const start = ["summarisation"] as const;
    assert.deepEqual(toggleCategory([...start], "extraction"), ["summarisation", "extraction"]);
    assert.deepEqual(toggleCategory([...start], "summarisation"), []);
    assert.deepEqual(start, ["summarisation"]);
  });

  it("parses the schema box: empty ok, object ok, junk explained", () => {
    assert.deepEqual(parseSchemaInput("  "), {});
    assert.deepEqual(parseSchemaInput('{"type":"object"}'), { schema: { type: "object" } });
    assert.match(parseSchemaInput("{oops").error ?? "", /not valid JSON/);
    assert.match(parseSchemaInput("[1]").error ?? "", /object/);
  });
});

describe("probe status", () => {
  const limits = { maxInputTokens: 2000, maxOutputTokens: 512, timeoutMs: 30_000 };
  const record = (over: Record<string, unknown> = {}) =>
    ({
      model: "m",
      testedAt: "",
      verdict: "suitable",
      summary: "",
      checks: [],
      variants: [],
      limits,
      stale: false,
      ...over,
    }) as never;

  it("says a model has not been tested rather than implying it is fine", () => {
    assert.deepEqual(probeBadge(undefined, limits), { label: "Not tested", tone: "neutral" });
  });

  it("reports pass and fail", () => {
    assert.equal(probeBadge(record(), limits).tone, "good");
    assert.equal(probeBadge(record({ verdict: "unsuitable" }), limits).tone, "bad");
  });

  it("does not let an old verdict vouch for a new build or new limits", () => {
    assert.match(probeBadge(record({ stale: true }), limits).label, /older build/);
    assert.match(probeBadge(record(), { ...limits, maxOutputTokens: 900 }).label, /Limits changed/);
    assert.equal(probeBadge(record({ verdict: "unsuitable", stale: true }), limits).tone, "neutral");
  });

  it("warns only when an enabled model has a current failing verdict", () => {
    const failing = record({ verdict: "unsuitable" });
    assert.match(enableWarning(failing, { ...limits, enabled: true }) ?? "", /failed its suitability test/);
    assert.equal(enableWarning(failing, { ...limits, enabled: false }), undefined);
    assert.equal(enableWarning(record(), { ...limits, enabled: true }), undefined);
    assert.equal(enableWarning(undefined, { ...limits, enabled: true }), undefined);
  });
});

const blockedRecord = (over: Partial<RoutePolicyRecord> = {}): RoutePolicyRecord =>
  ({
    policyVersion: "route-policy/1",
    mode: "auto",
    profile: {} as RoutePolicyRecord["profile"],
    rejected: [],
    decidedAt: "2026-10-30T00:00:00.000Z",
    status: "blocked",
    reason: "No execution option satisfies this task's requirements.",
    blockedReason: "No execution option satisfies this task's requirements.",
    retryable: false,
    fallbackPlan: [],
    overriddenByOperator: false,
    ...over,
  }) as RoutePolicyRecord;

describe("explainBlock", () => {
  it("names the capability nearly every option lacks, and a way past it", () => {
    const explanation = explainBlock(
      blockedRecord({
        rejected: [
          { optionId: "claude", reason: "Lacks required capability: vision." },
          { optionId: "codex", reason: "Lacks required capability: vision." },
          { optionId: "gemini", reason: "Gemini CLI is switched off in Operations → AI Stack." },
          { optionId: "ollama:qwen3:4b", reason: "Installed but not enabled for routing. Enable it first." },
        ],
      }),
    );
    assert.match(explanation.causes[0], /look at images, and 2 of 4 options can't/);
    assert.ok(explanation.causes.some((cause) => /gemini/.test(cause)));
    assert.ok(explanation.fixes.some((fix) => /photo, image or screenshot/.test(fix)));
    assert.ok(explanation.fixes.some((fix) => /Switch on gemini/.test(fix)));
  });

  it("explains a rejected manual choice without suggesting the same choice", () => {
    const explanation = explainBlock(
      blockedRecord({ blockedReason: "Override rejected: Lacks required capability: vision.", mode: "manual" }),
    );
    assert.deepEqual(explanation.causes, ["Lacks required capability: vision."]);
    assert.match(explanation.fixes[0], /different worker/);
  });

  it("separates a local-only task that can wait from one that can't", () => {
    const waiting = explainBlock(
      blockedRecord({ blockedReason: "Task is local-only and no local model is available right now. It was not sent to the cloud.", retryable: true }),
    );
    assert.match(waiting.fixes[0], /Start Ollama/);
    const never = explainBlock(
      blockedRecord({ blockedReason: "Task is local-only and no enabled local model can take it. It was not sent to the cloud." }),
    );
    assert.match(never.fixes[0], /Enable a local model/);
  });

  it("passes through a reason it cannot classify, in the router's words", () => {
    const explanation = explainBlock(
      blockedRecord({ rejected: [{ optionId: "grok", reason: "Configured cost $2.00 exceeds the $1.00 budget." }] }),
    );
    assert.deepEqual(explanation.causes, ["grok: Configured cost $2.00 exceeds the $1.00 budget."]);
    assert.ok(explanation.fixes.length > 0);
  });
});
