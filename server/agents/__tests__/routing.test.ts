import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkerJobRequest } from "../../../shared/worker-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-agent-route-"));
const previous = process.env.AGENTOS_UI_DIR;
process.env.AGENTOS_UI_DIR = directory;

const { resetAgentsCache, updateAgentRecord } = await import("../store");
const {
  applyAgentLaunchPolicy,
  heuristicAgent,
  resolveAgentAssignment,
  shouldRouteWithJev,
} = await import("../route");
const { listAgentRecords } = await import("../store");
const { DEFAULT_AGENT_ID } = await import("../seeds");

before(() => {
  resetAgentsCache();
});

after(() => {
  resetAgentsCache();
  if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
  else process.env.AGENTOS_UI_DIR = previous;
  fs.rmSync(directory, { recursive: true, force: true });
});

function request(partial: Partial<WorkerJobRequest> = {}): WorkerJobRequest {
  return {
    worker: "mock",
    project: "agentos",
    objective: "Implement the login form",
    ...partial,
  };
}

describe("heuristic specialist routing", () => {
  it("sends a GSAP motion brief to Motion Studio", () => {
    const agents = listAgentRecords();
    assert.equal(heuristicAgent("Build a cinematic GSAP scroll site", "brand", agents).id, "motion-studio");
  });

  it("sends a Pantry Pilot workspace job to Pantry Pilot", () => {
    const agents = listAgentRecords();
    assert.equal(heuristicAgent("Fix the grocery list query", "pantry-pilot", agents).id, "pantry-pilot");
  });

  it("sends Java 8 Gradle work to Entelect", () => {
    const agents = listAgentRecords();
    assert.equal(heuristicAgent("Update the Gradle build for Java 8", "entelect", agents).id, "entelect");
  });

  it("falls back to Chief of Staff when nothing matches", () => {
    const agents = listAgentRecords();
    assert.equal(heuristicAgent("What is on the board this morning?", undefined, agents).id, DEFAULT_AGENT_ID);
  });
});

describe("resolveAgentAssignment", () => {
  it("honours an explicit agentId", async () => {
    const result = await resolveAgentAssignment({
      objective: "Anything",
      agentId: "site-audit",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.decision?.source, "tagged");
    assert.equal(result.agent?.id, "site-audit");
  });

  it("tags Motion Design as Motion Studio", async () => {
    const result = await resolveAgentAssignment({
      objective: "Propose two concepts",
      flow: "motion-design",
    });
    assert.equal(result.agent?.id, "motion-studio");
    assert.equal(result.decision?.source, "tagged");
  });

  it("refuses an unknown tagged id", async () => {
    const result = await resolveAgentAssignment({ objective: "Hi", agentId: "not-real" });
    assert.equal(result.error?.includes("not-real"), true);
  });

  it("uses Jev's choice when a send function is given", async () => {
    const result = await resolveAgentAssignment({
      objective: "Please look at this vaguely worded thing",
      send: async () => ({
        model: "jev-latest",
        answers: {
          agentId: {
            type: "choice",
            choice: "finance",
            probabilities: { finance: 0.9, "chief-of-staff": 0.1 },
            confidence: 0.9,
          },
        },
      }),
    });
    assert.equal(result.agent?.id, "finance");
    assert.equal(result.decision?.source, "jev");
  });

  it("falls back to the heuristic when Jev's answer cannot be read", async () => {
    const result = await resolveAgentAssignment({
      objective: "Implement a Supabase RPC for pantry-pilot",
      project: "pantry-pilot",
      send: async () => ({ model: "jev-latest", answers: {} }),
    });
    assert.equal(result.agent?.id, "pantry-pilot");
    assert.equal(result.decision?.source, "heuristic");
  });

  it("asks Jev only when a send function is given or the live switch is on", () => {
    assert.equal(
      shouldRouteWithJev(async () => ({ model: "jev-latest", answers: {} })),
      true,
    );
  });
});

describe("applyAgentLaunchPolicy", () => {
  it("stamps agentId, prepends standing instructions, and overlays effort", () => {
    resetAgentsCache();
    const agent = listAgentRecords().find((entry) => entry.id === "backend-engineer");
    assert.ok(agent);
    const applied = applyAgentLaunchPolicy({
      agent: { ...agent, standingInstructions: "Write the test first.", memoryNotes: "Prefer Node." },
      request: request({ objective: "Add the endpoint", constraints: ["Keep it small"] }),
    });
    assert.equal(applied.error, undefined);
    assert.equal(applied.request.agentId, "backend-engineer");
    assert.equal(applied.request.effort, "medium");
    assert.equal(applied.request.constraints?.[0]?.includes("Backend Engineer"), true);
    assert.equal(applied.request.constraints?.some((line) => line.includes("Write the test first.")), true);
    assert.equal(applied.request.constraints?.some((line) => line.includes("Prefer Node.")), true);
    assert.equal(applied.request.constraints?.includes("Keep it small"), true);
  });

  it("leaves the original brief alone on retry", () => {
    const agent = listAgentRecords().find((entry) => entry.id === "backend-engineer");
    assert.ok(agent);
    const applied = applyAgentLaunchPolicy({
      agent,
      request: request({ constraints: ["Keep it small"] }),
      brief: false,
    });
    assert.deepEqual(applied.request.constraints, ["Keep it small"]);
    assert.equal(applied.request.agentId, "backend-engineer");
  });

  it("keeps an allowed model override and drops a disallowed one", () => {
    const agent = listAgentRecords().find((entry) => entry.id === "life-ops");
    assert.ok(agent);
    const allowed = applyAgentLaunchPolicy({
      agent,
      request: request({ modelOverride: "haiku" }),
    });
    assert.equal(allowed.request.modelOverride, "haiku");

    const refused = applyAgentLaunchPolicy({
      agent,
      request: request({ modelOverride: "gpt-secret" }),
    });
    assert.equal(refused.request.modelOverride, undefined);
  });

  it("unions extra tools with the agent's grants", () => {
    const agent = listAgentRecords().find((entry) => entry.id === "motion-studio");
    assert.ok(agent);
    const applied = applyAgentLaunchPolicy({
      agent,
      request: request({ extraAllowedTools: ["Bash(higgsfield:*)"] }),
    });
    assert.equal(applied.request.extraAllowedTools?.includes("Bash(higgsfield:*)"), true);
    assert.equal(applied.request.extraAllowedTools?.includes("Write"), true);
  });

  it("refuses a skill that is not on the allowlist", () => {
    resetAgentsCache();
    const agent = updateAgentRecord("site-audit", { allowedSkills: ["seo-audit"] });
    const applied = applyAgentLaunchPolicy({
      agent,
      request: request({ skillId: "other-skill" }),
    });
    assert.equal(typeof applied.error, "string");
    assert.equal(applied.error?.includes("other-skill"), true);
  });
});
