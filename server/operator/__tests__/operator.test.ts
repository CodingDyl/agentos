import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-operator-"));
process.env.AGENTOS_UI_DIR = directory;

const { RuleBasedRouter, HermesRouter, detectTargetUrl, extractProjectName, matchWorkspace, scoreDomains, resolveIntentRouter } = await import("../intent-router");
const { RUNBOOKS } = await import("../runbooks");
const { approveRun, createRun, reconcileInterrupted, stopRun, RunStateError } = await import("../engine");
const { readRun, saveRun, listRuns, isRunId } = await import("../store");
const { capabilityGap, runbookSummaries } = await import("../service");
const { findCapability } = await import("../../connectors/catalog");
type EngineDeps = import("../engine").EngineDeps;
type OperationRegistry = import("../engine").OperationRegistry;
type OperatorRun = import("../../../shared/operator-types").OperatorRun;

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const WORKSPACES = [
  { slug: "virtara", name: "Virtara" },
  { slug: "pantry-pilot", name: "Pantry Pilot" },
  { slug: "pantry", name: "Pantry" },
];

const route = (input: string, mode: "ask" | "plan" | "run" = "run") =>
  new RuleBasedRouter().route({ input, mode, workspaces: WORKSPACES, projectsRoot: "/Volumes/SSD/Developer" });

describe("the rule-based router", () => {
  it("reads the RankPulse request as a new coding project with external writes", async () => {
    const decision = await route(
      "Build me a new SEO monitoring SaaS called RankPulse on my SSD, use Next.js and Supabase, create the GitHub repo and deploy it to Vercel.",
    );
    assert.equal(decision.router, "rules");
    assert.equal(decision.domain, "coding");
    assert.equal(decision.workflow, "new-code-project");
    assert.deepEqual(decision.workspace, { action: "create", slug: "rank-pulse", name: "RankPulse" });
    assert.equal(decision.risk, "external-write");
    for (const capability of ["github.create_repository", "vercel.deploy_production", "claude.run_job", "git.init", "filesystem.create_directory"]) {
      assert.ok(decision.requiredCapabilities.includes(capability), capability);
    }
    assert.match(decision.why, /Next\.js/);
  });

  it("routes an SEO audit to an existing workspace", async () => {
    const decision = await route("Audit Virtara SEO and create the highest priority work for next week.");
    assert.equal(decision.domain, "seo");
    assert.equal(decision.workflow, "seo-audit");
    assert.deepEqual(decision.workspace, { action: "use", slug: "virtara", name: "Virtara" });
  });

  it("reads a business idea as a venture", async () => {
    const decision = await route("I want to test a SaaS for South African estate agents that automatically creates listing content.");
    assert.equal(decision.workflow, "business-venture");
  });

  it("files work on an existing workspace as a task, preferring the longest name", async () => {
    const decision = await route("Add a pricing page to Pantry Pilot.");
    assert.equal(decision.workflow, "existing-project-task");
    assert.equal(decision.workspace?.slug, "pantry-pilot");
  });

  it("never plans a write in Ask mode, whatever the request says", async () => {
    const decision = await route("Build me a new app called Foo and deploy it to Vercel", "ask");
    assert.equal(decision.workflow, "question");
    assert.equal(decision.risk, "read");
  });

  it("treats a question as a question even in Run mode", async () => {
    const decision = await route("What are the biggest SEO problems with Virtara?");
    assert.equal(decision.workflow, "question");
    assert.equal(decision.workspace?.slug, "virtara");
  });

  it("scores domains that sum to about one, highest first", () => {
    const scores = scoreDomains("Build a Next.js app and deploy it to Vercel");
    assert.equal(scores[0].domain, "coding");
    const total = scores.reduce((sum, entry) => sum + entry.score, 0);
    assert.ok(Math.abs(total - 1) < 0.05, String(total));
    assert.equal(scoreDomains("")[0].domain, "research");
  });

  it("finds URLs without mistaking Next.js or robots.txt for a domain", () => {
    assert.equal(detectTargetUrl("Audit https://virtara.co.za/services, please"), "https://virtara.co.za/services");
    assert.equal(detectTargetUrl("audit virtara.co.za"), "https://virtara.co.za");
    assert.equal(detectTargetUrl("Use Next.js and check robots.txt"), undefined);
    assert.equal(detectTargetUrl("javascript:alert(1)"), undefined);
  });

  it("extracts a project name, and matches workspaces on word boundaries only", () => {
    assert.equal(extractProjectName("a SaaS called RankPulse on my SSD"), "RankPulse");
    assert.equal(extractProjectName('name it "Estate Content"'), "Estate Content");
    assert.equal(matchWorkspace("Improve pantrypilot", WORKSPACES), undefined);
  });

  it("uses Hermes only when asked to", () => {
    assert.equal(resolveIntentRouter({}).id, "rules");
    assert.equal(resolveIntentRouter({ AGENTOS_OPERATOR_ROUTER: "hermes" }).id, "hermes");
  });

  it("falls back to the rules when Hermes can't answer, and says so", async () => {
    const decision = await new HermesRouter().route({ input: "Audit Virtara SEO", mode: "run", workspaces: WORKSPACES });
    assert.equal(decision.router, "rules");
    assert.match(decision.why, /Routed by rules/);
  });
});

describe("runbooks", () => {
  it("only depend on steps that come earlier, with unique ids", () => {
    for (const runbook of Object.values(RUNBOOKS)) {
      for (const workspace of [undefined, { action: "use" as const, slug: "a", name: "A" }, { action: "create" as const, slug: "b", name: "B" }]) {
        const steps = runbook.steps({ workspace, stack: [] });
        const seen = new Set<string>();
        for (const step of steps) {
          assert.ok(!seen.has(step.id), `${runbook.id}: duplicate ${step.id}`);
          for (const dependency of step.dependsOn) assert.ok(seen.has(dependency), `${runbook.id}: ${step.id} depends on later ${dependency}`);
          seen.add(step.id);
        }
      }
    }
  });

  it("name only capabilities the catalog knows", () => {
    for (const runbook of Object.values(RUNBOOKS)) {
      for (const step of runbook.steps({ stack: [] })) {
        if (step.capabilityId) assert.ok(findCapability(step.capabilityId), `${runbook.id}: ${step.capabilityId}`);
      }
    }
  });

  it("keeps the question runbook read-only", () => {
    for (const step of RUNBOOKS.question.steps({ workspace: { action: "use", slug: "v", name: "V" }, stack: [] })) {
      assert.equal(step.risk, "read", step.id);
    }
  });

  it("report honestly which steps are built", () => {
    const newSaas = runbookSummaries().find((runbook) => runbook.id === "new-code-project");
    assert.ok(newSaas);
    assert.equal(newSaas.steps.find((step) => step.title === "Create GitHub repository")?.implemented, false);
    assert.equal(newSaas.steps.find((step) => step.title === "Create AgentOS workspace")?.implemented, true);
  });

  it("explains a missing adapter distinctly from a policy refusal", () => {
    assert.match(capabilityGap("search-console.read_performance") ?? "", /no adapter/);
    assert.match(capabilityGap("github.create_repository") ?? "", /isn't built/);
    assert.equal(capabilityGap("filesystem.write_project_files"), undefined);
  });
});

// ------------------------------------------------------------------ engine

interface Harness {
  deps: EngineDeps;
  calls: string[];
  cancelled: string[];
  activity: string[];
}

function harness(overrides: Partial<EngineDeps> = {}, operations: OperationRegistry = {}): Harness {
  const calls: string[] = [];
  const cancelled: string[] = [];
  const activity: string[] = [];
  const fake = (name: string, write?: (context: Parameters<OperationRegistry[string]["run"]>[0]) => void) => ({
    async run(context: Parameters<OperationRegistry[string]["run"]>[0]) {
      calls.push(name);
      write?.(context);
      return { result: `${name} ok` };
    },
  });

  const deps: EngineDeps = {
    router: new RuleBasedRouter(),
    operations: {
      "memory.search": fake("memory.search"),
      "workspace.read": fake("workspace.read"),
      "hermes.answer": fake("hermes.answer", (context) => {
        context.scratch.answer = "The answer.";
      }),
      "agentos.create_workspace": fake("agentos.create_workspace", (context) => {
        context.scratch.workspaceSlug = context.run.intent?.workspace?.slug;
        context.change("local", "Workspace created");
      }),
      "agentos.seed_tasks": fake("agentos.seed_tasks"),
      "agentos.record": fake("agentos.record"),
      "agentos.create_task": fake("agentos.create_task", (context) => {
        context.scratch.taskId = "PP-1";
        context.change("local", "Task added");
      }),
      "worker.delegate": fake("worker.delegate", (context) => {
        context.run.jobIds.push("job-1");
      }),
      ...operations,
    },
    listWorkspaces: async () => WORKSPACES,
    planWithHermes: async () => undefined,
    decide: () => ({ allowed: true, policy: "allowed" }),
    authorize: () => ({ allowed: true, policy: "allowed" }),
    capabilityGap,
    save: saveRun,
    cancelJob: async (id) => {
      cancelled.push(id);
    },
    usageFor: () => ({}),
    activity: (type) => {
      activity.push(type);
    },
    ...overrides,
  };
  return { deps, calls, cancelled, activity };
}

describe("the engine", () => {
  it("answers in Ask mode without writing, and persists the run", async () => {
    const { deps, calls, activity } = harness();
    const { run, done } = await createRun("What are the biggest SEO problems with Virtara?", "ask", deps);
    assert.equal(run.status, "planning");
    assert.ok(isRunId(run.id));
    await done;

    const stored = await readRun(run.id);
    assert.equal(stored?.status, "completed");
    assert.deepEqual(calls, ["memory.search", "workspace.read", "hermes.answer"]);
    assert.equal(stored?.report?.answer, "The answer.");
    assert.equal(stored?.changes.length, 0);
    assert.deepEqual(activity, ["started", "completed"]);
  });

  it("plans in Plan mode and executes nothing", async () => {
    const { deps, calls } = harness();
    const { run, done } = await createRun("Build me a new SaaS called RankPulse with Next.js and deploy it to Vercel", "plan", deps);
    await done;

    const stored = (await readRun(run.id)) as OperatorRun;
    assert.equal(stored.status, "completed");
    assert.deepEqual(calls, []);
    const repo = stored.plan.find((step) => step.id === "repo");
    assert.equal(repo?.status, "blocked");
    assert.match(repo?.reason ?? "", /GitHub/);
    // Blocked upstream means blocked downstream, with the reason naming the step it waits on.
    assert.match(stored.plan.find((step) => step.id === "verify")?.reason ?? "", /Waits on “Deploy production”/);
    assert.equal(stored.plan.find((step) => step.id === "workspace")?.status, "pending");
    assert.ok(stored.connectors.includes("github"));
    assert.ok(stored.risks.some((risk) => /can't run here/.test(risk)));
  });

  it("waits for approval before any write in Run mode, then executes what it can", async () => {
    const { deps, calls } = harness();
    const { run, done } = await createRun("Build me a new SaaS called RankPulse with Next.js and deploy it to Vercel", "run", deps);
    await done;

    let stored = (await readRun(run.id)) as OperatorRun;
    assert.equal(stored.status, "awaiting_approval");
    assert.deepEqual(calls, []);

    const approved = await approveRun(stored, deps);
    await approved.done;

    stored = (await readRun(run.id)) as OperatorRun;
    assert.deepEqual(calls, ["agentos.create_workspace", "agentos.seed_tasks", "agentos.record"]);
    assert.equal(stored.status, "blocked");
    assert.equal(stored.changes.length, 1);
    assert.ok(stored.approvedAt);
    assert.match(stored.report?.nextAction ?? "", /Unblock/);

    await assert.rejects(approveRun(stored, deps), RunStateError);
  });

  it("re-checks each capability at the moment of use", async () => {
    const { deps, calls } = harness({
      authorize: (capabilityId) =>
        capabilityId === "claude.run_job" ? { allowed: false, code: "connector-off", reason: "Claude is switched off in Connectors." } : { allowed: true, policy: "allowed" },
    });
    const { run, done } = await createRun("Add a pricing page to Pantry Pilot.", "run", deps);
    await done;
    const approved = await approveRun((await readRun(run.id)) as OperatorRun, deps);
    await approved.done;

    const stored = (await readRun(run.id)) as OperatorRun;
    assert.deepEqual(calls, ["agentos.create_task", "agentos.record"]);
    const delegate = stored.plan.find((step) => step.id === "delegate");
    assert.equal(delegate?.status, "blocked");
    assert.match(delegate?.reason ?? "", /switched off/);
  });

  it("marks a failing step failed, skips what depends on it, and fails the run", async () => {
    const { deps } = harness({}, {
      "agentos.create_task": {
        async run() {
          throw new Error("TASKS.md is locked");
        },
      },
    });
    const { run, done } = await createRun("Add a pricing page to Pantry Pilot.", "run", deps);
    await done;
    await (await approveRun((await readRun(run.id)) as OperatorRun, deps)).done;

    const stored = (await readRun(run.id)) as OperatorRun;
    assert.equal(stored.status, "failed");
    assert.equal(stored.plan.find((step) => step.id === "delegate")?.status, "skipped");
    assert.ok(stored.errors.some((error) => /locked/.test(error)));
  });

  it("stops: finishes nothing further, cancels the run's jobs, rolls nothing back", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, calls, cancelled } = harness({}, {
      "worker.delegate": {
        async run(context) {
          context.run.jobIds.push("job-7");
          context.change("local", "Worker job started");
          calls.push("worker.delegate");
          await Promise.race([gate, new Promise((_, reject) => context.signal.addEventListener("abort", () => reject(new Error("aborted"))))]);
          return { result: "never" };
        },
      },
    });
    const { run, done } = await createRun("Add a pricing page to Pantry Pilot.", "run", deps);
    await done;
    const approved = await approveRun((await readRun(run.id)) as OperatorRun, deps);

    for (let tries = 0; !calls.includes("worker.delegate"); tries += 1) {
      assert.ok(tries < 200, "the delegate step never started");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const stopped = await stopRun((await readRun(run.id)) as OperatorRun, deps);
    await approved.done;
    release();

    assert.equal(stopped.status, "stopped");
    assert.deepEqual(cancelled, ["job-7"]);
    const stored = (await readRun(run.id)) as OperatorRun;
    assert.equal(stored.status, "stopped");
    assert.equal(stored.plan.find((step) => step.id === "delegate")?.status, "stopped");
    assert.equal(stored.plan.find((step) => step.id === "record")?.status, "stopped");
    // What changed before the stop is reported, not undone.
    assert.deepEqual(stored.changes.map((change) => change.description), ["Task added", "Worker job started"]);
    assert.match(stored.report?.summary ?? "", /nothing was rolled back/);
  });

  it("stops a run that is waiting for approval", async () => {
    const { deps } = harness();
    const { run, done } = await createRun("Add a pricing page to Pantry Pilot.", "run", deps);
    await done;
    const stopped = await stopRun((await readRun(run.id)) as OperatorRun, deps);
    assert.equal(stopped.status, "stopped");
    assert.ok(stopped.plan.every((step) => step.status !== "pending"));
    await assert.rejects(stopRun(stopped, deps), RunStateError);
  });

  it("marks runs a previous process was in the middle of as stopped", () => {
    const interrupted = reconcileInterrupted({
      id: "run_00000000-0000-0000-0000-000000000000",
      input: "x",
      mode: "run",
      plan: [
        { id: "a", title: "A", operation: "x", actor: "AgentOS", risk: "read", external: false, dependsOn: [], status: "done", outputs: [] },
        { id: "b", title: "B", operation: "x", actor: "AgentOS", risk: "read", external: false, dependsOn: [], status: "running", outputs: [] },
      ],
      risks: [],
      agents: [],
      connectors: [],
      status: "running",
      changes: [],
      memoryProposals: [],
      taskProposals: [],
      jobIds: [],
      errors: [],
      usage: { modelCalls: 0, estimate: "" },
      startedAt: new Date().toISOString(),
    });
    assert.equal(interrupted?.status, "stopped");
    assert.deepEqual(interrupted?.plan.map((step) => step.status), ["done", "stopped"]);
  });

  it("lists runs newest first and refuses ids that aren't run ids", async () => {
    const runs = await listRuns();
    assert.ok(runs.length >= 5);
    assert.ok(runs.every((run, index) => index === 0 || runs[index - 1].startedAt >= run.startedAt));
    assert.equal(await readRun("../../etc/passwd"), undefined);
    assert.equal(isRunId("run_../../x"), false);
  });
});
