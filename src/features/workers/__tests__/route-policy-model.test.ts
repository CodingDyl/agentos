import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OllamaModelConfig } from "../../../../shared/route-policy-types";
import {
  describeAttempt,
  failureLabel,
  fellBack,
  formatMs,
  modelConfigProblem,
  optionLabel,
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
