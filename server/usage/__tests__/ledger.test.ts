import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The ledger against a real database.
 *
 * Worth doing rather than mocking, because the properties that matter here are
 * SQLite's: that an absent token count survives a round trip as an absence
 * rather than as a zero, that filters bind rather than interpolate, and that
 * the schema simply has no column a prompt could be written into.
 */

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-usage-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeUsageDatabase, usageDatabase } = await import("../db");
const { readUsage, recordUsage } = await import("../ledger");
const { listSubscriptions, saveSubscription } = await import("../subscriptions");
const { evaluateBudgets, listBudgets, saveBudget } = await import("../budgets");

before(() => {
  usageDatabase();
});

after(() => {
  closeUsageDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("the usage table", () => {
  it("has nowhere to put a prompt", () => {
    const columns = usageDatabase()
      .prepare("PRAGMA table_info(usage_events)")
      .all() as unknown as { name: string }[];

    const names = columns.map((column) => column.name);

    // Privacy enforced by schema rather than by discipline: a future caller
    // cannot persist message content, because there is no column for it.
    for (const forbidden of ["prompt", "response", "content", "messages", "api_key", "authorization"]) {
      assert.equal(names.includes(forbidden), false, `found ${forbidden}`);
    }
  });

  it("round-trips a fully measured record", () => {
    const written = recordUsage({
      source: "worker",
      operation: "implementation",
      agent: "claude",
      provider: "anthropic",
      model: "sonnet",
      project: "pantry-pilot",
      taskId: "PP-014",
      jobId: "job_42",
      tokens: { input: 18_291, output: 4_732, cachedInput: 12_000 },
      costUsd: 0.84,
      status: "exact",
      context: { files: 18, characters: 240_000 },
    });

    assert.ok(written);

    const [read] = readUsage({ jobId: "job_42" });

    assert.equal(read.tokens.input, 18_291);
    assert.equal(read.tokens.total, 35_023);
    assert.equal(read.costUsd, 0.84);
    assert.equal(read.costStatus, "exact");
    assert.equal(read.taskId, "PP-014");
    assert.equal(read.context?.files, 18);
  });

  it("keeps an unmeasured run absent rather than zero", () => {
    recordUsage({
      source: "worker",
      operation: "implementation",
      agent: "grok",
      jobId: "job_43",
      status: "unknown",
    });

    const [read] = readUsage({ jobId: "job_43" });

    assert.equal(read.tokens.total, undefined);
    assert.equal(read.tokens.input, undefined);
    assert.equal(read.costUsd, undefined);
    assert.equal(read.costStatus, "unknown");
    assert.equal(read.context, undefined);
  });

  it("filters by project without letting the value reach the planner", () => {
    recordUsage({
      source: "hermes",
      operation: "chat",
      agent: "hermes",
      project: "agentos'; DROP TABLE usage_events; --",
      status: "unknown",
    });

    const injected = readUsage({
      project: "agentos'; DROP TABLE usage_events; --",
    });

    assert.equal(injected.length, 1);
    // The table is still there, which is the actual assertion.
    assert.ok(readUsage({}).length >= 3);
  });
});

describe("subscriptions", () => {
  it("stores and updates one by id", () => {
    const created = saveSubscription({
      name: "Claude",
      provider: "anthropic",
      type: "subscription",
      price: 20,
      currency: "USD",
      billingCycle: "monthly",
      active: true,
    });

    assert.ok(created);

    saveSubscription({ ...created, price: 25 });

    const stored = listSubscriptions();

    assert.equal(stored.length, 1);
    assert.equal(stored[0].price, 25);
    assert.equal(stored[0].active, true);
  });
});

describe("budgets", () => {
  it("warns before it is exceeded and never acts", () => {
    saveBudget({ scope: "global", monthlyUsd: 50, warningPercent: 80 });

    const [ok] = evaluateBudgets(listBudgets(), [
      {
        id: "a",
        timestamp: "2026-09-10T10:00:00.000Z",
        source: "worker",
        operation: "implementation",
        agent: "claude",
        tokens: {},
        costUsd: 31.82,
        status: "unknown",
        costStatus: "exact",
      },
    ]);

    assert.equal(ok.state, "ok");
    assert.ok(Math.abs(ok.fraction - 0.6364) < 0.001);

    const [warning] = evaluateBudgets(listBudgets(), [
      {
        id: "b",
        timestamp: "2026-09-10T10:00:00.000Z",
        source: "worker",
        operation: "implementation",
        agent: "claude",
        tokens: {},
        costUsd: 44,
        status: "unknown",
        costStatus: "exact",
      },
    ]);

    assert.equal(warning.state, "warning");
  });
});
