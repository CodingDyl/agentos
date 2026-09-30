import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

// Its own directory: a connector switched off here must not leak into any
// other test file's clients.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-connectors-"));
process.env.AGENTOS_UI_DIR = directory;

const { CONNECTORS, capabilityId, defaultPolicy, findCapability } = await import("../catalog");
const { authorize, decide, effectivePolicy, isConnectorEnabled, setConnectorEnabled } = await import("../policy");
const { resetConnectorStateCache, setStoredPolicies, usesFor, lastUsed, recordUse } = await import("../store");
const { resetAiSettingsCache } = await import("../../ai-stack/settings");
const { deriveConnectorStatus, updateConnector } = await import("../registry");
const { recommendConnectors } = await import("../recommendations");
const { ConnectorPatchSchema, connectorIdOf } = await import("../../../shared/connector-types");

beforeEach(() => {
  fs.rmSync(path.join(directory, "connectors.json"), { force: true });
  fs.rmSync(path.join(directory, "ai-stack.json"), { force: true });
  resetConnectorStateCache();
  resetAiSettingsCache();
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("the catalog", () => {
  it("has unique connector and capability ids, each prefixed by its connector", () => {
    const connectorIds = CONNECTORS.map((connector) => connector.id);
    assert.equal(new Set(connectorIds).size, connectorIds.length);

    const capabilityIds = CONNECTORS.flatMap((connector) => connector.capabilities.map((capability) => capabilityId(connector, capability)));
    assert.equal(new Set(capabilityIds).size, capabilityIds.length);
    for (const id of capabilityIds) assert.ok(connectorIds.includes(connectorIdOf(id)), id);
  });

  it("never claims code for a connector without an adapter", () => {
    for (const connector of CONNECTORS.filter((entry) => !entry.integrated)) {
      for (const capability of connector.capabilities) {
        assert.equal(capability.implementedBy, undefined, `${connector.id}.${capability.action}`);
      }
    }
  });

  it("points every implemented capability at a file that exists", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    for (const connector of CONNECTORS) {
      for (const capability of connector.capabilities) {
        if (capability.implementedBy) assert.ok(fs.existsSync(path.join(root, capability.implementedBy)), capability.implementedBy);
      }
    }
  });

  it("defaults destructive capabilities off and communication to approval", () => {
    assert.equal(defaultPolicy(findCapability("github.delete_repository")!.capability), "disabled");
    assert.equal(defaultPolicy(findCapability("investec.make_payment")!.capability), "disabled");
    assert.equal(defaultPolicy(findCapability("gmail.send")!.capability), "approval");
    assert.equal(defaultPolicy(findCapability("github.merge")!.capability), "approval");
    assert.equal(defaultPolicy(findCapability("github.create_repository")!.capability), "allowed");
  });
});

describe("the guard", () => {
  it("allows an enabled connector's allowed capability", () => {
    assert.deepEqual(decide("vercel.read_projects", "system"), { allowed: true, policy: "allowed" });
  });

  it("refuses everything on a connector that is switched off, and persists the switch", () => {
    setConnectorEnabled("vercel", false);
    resetConnectorStateCache();

    const decision = decide("vercel.read_projects", "person");
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.code, "connector-off");
    assert.equal(isConnectorEnabled("gmail"), true);
  });

  it("holds an approval capability back from an agent, but not from a person", () => {
    assert.equal(decide("gmail.send", "person").allowed, true);
    const agent = decide("gmail.send", "agent");
    assert.equal(agent.allowed === false && agent.code, "approval-required");
  });

  it("refuses a disabled capability to everyone", () => {
    setStoredPolicies({ "git.commit": "disabled" });
    const decision = decide("git.commit", "person");
    assert.equal(decision.allowed === false && decision.code, "capability-disabled");
  });

  it("restores a default when the override is cleared", () => {
    setStoredPolicies({ "gmail.send": "allowed" });
    assert.equal(effectivePolicy("gmail.send"), "allowed");
    setStoredPolicies({ "gmail.send": null });
    assert.equal(effectivePolicy("gmail.send"), "approval");
  });

  it("refuses an unknown capability", () => {
    const decision = decide("github.launch_rockets", "person");
    assert.equal(decision.allowed === false && decision.code, "unknown-capability");
  });

  it("drives the AI stack's switch for Hermes, Claude and Grok", async () => {
    setConnectorEnabled("grok", false);
    const { isAiEnabled } = await import("../../ai-stack/settings");
    assert.equal(isAiEnabled("grok"), false);
    assert.equal(decide("grok.run_job", "system").allowed, false);
  });

  it("has no switch for the vault", async () => {
    await assert.rejects(() => updateConnector("filesystem", { enabled: false }), /runs on it/);
    assert.equal(isConnectorEnabled("filesystem"), true);
  });

  it("records actions in history and reads only as last used", () => {
    const now = new Date("2026-09-30T16:42:00.000Z");
    authorize("git.create_branch", { initiator: "person", detail: "rankpulse: main", now });
    authorize("vercel.read_projects", { initiator: "system", now });

    assert.equal(usesFor("git").length, 1);
    assert.equal(usesFor("git")[0].detail, "rankpulse: main");
    assert.equal(usesFor("vercel").length, 0);
    assert.equal(lastUsed("vercel"), now.toISOString());
  });

  it("records nothing when it refuses", () => {
    setConnectorEnabled("git", false);
    authorize("git.commit", { initiator: "person" });
    assert.equal(usesFor("git").length, 0);
    assert.equal(lastUsed("git"), undefined);
  });

  it("keeps each connector's history separately capped", () => {
    for (let index = 0; index < 40; index += 1) {
      recordUse("gmail", { capabilityId: "gmail.modify", capabilityName: "Modify", at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString() });
    }
    recordUse("git", { capabilityId: "git.commit", capabilityName: "Commit", at: "2026-09-02T00:00:00.000Z" });
    for (let index = 0; index < 40; index += 1) {
      recordUse("gmail", { capabilityId: "gmail.modify", capabilityName: "Modify", at: new Date(Date.UTC(2026, 8, 3, 0, index)).toISOString() });
    }
    assert.equal(usesFor("gmail", 100).length, 25);
    assert.equal(usesFor("git").length, 1);
  });
});

describe("connector status", () => {
  it("separates no adapter, not set up, failing and connected", () => {
    assert.equal(deriveConnectorStatus({ integrated: false, configured: true }), "unavailable");
    assert.equal(deriveConnectorStatus({ integrated: true, configured: false, lastTestOk: false }), "disconnected");
    assert.equal(deriveConnectorStatus({ integrated: true, configured: true, lastTestOk: false }), "error");
    assert.equal(deriveConnectorStatus({ integrated: true, configured: true }), "connected");
    assert.equal(deriveConnectorStatus({ integrated: true, configured: true, lastTestOk: true }), "connected");
  });

  it("rejects a patch with fields it doesn't know", () => {
    assert.equal(ConnectorPatchSchema.safeParse({ enabled: true, token: "x" }).success, false);
    assert.equal(ConnectorPatchSchema.safeParse({ policies: { "gmail.send": "maybe" } }).success, false);
  });

  it("refuses a policy for another connector's capability", async () => {
    await assert.rejects(() => updateConnector("gmail", { policies: { "github.merge": "allowed" } }), /not a capability of Gmail/);
  });
});

describe("recommendations", () => {
  const connectors = [
    { id: "search-console", name: "Search Console", icon: "search", status: "unavailable" as const },
    { id: "ga4", name: "Google Analytics 4", icon: "bar-chart", status: "unavailable" as const },
    { id: "posthog", name: "PostHog", icon: "activity", status: "unavailable" as const },
    { id: "sentry", name: "Sentry", icon: "bug", status: "unavailable" as const },
    { id: "stripe", name: "Stripe", icon: "credit-card", status: "unavailable" as const },
    { id: "vercel", name: "Vercel", icon: "triangle", status: "connected" as const },
  ];

  const pantryPilot = {
    slug: "pantry-pilot",
    name: "Pantry Pilot",
    workspaceType: "product" as const,
    openTasks: ["Fix meta descriptions on recipe pages", "Submit sitemap", "Tidy onboarding copy"],
    seoAuditCount: 0,
    hasVercelProject: true,
  };

  it("ties each recommendation to the workspace and the evidence", () => {
    const recommendations = recommendConnectors([pantryPilot], connectors);
    const searchConsole = recommendations.find((entry) => entry.connectorId === "search-console");

    assert.ok(searchConsole);
    assert.equal(searchConsole.projectName, "Pantry Pilot");
    assert.match(searchConsole.why, /2 open SEO tasks/);
    assert.ok(recommendations.some((entry) => entry.connectorId === "posthog" && /no product usage data for Pantry Pilot/.test(entry.why)));
  });

  it("leads with the strongest reason and never suggests what is connected", () => {
    const recommendations = recommendConnectors([pantryPilot], connectors);
    assert.equal(recommendations[0].connectorId, "search-console");
    assert.ok(!recommendations.some((entry) => entry.connectorId === "vercel"));
  });

  it("suggests nothing for a workspace with nothing to say", () => {
    const quiet = { slug: "notes", name: "Notes", workspaceType: "personal" as const, openTasks: ["Read a book"], seoAuditCount: 0, hasVercelProject: false };
    assert.deepEqual(recommendConnectors([quiet], connectors), []);
  });
});
