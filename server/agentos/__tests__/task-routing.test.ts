import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { defaultOllamaModelConfig } from "../../../shared/route-policy-types";
import type { DelegationPlan } from "../../../shared/delegation-types";

/**
 * Delegating a project task now routes through the route policy.
 *
 * Real vault files, a real git repository, the real policy and job manager,
 * against a fake Ollama and a stub hosted worker. What is under test is that a
 * task's routing follows what the task needs (a repository means a worker with
 * tools) and that everything the operator can ask for is honoured or refused
 * with a reason.
 */

let vault: string;
let repo: string;
let ollama: http.Server;
let ollamaUrl: string;
let cloudRuns = 0;

let delegation: typeof import("../task-delegation");
let settings: typeof import("../../ai-stack/settings");
let manager: typeof import("../../workers/job-manager");
let store: typeof import("../../workers/job-store");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const plan = (project: string, objective: string): DelegationPlan => ({
  taskId: "T-001",
  project,
  objective,
  contextFiles: [],
  constraints: [],
  acceptanceCriteria: [],
  validationCommands: [],
  scopedBy: "hermes",
});

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
  process.env.AGENTOS_ROOT = vault;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ui-"));

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-taskrepo-"));
  execFileSync("git", ["init", "-q", "."], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "# t\n");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "i"], { cwd: repo });

  fs.mkdirSync(path.join(vault, "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(vault, "projects", "PORTFOLIO.md"),
    [
      "# Project Portfolio",
      "",
      "## Projects",
      "",
      "### With Repo",
      "Type: Software",
      "State: Active",
      "Priority: High",
      "",
      "### No Repo",
      "Type: Software",
      "State: Active",
      "Priority: Low",
      "",
    ].join("\n"),
  );

  for (const [slug, body] of [
    ["with-repo", `# With Repo\n\n## Connected Systems\n- Local repository: ${repo}\n`],
    ["no-repo", "# No Repo\n\nJust notes.\n"],
  ] as const) {
    fs.mkdirSync(path.join(vault, "projects", slug), { recursive: true });
    fs.writeFileSync(path.join(vault, "projects", slug, "PROJECT.md"), body);
    fs.writeFileSync(path.join(vault, "projects", slug, "TASKS.md"), "# Tasks\n\n## Now\n\n- [ ] [T-001] Do the thing\n- [ ] [T-002] Do another thing\n- [ ] [T-003] Do a third thing\n- [ ] [T-004] Do a fourth thing\n");
  }

  ollama = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const send = (payload: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/api/tags") return send({ models: [{ name: "m:1b", digest: "sha256:m", details: {} }] });
    if (req.url === "/api/ps") return send({ models: [] });
    if (req.url === "/api/show") return send({ capabilities: ["completion"] });
    return send({});
  });
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;

  settings = await import("../../ai-stack/settings");
  delegation = await import("../task-delegation");
  manager = await import("../../workers/job-manager");
  store = await import("../../workers/job-store");
  const registry = await import("../../workers/registry");

  registry.registerWorker({
    id: "claude",
    name: "Stub hosted worker",
    role: "test double",
    capabilities: ["code", "research"],
    healthCheck: async () => ({ available: true }),
    start: async () => {
      cloudRuns += 1;
      return { summary: "done", changedFiles: [] };
    },
  });
});

after(async () => {
  ollama.closeAllConnections?.();
  await new Promise<void>((resolve) => ollama.close(() => resolve()));
});

const enableLocalModel = () => {
  settings.resetAiSettingsCache();
  settings.setOllamaSettings({
    baseUrl: ollamaUrl,
    maxConcurrent: 1,
    fallback: "none",
    models: { "m:1b": { ...defaultOllamaModelConfig(), enabled: true } },
  });
};

beforeEach(() => {
  cloudRuns = 0;
  enableLocalModel();
});

describe("routePlan", () => {
  it("sends a task with a repository to a tool-capable worker, and shows why the local model was ruled out", async () => {
    const route = await delegation.routePlan("with-repo", plan("with-repo", "Add a retry button to the recipe screen"), "auto");
    assert.equal(route.routing?.selectedWorker, "claude");
    assert.ok(route.policy);
    assert.match(
      route.policy?.rejected.find((r) => r.optionId === "ollama:m:1b")?.reason ?? "",
      /Lacks required capability/,
    );
  });

  it("can send a small task with no repository to the local model", async () => {
    const route = await delegation.routePlan("no-repo", plan("no-repo", "Summarise the meeting notes into five bullets"), "auto");
    assert.equal(route.routing?.selectedWorker, "ollama");
    assert.equal(route.policy?.selected?.modelId, "m:1b");
    // The operator's setting is "fail", so a local failure has no cloud fallback.
    assert.equal(route.policy?.fallbackPlan.length, 0);
  });

  it("plans one hosted fallback for it when the operator allows that", async () => {
    settings.resetAiSettingsCache();
    settings.setOllamaSettings({
      baseUrl: ollamaUrl,
      maxConcurrent: 1,
      fallback: "cloud",
      models: { "m:1b": { ...defaultOllamaModelConfig(), enabled: true } },
    });
    const route = await delegation.routePlan("no-repo", plan("no-repo", "Summarise the meeting notes into five bullets"), "auto");
    assert.deepEqual(route.policy?.fallbackPlan.map((f) => f.optionId), ["claude"]);
  });

  it("blocks a local-only task that needs a repository, with the reasons, and does not use the cloud", async () => {
    const route = await delegation.routePlan(
      "with-repo",
      plan("with-repo", "Add a retry button to the recipe screen"),
      "auto",
      { routingMode: "local_only" },
    );
    assert.equal(route.routing, undefined);
    assert.equal(route.policy?.status, "blocked");
    assert.match(route.routingError ?? "", /local-only/);
    assert.match(route.policy?.rejected.find((r) => r.optionId === "claude")?.reason ?? "", /local-only/);
  });

  it("honours a valid manual choice and records it as an override", async () => {
    const route = await delegation.routePlan("with-repo", plan("with-repo", "Add a retry button"), "auto", {
      routingMode: "manual",
      manualOptionId: "claude",
    });
    assert.equal(route.policy?.overriddenByOperator, true);
    assert.equal(route.routing?.selectedWorker, "claude");
  });

  it("refuses a manual choice that cannot do the task, and says what is missing", async () => {
    const route = await delegation.routePlan("with-repo", plan("with-repo", "Add a retry button"), "auto", {
      routingMode: "manual",
      manualOptionId: "ollama:m:1b",
    });
    assert.equal(route.routing, undefined);
    assert.match(route.routingError ?? "", /Override rejected: Lacks required capability/);
  });

  it("leaves an explicit worker with no routing mode alone", async () => {
    const route = await delegation.routePlan("with-repo", plan("with-repo", "Add a retry button"), "claude");
    assert.deepEqual(route, {});
  });

  it("uses the existing Hermes routing when the policy has nothing to add", async () => {
    settings.resetAiSettingsCache();
    settings.setOllamaSettings({ baseUrl: ollamaUrl, maxConcurrent: 1, fallback: "none", models: {} });
    const route = await delegation.routePlan("with-repo", plan("with-repo", "Add a retry button"), "auto");
    assert.equal(route.policy, undefined, "no policy record: the legacy path decided");
    assert.equal(route.routing?.selectedWorker, "claude");
  });

  it("re-checks a route for an existing task without scoping it again", async () => {
    const ok = await delegation.previewTaskRoute("with-repo", "T-001", plan("with-repo", "Add a retry button"), "auto");
    assert.equal(ok.route?.routing?.selectedWorker, "claude");

    const missing = await delegation.previewTaskRoute("with-repo", "T-999", plan("with-repo", "x"), "auto");
    assert.equal(missing.route, undefined);
    assert.match(missing.error ?? "", /not a task/);
  });
});

describe("milestone batches", () => {
  it("carry the routing mode to each task, so a local-only batch cannot reach the cloud", async () => {
    const milestone = await import("../milestone-delegation");
    const result = await milestone.startMilestoneDelegation("with-repo", {
      tasks: [
        {
          taskId: "T-004",
          plan: plan("with-repo", "Add a retry button to the recipe screen"),
          worker: "auto",
          routingMode: "local_only",
        },
      ],
    });
    assert.equal(result.started.length, 0);
    assert.match(result.failed[0]?.error ?? "", /local-only/);
    assert.equal(cloudRuns, 0);
  });
});

describe("delegateTask", () => {
  it("runs the job on the policy's choice and records the route on it", async () => {
    const { job, error } = await delegation.delegateTask("with-repo", "T-001", {
      plan: plan("with-repo", "Add a retry button to the recipe screen"),
      worker: "auto",
      routingMode: "auto",
    });
    assert.equal(error, undefined);
    assert.equal(job?.resolvedWorker, "claude");
    assert.match(job?.routing?.policy?.reason ?? "", /claude/);
    for (let i = 0; i < 200 && manager.isRunning(job!.id); i += 1) await sleep(25);
    assert.equal(cloudRuns, 1);
    assert.equal((await store.readJob(job!.id))?.attempts?.[0].outcome, "succeeded");
  });

  it("refuses to start a local-only task that no local model can take", async () => {
    const { job, error } = await delegation.delegateTask("with-repo", "T-002", {
      plan: plan("with-repo", "Add a retry button to the recipe screen"),
      worker: "auto",
      routingMode: "local_only",
    });
    assert.equal(job, undefined);
    assert.match(error ?? "", /local-only/);
    assert.equal(cloudRuns, 0);
  });

  it("never trusts a route policy sent with the approval", async () => {
    const forged = {
      selectedWorker: "claude" as const,
      confidence: "high" as const,
      reasons: ["FORGED"],
      decidedBy: "agentos" as const,
      decidedAt: new Date().toISOString(),
      policy: {
        policyVersion: "route-policy/1",
        mode: "auto" as const,
        status: "selected" as const,
        selected: { optionId: "claude", workerId: "claude" as const, location: "cloud" as const },
        reason: "FORGED",
        rejected: [],
        fallbackPlan: [{ optionId: "claude", workerId: "claude" as const, location: "cloud" as const }],
        overriddenByOperator: false,
        decidedAt: new Date().toISOString(),
        profile: {
          category: "coding" as const, complexity: "complex" as const, complexityReason: "x",
          estimatedInputTokens: 1, outputBudgetTokens: 512, requiredCapabilities: ["text" as const],
          constraints: { locality: "cloud_allowed" as const, reviewRequired: false },
          missingInformation: [], routingUncertain: false, source: "rules" as const,
        },
      },
    };
    const { job } = await delegation.delegateTask("with-repo", "T-003", {
      plan: plan("with-repo", "Add a retry button to the recipe screen"),
      worker: "auto",
      routing: forged,
    });
    assert.ok(job);
    assert.notEqual(job?.routing?.policy?.reason, "FORGED");
    assert.notEqual(job?.routing?.policy?.profile.constraints.reviewRequired, false);
    for (let i = 0; i < 200 && manager.isRunning(job!.id); i += 1) await sleep(25);
  });
});
