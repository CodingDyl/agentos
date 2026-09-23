import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageRecord } from "../../../shared/usage-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { deriveTotal } from "../ledger";
import {
  agentUsage,
  breakdown,
  findAnomalies,
  total,
  weakest,
} from "../metrics";
import { readHermesUsage } from "../providers/hermes";
import { readBalance } from "../providers/openrouter";
import { summariseCost } from "../operations";

/**
 * The arithmetic, tested where it could lie.
 *
 * Every case here is a way a usage screen quietly becomes wrong: an absence
 * summed as a zero, an estimate laundered into a total that reads as exact, a
 * runaway hidden inside the average it is supposed to trigger, a cost figure
 * that omits every unpriced run without saying so.
 */

const record = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  id: `use-${Math.random().toString(36).slice(2, 10)}`,
  timestamp: "2026-09-10T10:00:00.000Z",
  source: "hermes",
  operation: "code-review",
  agent: "hermes",
  tokens: {},
  status: "unknown",
  costStatus: "unknown",
  ...over,
});

const job = (over: Partial<WorkerJob> = {}): WorkerJob =>
  ({
    id: "job_0000000000000001",
    worker: "auto",
    project: "pantry-pilot",
    objective: "Do the thing",
    status: "completed",
    createdAt: "2026-09-10T10:00:00.000Z",
    ...over,
  }) as WorkerJob;

describe("deriving a token total", () => {
  it("says nothing rather than zero when nothing was reported", () => {
    assert.equal(deriveTotal({}), undefined);
    assert.equal(deriveTotal(undefined), undefined);
  });

  it("prefers the provider's own total to a reconstruction", () => {
    assert.equal(deriveTotal({ input: 10, output: 5, total: 99 }), 99);
  });

  it("adds only the parts that are actually there", () => {
    assert.equal(deriveTotal({ output: 812 }), 812);
    assert.equal(deriveTotal({ input: 4_210, output: 812 }), 5_022);
  });
});

describe("weakest measurement", () => {
  it("never upgrades", () => {
    assert.equal(weakest("exact", "estimated"), "estimated");
    assert.equal(weakest("estimated", "exact"), "estimated");
    assert.equal(weakest("exact", "unknown"), "unknown");
    assert.equal(weakest("exact", "exact"), "exact");
  });
});

describe("totalling records", () => {
  it("reports nothing at all for an empty bucket", () => {
    const sum = total([]);

    assert.equal(sum.tokens, undefined);
    assert.equal(sum.costUsd, undefined);
    assert.equal(sum.status, "unknown");
  });

  it("separates what it summed from how many records there were", () => {
    const sum = total([
      record({ tokens: { total: 1_000 }, status: "exact", costUsd: 1 }),
      record({ tokens: { total: 500 }, status: "exact" }),
      // Reported nothing at all. Real, and uncounted.
      record(),
    ]);

    assert.equal(sum.tokens, 1_500);
    assert.equal(sum.records, 3);
    assert.equal(sum.measured, 2);
    assert.equal(sum.costed, 1);
  });

  it("degrades to an estimate when any measured record was estimated", () => {
    const sum = total([
      record({ tokens: { total: 1_000 }, status: "exact" }),
      record({ tokens: { total: 900 }, status: "estimated" }),
    ]);

    assert.equal(sum.status, "estimated");
  });

  it("stays exact when the only unknown record contributed no tokens", () => {
    // A coverage gap is not a reason to call the measured runs estimates.
    const sum = total([
      record({ tokens: { total: 1_000 }, status: "exact" }),
      record({ status: "unknown" }),
    ]);

    assert.equal(sum.status, "exact");
    assert.equal(sum.measured, 1);
    assert.equal(sum.records, 2);
  });
});

describe("breaking usage down", () => {
  it("gives no share when the whole was never measured", () => {
    const rows = breakdown(
      [record({ agent: "grok" }), record({ agent: "claude" })],
      (entry) => entry.agent,
    );

    assert.equal(rows.length, 2);
    assert.equal(rows[0].tokenShare, undefined);
  });

  it("ranks by tokens and reports each share", () => {
    const rows = breakdown(
      [
        record({ agent: "grok", tokens: { total: 250 }, status: "exact" }),
        record({ agent: "claude", tokens: { total: 750 }, status: "exact" }),
      ],
      (entry) => entry.agent,
    );

    assert.deepEqual(
      rows.map((row) => row.key),
      ["claude", "grok"],
    );
    assert.equal(rows[0].tokenShare, 0.75);
  });
});

describe("an agent's operating record", () => {
  it("divides spend by successes, not by attempts", () => {
    const jobs = [
      job({ id: "job_a", resolvedWorker: "grok", status: "completed" }),
      job({ id: "job_b", resolvedWorker: "grok", status: "failed" }),
    ];

    const records = [
      record({ agent: "grok", jobId: "job_a", costUsd: 0.4, source: "worker" }),
      record({ agent: "grok", jobId: "job_b", costUsd: 0.8, source: "worker" }),
    ];

    const [grok] = agentUsage(records, jobs);

    // Both attempts cost money; only one produced anything.
    assert.ok(Math.abs((grok.avgCostUsd ?? 0) - 0.6) < 1e-9);
    assert.ok(Math.abs((grok.avgSuccessfulCostUsd ?? 0) - 0.4) < 1e-9);
    assert.equal(grok.completed, 1);
  });

  it("counts a first-pass review only on the first revision", () => {
    const passOnThird = job({
      id: "job_c",
      resolvedWorker: "claude",
      revision: 3,
      review: {
        jobId: "job_c",
        verdict: "pass",
        summary: "Fixed",
        issues: [],
        acceptanceCriteria: [],
        reviewedAt: "2026-09-10T11:00:00.000Z",
        revision: 3,
      },
    });

    const [claude] = agentUsage([], [passOnThird]);

    assert.equal(claude.firstPassReviewRate, 0);
  });
});

describe("finding unusual runs", () => {
  const sync = (tokens: number) =>
    record({ agent: "hermes", operation: "automation", tokens: { total: tokens }, status: "exact" });

  it("says nothing without enough history to have a baseline", () => {
    assert.deepEqual(findAnomalies([sync(14_000), sync(90_000)]), []);
  });

  it("excludes a run from the baseline it is judged against", () => {
    // Four typical runs and one spike. Including the spike in its own average
    // would drag the baseline up and hide exactly what we are looking for.
    const found = findAnomalies([
      sync(14_000),
      sync(13_000),
      sync(15_000),
      sync(14_000),
      sync(41_000),
    ]);

    assert.equal(found.length, 1);
    assert.equal(found[0].tokens, 41_000);
    assert.equal(found[0].typicalTokens, 14_000);
    assert.equal(found[0].sampleSize, 4);
  });
});

describe("reading Hermes' reply", () => {
  it("reports unknown rather than zero when there is no usage block", () => {
    const usage = readHermesUsage({ choices: [], model: "gemini-2.5-flash" });

    assert.equal(usage.status, "unknown");
    assert.equal(usage.tokens.input, undefined);
    assert.equal(usage.model, "gemini-2.5-flash");
  });

  it("pulls cached tokens out of the nested details", () => {
    const usage = readHermesUsage({
      model: "gemini-2.5-flash",
      usage: {
        prompt_tokens: 18_291,
        completion_tokens: 4_732,
        total_tokens: 23_023,
        prompt_tokens_details: { cached_tokens: 12_000 },
      },
    });

    assert.equal(usage.status, "exact");
    assert.equal(usage.tokens.cachedInput, 12_000);
    assert.equal(usage.tokens.total, 23_023);
    // No price in the reply means no price, not a free call.
    assert.equal(usage.costUsd, undefined);
    assert.equal(usage.costStatus, "unknown");
  });
});

describe("the month's cost", () => {
  const plan = {
    id: "sub_1",
    name: "Claude",
    type: "subscription" as const,
    price: 20,
    currency: "USD",
    billingCycle: "monthly" as const,
    active: true,
  };

  it("keeps recurring and metered money apart", () => {
    const cost = summariseCost(
      [plan],
      [record({ costUsd: 4.82, tokens: { total: 1_000 }, status: "exact" })],
    );

    assert.equal(cost.recurringUsd, 20);
    assert.equal(cost.usageUsd, 4.82);
    assert.equal(cost.totalUsd, 24.82);
    assert.equal(cost.incomplete, false);
  });

  it("says so when some runs went unpriced", () => {
    const cost = summariseCost(
      [plan],
      [
        record({ costUsd: 4.82, status: "exact" }),
        // A Grok run: exact tokens, no price anywhere.
        record({ agent: "grok", tokens: { total: 37_800 }, status: "exact" }),
      ],
    );

    assert.equal(cost.incomplete, true);
  });

  it("spreads an annual plan across the year", () => {
    const cost = summariseCost(
      [{ ...plan, price: 240, billingCycle: "annual" as const }],
      [],
    );

    assert.equal(cost.recurringUsd, 20);
  });

  it("counts no recurring charge for prepaid credit", () => {
    const cost = summariseCost(
      [{ ...plan, type: "prepaid" as const, price: 50 }],
      [],
    );

    assert.equal(cost.recurringUsd, 0);
  });
});

describe("OpenRouter's balance", () => {
  it("refuses to compute a remainder it cannot know", () => {
    assert.equal(readBalance({ data: { total_usage: 8.92 } }), undefined);
  });

  it("subtracts usage from the granted total", () => {
    const balance = readBalance({
      data: { total_credits: 16.34, total_usage: 8.92 },
    });

    assert.equal(balance?.remainingUsd.toFixed(2), "7.42");
  });
});
