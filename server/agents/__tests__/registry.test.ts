import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-agents-"));
const previous = process.env.AGENTOS_UI_DIR;
process.env.AGENTOS_UI_DIR = directory;

const { getAgentRecord, listAgentRecords, resetAgentsCache, updateAgentRecord, AgentStoreError } =
  await import("../store");
const { SEED_AGENTS } = await import("../seeds");

before(() => {
  resetAgentsCache();
});

after(() => {
  resetAgentsCache();
  if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
  else process.env.AGENTOS_UI_DIR = previous;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("the agent registry", () => {
  it("seeds the operator's team into an empty store", () => {
    const agents = listAgentRecords();
    const ids = agents.map((agent) => agent.id);
    for (const seed of SEED_AGENTS) {
      assert.equal(ids.includes(seed.id), true, `missing seed ${seed.id}`);
    }
    assert.equal(getAgentRecord("chief-of-staff")?.name, "Chief of Staff");
    assert.equal(getAgentRecord("motion-studio")?.avatar, "🎬");
    assert.ok((getAgentRecord("frontend-friend")?.allowedTools.length ?? 0) > 0);
    assert.equal(fs.existsSync(path.join(directory, "agents.json")), true);
  });

  it("fills empty seed allowedTools on an existing registry row", () => {
    const file = path.join(directory, "agents.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      agents: Array<{ id: string; allowedTools: string[] }>;
    };
    parsed.agents = parsed.agents.map((agent) =>
      agent.id === "frontend-friend" ? { ...agent, allowedTools: [] } : agent,
    );
    fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
    resetAgentsCache();
    assert.ok((getAgentRecord("frontend-friend")?.allowedTools.length ?? 0) > 0);
  });

  it("persists an edit and does not overwrite it on reload", () => {
    const updated = updateAgentRecord("frontend-friend", {
      standingInstructions: "Prefer existing paper components.",
      creditCeilingUsd: 120,
      memoryNotes: "Expo work lives on pantry-pilot.",
    });
    assert.equal(updated.standingInstructions, "Prefer existing paper components.");
    assert.equal(updated.creditCeilingUsd, 120);

    resetAgentsCache();
    const reread = getAgentRecord("frontend-friend");
    assert.equal(reread?.standingInstructions, "Prefer existing paper components.");
    assert.equal(reread?.creditCeilingUsd, 120);
    assert.equal(reread?.memoryNotes, "Expo work lives on pantry-pilot.");
    assert.equal(reread?.name, "Frontend Friend");
  });

  it("refuses an unknown id", () => {
    assert.throws(() => updateAgentRecord("not-an-agent", { name: "Ghost" }), AgentStoreError);
  });

  it("keeps a seed id that was already known from coming back as a duplicate", () => {
    const before = listAgentRecords().filter((agent) => agent.id === "finance").length;
    resetAgentsCache();
    const after = listAgentRecords().filter((agent) => agent.id === "finance").length;
    assert.equal(before, 1);
    assert.equal(after, 1);
  });
});
