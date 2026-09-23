import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRoutingPacket,
  readRoutingDecision,
} from "../../hermes/worker-routing";
import type { WorkerPerformance } from "../../../shared/worker-routing-types";
import type { WorkerId, WorkerJob } from "../../../shared/worker-types";
import { summarise } from "../metrics";
import {
  buildRoutingContext,
  classifyTask,
  decideFromRecord,
  estimateComplexity,
  scoreCandidate,
} from "../router";

/**
 * Routing, tested where the risk actually is.
 *
 * Three things could go wrong here, and none of them need a model to
 * reproduce: the record could be read wrongly, a reply could be trusted that
 * should not be, and the fallback could quietly claim more certainty than it
 * has. All three are pure functions, and all three are checked by feeding them
 * input.
 */

/** A finished job, with only the fields the metrics actually read. */
const job = (over: Partial<WorkerJob> & { resolvedWorker: WorkerId }): WorkerJob =>
  ({
    id: `job_${Math.random().toString(36).slice(2, 10)}`,
    worker: over.resolvedWorker,
    project: "agentos",
    objective: "Do the thing",
    status: "awaiting_review",
    createdAt: "2026-09-01T10:00:00.000Z",
    revision: 1,
    ...over,
  }) as WorkerJob;

const perf = (over: Partial<WorkerPerformance>): WorkerPerformance => ({
  worker: "grok",
  jobs: 0,
  reviews: 0,
  ...over,
});

describe("what the record says about a worker", () => {
  it("reports nothing rather than zero for a worker never used", () => {
    const summary = summarise("claude", []);

    assert.equal(summary.jobs, 0);
    // The distinction the whole module turns on. A 0% success rate would say
    // this worker fails every job, which would stop it ever being tried.
    assert.equal(summary.successRate, undefined);
    assert.equal(summary.reviewPassRate, undefined);
    assert.equal(summary.avgCostUsd, undefined);
  });

  it("leaves cancelled jobs out of the record entirely", () => {
    const summary = summarise("grok", [
      job({ resolvedWorker: "grok", status: "cancelled" }),
      job({ resolvedWorker: "grok", status: "awaiting_review" }),
    ]);

    // Cancelling says something about the operator's afternoon, not about the
    // worker, so it is neither a success nor a failure.
    assert.equal(summary.jobs, 1);
    assert.equal(summary.successRate, 1);
  });

  it("counts a failed run against the worker but a rejected one as delivered", () => {
    const summary = summarise("grok", [
      job({ resolvedWorker: "grok", status: "failed" }),
      job({ resolvedWorker: "grok", status: "rejected" }),
    ]);

    // Delivering work a person turned down is a different event from crashing,
    // and folding them together would make one bad review look like a crash.
    assert.equal(summary.jobs, 2);
    assert.equal(summary.successRate, 0.5);
  });

  it("reads the pass rate from verdicts and only from verdicts", () => {
    const summary = summarise("claude", [
      job({
        resolvedWorker: "claude",
        review: { verdict: "pass" } as WorkerJob["review"],
      }),
      job({
        resolvedWorker: "claude",
        review: { verdict: "changes_required" } as WorkerJob["review"],
      }),
      // Never reviewed, so it is not evidence either way.
      job({ resolvedWorker: "claude" }),
    ]);

    assert.equal(summary.reviews, 2);
    assert.equal(summary.reviewPassRate, 0.5);
  });

  it("counts a validation as passed only when every command passed", () => {
    const summary = summarise("grok", [
      job({
        resolvedWorker: "grok",
        result: {
          summary: "",
          tests: [
            { command: "npm run build", success: true },
            { command: "npm test", success: false },
          ],
        },
      }),
    ]);

    assert.equal(summary.validationPassRate, 0);
  });

  it("counts revisions as the times work went back, not the attempt number", () => {
    const summary = summarise("grok", [
      job({ resolvedWorker: "grok", revision: 1 }),
      job({ resolvedWorker: "grok", revision: 3 }),
    ]);

    // A first attempt is revision 1 and is not a revision.
    assert.equal(summary.avgRevisions, 1);
  });

  it("averages cost only over the runs that reported one", () => {
    const summary = summarise("claude", [
      job({
        resolvedWorker: "claude",
        result: { summary: "", providerMetrics: { costUsd: 1 } },
      }),
      job({
        resolvedWorker: "claude",
        result: { summary: "", providerMetrics: { costUsd: 2 } },
      }),
      job({ resolvedWorker: "claude", result: { summary: "" } }),
    ]);

    assert.equal(summary.avgCostUsd, 1.5);
  });
});

describe("reading what kind of job it is", () => {
  it("prefers the more specific signal when two apply", () => {
    // Mentions tests, but the job is finding out why they fail.
    assert.equal(
      classifyTask("Investigate why the Gradle tests fail"),
      "debugging",
    );
  });

  it("recognises the work this console mostly does", () => {
    assert.equal(
      classifyTask("Implement masonry Design Library layout"),
      "design-implementation",
    );
    assert.equal(classifyTask("Refactor the design asset store"), "refactor");
    assert.equal(classifyTask("Add a pantry expiry endpoint"), "implementation");
  });

  it("treats a job it cannot place as implementation", () => {
    // The commonest case by far, and a safer default than routing an ordinary
    // request down a research path.
    assert.equal(classifyTask("Pantry Pilot shopping list"), "implementation");
  });

  it("sizes a job roughly, from breadth as well as length", () => {
    assert.equal(estimateComplexity("Fix the button colour"), "low");
    assert.equal(
      estimateComplexity("Migrate the whole design system to tokens"),
      "high",
    );
  });
});

describe("who is allowed to be chosen", () => {
  it("keeps the rehearsal worker out of the running", async () => {
    const context = await buildRoutingContext("Implement the filters");

    // Mock never fails, never revises and costs nothing, so on the evidence
    // alone it is the strongest candidate there could be — and it writes no
    // files. Left in, it would win every automatic selection.
    assert.ok(
      !context.candidates.some((entry) => entry.worker.id === "mock"),
      "a simulated worker must not be a routing candidate",
    );

    const excluded = context.excluded.find((entry) => entry.worker === "mock");

    // Ruled out visibly, not filtered away: the screen should be able to say
    // why the field was narrower than the workers list.
    assert.match(excluded?.reason ?? "", /rehearses the pipeline/);
  });
});

describe("choosing from the record alone", () => {
  it("does not treat an unmeasured worker as a failing one", () => {
    const unmeasured = scoreCandidate(perf({ jobs: 0 }));
    const failing = scoreCandidate(
      perf({ jobs: 8, reviewPassRate: 0, validationPassRate: 0, successRate: 0 }),
    );

    // Otherwise "never been used" is self-perpetuating: a new worker could
    // never earn the history it is being judged for not having.
    assert.ok(
      unmeasured > failing,
      "a worker with no record must outrank one with a bad record",
    );
  });

  it("does not let a cheap worker outrank a reliable one", () => {
    const cheapAndUnreliable = scoreCandidate(
      perf({
        jobs: 10,
        reviewPassRate: 0.4,
        validationPassRate: 0.5,
        successRate: 0.6,
        avgRevisions: 2,
        avgCostUsd: 0.1,
      }),
    );

    const dearAndReliable = scoreCandidate(
      perf({
        jobs: 10,
        reviewPassRate: 0.95,
        validationPassRate: 1,
        successRate: 1,
        avgRevisions: 0.2,
        avgCostUsd: 1.5,
      }),
    );

    // Saving forty cents is not a saving when the work comes back twice.
    assert.ok(
      dearAndReliable > cheapAndUnreliable,
      "reliability must outweigh cost",
    );
  });

  it("never claims to be sure when it has only counted things", () => {
    const decision = decideFromRecord({
      candidates: [
        {
          worker: { id: "grok", name: "Grok", capabilities: ["code"] } as never,
          performance: perf({ worker: "grok", jobs: 20, reviewPassRate: 1 }),
        },
        {
          worker: { id: "claude", name: "Claude", capabilities: ["code"] } as never,
          performance: perf({ worker: "claude", jobs: 0 }),
        },
      ],
      excluded: [],
      taskType: "implementation",
      complexity: "medium",
    });

    assert.equal(decision.selectedWorker, "grok");
    // A ranking of six numbers has not read the objective, so it does not get
    // to say it is highly confident about it.
    assert.notEqual(decision.confidence, "high");
    // And it must never be mistaken for a recommendation Hermes made.
    assert.equal(decision.decidedBy, "agentos");
    assert.match(decision.reasons.join(" "), /could not be reached/i);
    assert.deepEqual(
      decision.alternatives?.map((entry) => entry.worker),
      ["claude"],
    );
  });
});

describe("reading Hermes' answer", () => {
  const candidates: WorkerId[] = ["grok", "claude"];

  it("takes a well-formed choice", () => {
    const decision = readRoutingDecision(
      `Here you go:
\`\`\`json
{"selectedWorker":"claude","confidence":"high","taskType":"architecture",
 "reasons":["Stronger review history"],
 "alternatives":[{"worker":"grok","reason":"Cheaper but more revisions"}]}
\`\`\``,
      candidates,
    );

    assert.equal(decision?.selectedWorker, "claude");
    assert.equal(decision?.confidence, "high");
    assert.equal(decision?.taskType, "architecture");
    assert.equal(decision?.decidedBy, "hermes");
    assert.deepEqual(decision?.alternatives, [
      { worker: "grok", reason: "Cheaper but more revisions" },
    ]);
  });

  it("refuses a worker that was not on offer", () => {
    // The one hard refusal. Honouring this would mean starting a worker the
    // deterministic filter had already ruled out — which is the guarantee
    // filtering first is supposed to provide.
    assert.equal(
      readRoutingDecision('{"selectedWorker":"mock","confidence":"high"}', candidates),
      undefined,
    );
    assert.equal(
      readRoutingDecision('{"selectedWorker":"gpt-5","confidence":"high"}', candidates),
      undefined,
    );
  });

  it("falls back rather than guessing when the reply is not a decision", () => {
    for (const reply of [
      "I think Grok would probably be best for this one.",
      "",
      "{ not json at all",
    ]) {
      assert.equal(readRoutingDecision(reply, candidates), undefined);
    }
  });

  it("does not give an unreadable answer the benefit of the doubt", () => {
    const decision = readRoutingDecision(
      '{"selectedWorker":"grok","confidence":"extremely sure"}',
      candidates,
    );

    // Unparseable certainty is low certainty, never high.
    assert.equal(decision?.confidence, "low");
    assert.match(decision?.reasons.join(" ") ?? "", /no reason/i);
  });

  it("drops an alternative that names a worker nobody offered", () => {
    const decision = readRoutingDecision(
      `{"selectedWorker":"grok","confidence":"medium",
        "alternatives":[{"worker":"mock","reason":"cheap"},
                        {"worker":"grok","reason":"self"}]}`,
      candidates,
    );

    // Showing either would read as a choice the operator could have made.
    assert.equal(decision?.alternatives, undefined);
  });
});

describe("what Hermes is told", () => {
  it("says a worker is unmeasured rather than showing it as zero", () => {
    const packet = buildRoutingPacket({
      objective: "Implement the filters",
      project: "agentos",
      candidates: [
        { performance: perf({ worker: "claude", jobs: 0 }), capabilities: ["code"] },
      ],
    });

    assert.match(packet, /no data/);
    assert.doesNotMatch(packet, /review pass rate: 0%/);
  });

  it("states the order to weigh things in, so cost does not win by default", () => {
    const packet = buildRoutingPacket({
      objective: "Implement the filters",
      project: "agentos",
      candidates: [
        {
          performance: perf({ worker: "grok", jobs: 4, avgCostUsd: 0.42 }),
          capabilities: ["code"],
        },
      ],
    });

    assert.match(packet, /Cost is the fifth consideration/);
    assert.match(packet, /three revisions is the more expensive choice/);
  });

  it("sends the objective and the record, and nothing else about the vault", () => {
    const packet = buildRoutingPacket({
      objective: "Implement the filters",
      project: "agentos",
      candidates: [
        {
          performance: perf({ worker: "grok", jobs: 4, avgCostUsd: 0.42 }),
          capabilities: ["code", "review"],
        },
      ],
    });

    assert.match(packet, /Implement the filters/);
    assert.match(packet, /average cost: \$0\.42/);
    assert.match(packet, /capabilities: code, review/);
  });
});
