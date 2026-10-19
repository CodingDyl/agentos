import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentSummary } from "@shared/agent-types";
import { csv, filterAgents, parseCsv, spendLabel, spendRatio, spendTone } from "../agents-model";

function agent(partial: Partial<AgentSummary> & Pick<AgentSummary, "id" | "name">): AgentSummary {
  return {
    avatar: "•",
    role: "Role",
    mission: "Mission",
    standingInstructions: "",
    modelRoutes: {},
    allowedModelOverrides: [],
    allowedTools: [],
    allowedConnectors: [],
    allowedSkills: [],
    creditCeilingUsd: 40,
    linkedWorkspaces: [],
    schedules: [],
    memoryNotes: "",
    keywords: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    openJobs: 0,
    spend: { usd: 0, ceilingUsd: 40, windowLabel: "January", from: "", to: "", jobs: 0 },
    ...partial,
  };
}

describe("agent spend labels", () => {
  it("formats spend against a ceiling", () => {
    assert.equal(spendLabel({ usd: 12.5, ceilingUsd: 40 }), "$12.50 / $40");
    assert.equal(spendLabel({ usd: 3, ceilingUsd: 0 }), "$3.00 this month");
  });

  it("turns over-ceiling spend flame", () => {
    assert.equal(spendTone({ usd: 50, ceilingUsd: 40 }), "flame");
    assert.equal(spendRatio({ usd: 20, ceilingUsd: 40 }), 0.5);
  });
});

describe("filterAgents", () => {
  const agents = [
    agent({ id: "frontend-friend", name: "Frontend Friend", openJobs: 1, linkedWorkspaces: ["pantry-pilot"], keywords: ["react"] }),
    agent({ id: "finance", name: "Finance", openJobs: 0, keywords: ["budget"] }),
  ];

  it("filters busy agents and matches a query", () => {
    assert.equal(filterAgents(agents, { status: "busy", workspace: "all", query: "" }).map((entry) => entry.id).join(), "frontend-friend");
    assert.equal(filterAgents(agents, { status: "all", workspace: "all", query: "budget" }).map((entry) => entry.id).join(), "finance");
    assert.equal(filterAgents(agents, { status: "all", workspace: "pantry-pilot", query: "" }).map((entry) => entry.id).join(), "frontend-friend");
  });
});

describe("csv helpers", () => {
  it("round-trips a list", () => {
    assert.deepEqual(parseCsv("react, next, expo"), ["react", "next", "expo"]);
    assert.equal(csv(["haiku", "sonnet"]), "haiku, sonnet");
  });
});
