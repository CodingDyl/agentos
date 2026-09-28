import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readCuratorStatus,
  readEmergencyStop,
  readHooksList,
  readKanbanStats,
  readSchedulerStatus,
  readWebhookList,
} from "../automation-surfaces";
import { readJobRecipes } from "../automations";

// Captured from a real `hermes curator status`, 2026-09-28.
const CURATOR = `curator: ENABLED
  runs:           10
  last run:       4d ago
  last summary:   auto: no changes; llm: skipped (consolidation off)
  interval:       every 7d
  stale after:    30d unused

curator-managed skills: 58 total  (agent-created=0  bundled=58)
  active     16
  stale      42
  archived   0

unmanaged (no provenance marker): 48 total
  pre-dates marker    6
`;

describe("readCuratorStatus", () => {
  it("reads state, cadence, last run and skill counts", () => {
    assert.deepEqual(readCuratorStatus(CURATOR), {
      state: "enabled",
      interval: "every 7d",
      lastRun: "4d ago",
      lastSummary: "auto: no changes; llm: skipped (consolidation off)",
      skills: { active: 16, stale: 42, archived: 0 },
    });
  });

  it("reads a paused curator", () => {
    assert.equal(readCuratorStatus("curator: PAUSED\n  runs: 3\n").state, "paused");
  });

  it("is unknown rather than wrong when the output is unfamiliar", () => {
    assert.equal(readCuratorStatus("something else entirely").state, "unknown");
  });
});

describe("readSchedulerStatus", () => {
  it("knows the gateway is running", () => {
    const status = readSchedulerStatus(
      "\n✓ Gateway is running — cron jobs will fire automatically\n  PID: 5616, 5617\n",
    );
    assert.deepEqual(status, { running: true, detail: "Gateway is running — cron jobs will fire automatically" });
  });

  it("reports a stopped gateway in Hermes' words", () => {
    const status = readSchedulerStatus("\n✗ Gateway is not running — cron jobs will NOT fire\n");
    assert.equal(status.running, false);
    assert.match(status.detail ?? "", /not running/);
  });
});

describe("readHooksList and readWebhookList", () => {
  it("reads 'none configured' for hooks", () => {
    assert.deepEqual(
      readHooksList("No shell hooks or outbound webhooks configured in ~/.hermes/config.yaml.\nSee `hermes hooks --help`\n"),
      { configured: false, entries: [] },
    );
  });

  it("reads a disabled webhook platform", () => {
    assert.deepEqual(readWebhookList("  Webhook platform is not enabled. To set it up:\n  1. Run ...\n"), {
      enabled: false,
      entries: [],
    });
  });
});

describe("readKanbanStats", () => {
  it("reads counts by status, and an empty board", () => {
    assert.deepEqual(readKanbanStats('{"by_status": {"ready": 2, "running": 1}, "now": 1}'), {
      readable: true,
      byStatus: { ready: 2, running: 1 },
    });
    assert.deepEqual(readKanbanStats('{"by_status": {}}'), { readable: true, byStatus: {} });
    assert.equal(readKanbanStats("not json").readable, false);
  });
});

describe("readEmergencyStop", () => {
  it("is off when there is no sentinel, on when there is, with its reason", () => {
    assert.deepEqual(readEmergencyStop(undefined), { engaged: false });
    assert.deepEqual(readEmergencyStop('{"reason": "runaway job"}'), { engaged: true, reason: "runaway job" });
    assert.deepEqual(readEmergencyStop(""), { engaged: true });
  });
});

describe("readJobRecipes", () => {
  it("reads prompt, delivery and folder from Hermes' job record", () => {
    const recipes = readJobRecipes(
      JSON.stringify({
        jobs: [
          {
            id: "aa7e0f5cc594",
            prompt: "Run the start-day workflow.",
            script: null,
            deliver: "local",
            workdir: "/Users/dylanpetzer/AgentOS",
            model: null,
            enabled_toolsets: ["web"],
          },
          { name: "no id — skipped" },
        ],
      }),
    );
    assert.equal(recipes.size, 1);
    assert.deepEqual(recipes.get("aa7e0f5cc594"), {
      prompt: "Run the start-day workflow.",
      script: undefined,
      noAgent: undefined,
      deliver: "local",
      workdir: "/Users/dylanpetzer/AgentOS",
      model: undefined,
      provider: undefined,
      toolsets: ["web"],
    });
  });

  it("returns nothing rather than throwing on a broken file", () => {
    assert.equal(readJobRecipes("{not json").size, 0);
  });
});
