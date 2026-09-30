import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OperatorRun, OperatorRunSummary, OperatorStep } from "@shared/operator-types";
import {
  decisionRows,
  groupRunsByDay,
  isStoppable,
  linkKind,
  pendingExternalSteps,
  runStatusLabel,
  stepCounts,
  stepGlyph,
  stepNumber,
} from "../operator-model";

function step(overrides: Partial<OperatorStep>): OperatorStep {
  return { id: "s", title: "Step", operation: "x", actor: "AgentOS", risk: "read", external: false, dependsOn: [], status: "pending", outputs: [], ...overrides };
}

function summary(startedAt: string, id = startedAt): OperatorRunSummary {
  return { id, input: "x", mode: "run", status: "completed", startedAt, title: "x" };
}

describe("operator wording", () => {
  it("never says a run that stopped short completed", () => {
    assert.equal(runStatusLabel("blocked"), "Stopped short");
    assert.equal(runStatusLabel("completed"), "Completed");
  });

  it("offers Stop for as long as the run can still do anything", () => {
    assert.equal(isStoppable("planning"), true);
    assert.equal(isStoppable("awaiting_approval"), true);
    assert.equal(isStoppable("running"), true);
    assert.equal(isStoppable("completed"), false);
    assert.equal(isStoppable("stopped"), false);
  });

  it("gives blocked and done steps different glyphs", () => {
    assert.notEqual(stepGlyph("blocked"), stepGlyph("done"));
    assert.equal(stepGlyph("done"), "✓");
    assert.equal(stepNumber(0), "01");
    assert.equal(stepNumber(10), "11");
  });

  it("lists only pending external steps for approval", () => {
    const plan = [
      step({ id: "a", external: true, status: "pending", title: "Create GitHub repository" }),
      step({ id: "b", external: true, status: "blocked" }),
      step({ id: "c", external: false, status: "pending" }),
    ];
    assert.deepEqual(pendingExternalSteps(plan).map((entry) => entry.id), ["a"]);
    assert.deepEqual(stepCounts(plan), { runnable: 2, blocked: 1, done: 0, total: 3 });
  });

  it("shows decisions, including where it builds and hosts", () => {
    const run = {
      intent: {
        router: "rules",
        domain: "coding",
        domainScores: [{ domain: "coding", score: 0.91 }],
        intent: "Create project",
        interpretedAs: "New software project",
        risk: "external-write",
        workflow: "new-code-project",
        workspace: { action: "create", slug: "rank-pulse", name: "RankPulse" },
        requiredCapabilities: [],
        why: "",
      },
      connectors: ["github", "vercel"],
      plan: [step({ actor: "Claude" })],
    } as unknown as OperatorRun;

    const rows = Object.fromEntries(decisionRows(run).map((row) => [row.label, row.value]));
    assert.equal(rows["Interpreted as"], "New software project");
    assert.equal(rows.Workspace, "Create · RankPulse");
    assert.equal(rows["Implementation worker"], "Claude");
    assert.equal(rows.Repository, "GitHub");
    assert.equal(rows.Host, "Vercel");
    assert.equal(rows.Risk, "External writes");
  });

  it("groups recent runs under Today and Yesterday, newest first", () => {
    const now = new Date(2026, 8, 30, 15, 0);
    const groups = groupRunsByDay(
      [summary(new Date(2026, 8, 29, 10).toISOString(), "y"), summary(new Date(2026, 8, 30, 9).toISOString(), "a"), summary(new Date(2026, 8, 30, 12).toISOString(), "b")],
      now,
    );
    assert.deepEqual(groups.map((group) => group.label), ["Today", "Yesterday"]);
    assert.deepEqual(groups[0].runs.map((run) => run.id), ["b", "a"]);
  });

  it("links only to AgentOS paths and http(s)", () => {
    assert.equal(linkKind("/workspaces/virtara"), "internal");
    assert.equal(linkKind("https://example.com"), "external");
    assert.equal(linkKind("//evil.example"), "none");
    assert.equal(linkKind("javascript:alert(1)"), "none");
    assert.equal(linkKind(undefined), "none");
  });
});
