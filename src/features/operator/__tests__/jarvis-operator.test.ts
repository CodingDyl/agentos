import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OperatorRun, OperatorStep } from "@shared/operator-types";
import { acknowledge, approvalGate, narrate, parseVoiceCommand, readPlan, statusBrief } from "../jarvis-operator";
import { runDigest } from "../operator-model";

function step(overrides: Partial<OperatorStep>): OperatorStep {
  return { id: "s", title: "Step", operation: "x", actor: "AgentOS", risk: "local-write", external: false, dependsOn: [], status: "pending", outputs: [], ...overrides };
}

function run(overrides: Partial<OperatorRun>): OperatorRun {
  return {
    id: "run_1",
    input: "Build RankPulse",
    mode: "run",
    plan: [],
    risks: [],
    agents: [],
    connectors: [],
    status: "planning",
    changes: [],
    memoryProposals: [],
    taskProposals: [],
    jobIds: [],
    errors: [],
    usage: { modelCalls: 0, estimate: "" },
    startedAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("what Jarvis hears on Operator", () => {
  it("treats a short command as a command, and a longer sentence as a request", () => {
    assert.deepEqual(parseVoiceCommand("Stop.", "run"), { kind: "stop" });
    assert.deepEqual(parseVoiceCommand("Jarvis, stop the run", "run"), { kind: "stop" });
    assert.deepEqual(parseVoiceCommand("stop the pricing page breaking on mobile", "run"), {
      kind: "request",
      mode: "run",
      input: "stop the pricing page breaking on mobile",
    });
  });

  it("knows approve, confirm, status and the plan", () => {
    assert.deepEqual(parseVoiceCommand("Go ahead", "run"), { kind: "approve" });
    assert.deepEqual(parseVoiceCommand("Confirm.", "run"), { kind: "confirm" });
    assert.deepEqual(parseVoiceCommand("What's happening?", "run"), { kind: "status" });
    assert.deepEqual(parseVoiceCommand("Read me the plan", "run"), { kind: "read-plan" });
    assert.deepEqual(parseVoiceCommand("Run this plan", "ask"), { kind: "run-plan" });
    assert.deepEqual(parseVoiceCommand("Switch to plan mode", "run"), { kind: "mode", mode: "plan" });
  });

  it("picks the mode from how the request is said", () => {
    assert.deepEqual(parseVoiceCommand("Plan a landing page for Virtara", "run"), { kind: "request", mode: "plan", input: "Plan a landing page for Virtara" });
    assert.deepEqual(parseVoiceCommand("What are the SEO problems with Virtara?", "run"), {
      kind: "request",
      mode: "ask",
      input: "What are the SEO problems with Virtara?",
    });
    assert.deepEqual(parseVoiceCommand("Ask: who owes me money", "run"), { kind: "request", mode: "ask", input: "who owes me money" });
    assert.deepEqual(parseVoiceCommand("Build a SaaS called RankPulse", "plan"), { kind: "request", mode: "plan", input: "Build a SaaS called RankPulse" });
    assert.equal(parseVoiceCommand("Jarvis.", "run"), undefined);
  });

  it("asks for a spoken confirm before anything leaves this machine", () => {
    const external = run({ status: "awaiting_approval", plan: [step({ id: "repo", title: "Create GitHub repository", external: true, risk: "external-write" })] });
    const gate = approvalGate(external);
    assert.equal(gate.needsConfirm, true);
    assert.match(gate.say, /create GitHub repository.*Say confirm/);

    const local = run({ status: "awaiting_approval", plan: [step({ title: "Create project folder" })] });
    assert.equal(approvalGate(local).needsConfirm, false);
  });
});

describe("what Jarvis says about a run", () => {
  const planned = run({
    status: "awaiting_approval",
    intent: {
      router: "rules",
      domain: "coding",
      domainScores: [],
      intent: "Create project",
      interpretedAs: "New software project",
      risk: "local-write",
      workflow: "new-code-project",
      workspace: { action: "create", slug: "rank-pulse", name: "RankPulse" },
      requiredCapabilities: [],
      why: "",
    },
    plan: [
      step({ id: "folder", title: "Create project folder" }),
      step({ id: "workspace", title: "Create AgentOS workspace" }),
      step({ id: "repo", title: "Create GitHub repository", status: "blocked", external: true }),
    ],
  });

  it("says nothing on first sight of a run", () => {
    assert.equal(narrate(undefined, planned), undefined);
    assert.equal(narrate(run({ id: "run_other" }), planned), undefined);
  });

  it("briefs the approval when planning finishes", () => {
    const said = narrate(run({ status: "planning" }), planned) ?? "";
    assert.match(said, /New software project, RankPulse\. 2 of 3 steps can run here, 1 can't yet\./);
    assert.match(said, /create project folder and create AgentOS workspace/);
    assert.match(said, /Say approve/);
  });

  it("says each step as it finishes, then how it ended", () => {
    const running = { ...planned, status: "running" as const };
    const folderDone = { ...running, plan: running.plan.map((entry) => (entry.id === "folder" ? { ...entry, status: "done" as const } : entry)) };
    assert.equal(narrate(running, folderDone), "Create project folder, done.");

    const finished = {
      ...folderDone,
      status: "blocked" as const,
      plan: folderDone.plan.map((entry) => (entry.id === "workspace" ? { ...entry, status: "done" as const } : entry.id === "repo" ? { ...entry, reason: "No adapter." } : entry)),
    };
    const said = narrate(folderDone, finished) ?? "";
    assert.match(said, /^Create AgentOS workspace, done\. Finished what I could: 2 of 3 steps\. Create GitHub repository can't run yet\. No adapter\.$/);
  });

  it("reads Ask's answer, and answers status and the plan", () => {
    const asked = run({ mode: "ask", status: "completed", report: { summary: "", answer: "Virtara has 14 pages with thin metadata.", sources: [] } });
    assert.equal(narrate(run({ mode: "ask", status: "running" }), asked), "Virtara has 14 pages with thin metadata.");
    assert.equal(statusBrief(undefined), "No run is open. Tell me what you want done.");
    assert.match(readPlan(planned), /^3 steps\. 1, create project folder\. .*3, create GitHub repository, can't run yet\.$/);
    assert.match(acknowledge("run"), /ask before anything changes/);
  });
});

describe("the message digest", () => {
  it("shows progress while working and only the breakdown at the end", () => {
    const working = run({
      status: "running",
      plan: [step({ id: "a", title: "Create project folder", status: "done" }), step({ id: "b", title: "Create AgentOS workspace", status: "running" })],
    });
    const progress = runDigest(working);
    assert.equal(progress.phase, "working");
    assert.deepEqual(progress.done, ["Create project folder"]);
    assert.equal(progress.current, "Create AgentOS workspace");

    const ended = runDigest({ ...working, status: "completed", plan: working.plan.map((entry) => ({ ...entry, status: "done" as const })) });
    assert.equal(ended.phase, "done");
    assert.equal(ended.headline, "Done. 2 of 2 steps.");
  });

  it("gives an Ask reply as the answer alone", () => {
    const digest = runDigest(run({ mode: "ask", status: "completed", report: { summary: "2 of 2 steps done.", answer: "Yes.", sources: [{ label: "Note" }] } }));
    assert.equal(digest.headline, "");
    assert.equal(digest.answer, "Yes.");
    assert.equal(digest.sourceCount, 1);
  });
});
