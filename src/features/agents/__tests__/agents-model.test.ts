import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentSummary } from "@shared/agent-types";
import { csv, filterAgents, jobsLabel, parseCsv } from "../agents-model";

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

describe("jobsLabel", () => {
  it("counts the month's jobs in plain words", () => {
    assert.equal(jobsLabel(1), "1 job this month");
    assert.equal(jobsLabel(12), "12 jobs this month");
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
