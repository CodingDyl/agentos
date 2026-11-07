import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OwnerHoursEntry } from "../../../shared/outcomes-types";
import { computeOutcomes, currentMonth, parseTargetMinor, type OutcomeInputs } from "../compute";

const now = new Date("2026-11-15T10:00:00Z");

const base = (overrides: Partial<OutcomeInputs> = {}): OutcomeInputs => ({
  goals: [{ id: "G1", title: "Earn", area: "Money", by: "", measure: "monthly income", now: "", target: "R100,000+" }],
  clients: [{ id: "c1", name: "Acme Co", workspace: "acme" }],
  payments: [],
  jobs: [],
  usage: [],
  hours: [],
  warnings: [],
  ...overrides,
});

const payment = (id: string, receivedOn: string, amountMinor: number, clientKey?: string) => ({ id, receivedOn, amountMinor, clientKey });
const landed = (id: string, project: string, attempt = 1, completedAt = "2026-11-10T08:00:00Z") => ({ id, project, status: "completed", attempt, completedAt });
const hours = (minutes: number, extra: Partial<OwnerHoursEntry> = {}): OwnerHoursEntry => ({
  id: `h${minutes}${extra.on ?? ""}`, on: "2026-11-10", minutes, kind: "delivery", createdAt: "2026-11-10T08:00:00Z", ...extra,
});

describe("parseTargetMinor", () => {
  it("reads rand amounts the way the owner writes them", () => {
    assert.equal(parseTargetMinor("R100,000+"), 10_000_000);
    assert.equal(parseTargetMinor("R100k"), 10_000_000);
    assert.equal(parseTargetMinor("R 85 000"), 8_500_000);
    assert.equal(parseTargetMinor("a lot"), null);
    assert.equal(parseTargetMinor(""), null);
  });
});

describe("currentMonth", () => {
  it("is the month in South African time, not the server's", () => {
    assert.equal(currentMonth(new Date("2026-10-31T22:30:00Z")), "2026-11");
    assert.equal(currentMonth(new Date("2026-10-31T21:30:00Z")), "2026-10");
  });
});

describe("computeOutcomes", () => {
  it("counts an unlinked client's payment in the total and under unattributed", () => {
    const result = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 50_000, "c1"), payment("p2", "2026-11-04", 20_000)] }), now);
    assert.equal(result.paidMinor, 70_000);
    assert.equal(result.unattributed.paidMinor, 20_000);
    assert.equal(result.clients.find((client) => client.clientId === "c1")?.paidMinor, 50_000);
  });

  it("no money goal gives target null and gap null", () => {
    const result = computeOutcomes(base({ goals: [] }), now);
    assert.equal(result.target, null);
    assert.equal(result.gapMinor, null);
  });

  it("a target that cannot be read is null, never zero or a made-up figure, and says so", () => {
    const result = computeOutcomes(base({ goals: [{ id: "G1", title: "Earn", area: "", by: "", measure: "monthly income", now: "", target: "a lot" }] }), now);
    assert.equal(result.target, null);
    assert.equal(result.gapMinor, null);
    assert.ok(result.warnings.some((warning) => /target/i.test(warning)));
  });

  it("works out the gap to the target", () => {
    const result = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 4_000_000, "c1")] }), now);
    assert.deepEqual(result.target, { goalId: "G1", minor: 10_000_000 });
    assert.equal(result.gapMinor, 6_000_000);
  });

  it("a payment on the last day of the month counts in that month only", () => {
    const payments = [payment("p1", "2026-10-31", 100, "c1"), payment("p2", "2026-11-01", 200, "c1")];
    assert.equal(computeOutcomes(base({ payments }), now).paidMinor, 200);
    assert.equal(computeOutcomes(base({ payments }), new Date("2026-10-31T10:00:00Z")).paidMinor, 100);
  });

  it("averages the last three full months, and is null with no payments ever", () => {
    const payments = [payment("a", "2026-10-10", 300), payment("b", "2026-09-10", 600), payment("c", "2026-08-10", 900), payment("d", "2026-07-10", 99_999)];
    assert.equal(computeOutcomes(base({ payments }), now).trailingAverageMinor, 600);
    assert.equal(computeOutcomes(base(), now).trailingAverageMinor, null);
  });

  it("randPerHour is null with no logged hours, never zero", () => {
    const withoutHours = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 60_000, "c1")] }), now);
    assert.equal(withoutHours.clients[0].randPerHourMinor, null);
    const withHours = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 60_000, "c1")], hours: [hours(120, { clientId: "c1" })] }), now);
    assert.equal(withHours.clients[0].randPerHourMinor, 30_000);
  });

  it("hours logged against a workspace belong to the client who owns it", () => {
    const result = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 1, "c1")], hours: [hours(60, { workspace: "acme" })] }), now);
    assert.equal(result.clients[0].ownerMinutes, 60);
    assert.equal(result.unattributed.ownerMinutes, 0);
  });

  it("aiCost is null when no run reported a cost", () => {
    const quiet = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 1, "c1")], usage: [{ project: "acme" }] }), now);
    assert.equal(quiet.clients[0].aiCostUsd, null);
    const costed = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 1, "c1")], usage: [{ project: "acme", costUsd: 0.5 }, { project: "acme", costUsd: 0.25 }, { project: "other", costUsd: 9 }] }), now);
    assert.equal(costed.clients[0].aiCostUsd, 0.75);
  });

  it("firstPassRate is null with no landed jobs", () => {
    assert.equal(computeOutcomes(base(), now).agentWork.firstPassRate, null);
    const result = computeOutcomes(base({ jobs: [landed("j1", "acme"), landed("j2", "acme", 2), { id: "j3", project: "acme", status: "failed", attempt: 1 }] }), now);
    assert.equal(result.agentWork.landedJobs, 2);
    assert.equal(result.agentWork.firstPassRate, 0.5);
  });

  it("counts send-backs as attempts after the first", () => {
    const result = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 1, "c1")], jobs: [landed("j1", "acme", 3)] }), now);
    assert.equal(result.clients[0].landedJobs, 1);
    assert.equal(result.clients[0].sendBacks, 2);
  });

  it("jobs on a workspace with no paying client count as landed but not onPayingClients", () => {
    const result = computeOutcomes(base({ payments: [payment("p1", "2026-11-03", 1, "c1")], jobs: [landed("j1", "acme"), landed("j2", "nobody")] }), now);
    assert.equal(result.agentWork.landedJobs, 2);
    assert.equal(result.agentWork.onPayingClients, 1);
    assert.equal(result.unattributed.landedJobs, 1);
  });

  it("a client who paid only outside the last 90 days does not count as paying", () => {
    const result = computeOutcomes(base({ payments: [payment("p1", "2026-06-01", 1, "c1")], jobs: [landed("j1", "acme")] }), now);
    assert.equal(result.agentWork.onPayingClients, 0);
    assert.equal(result.clients[0].paidTrailing90Minor, 0);
  });

  it("totals the hours this month and this week, by kind", () => {
    const result = computeOutcomes(
      base({ hours: [hours(30, { on: "2026-11-14", kind: "sales" }), hours(60, { on: "2026-11-02" }), hours(45, { on: "2026-10-30" })] }),
      now,
    );
    assert.equal(result.ownerHours.monthMinutes, 90);
    assert.equal(result.ownerHours.weekMinutes, 30);
    assert.deepEqual(result.ownerHours.byKind, { sales: 30, delivery: 60 });
  });

  it("offers every client for the hours form, even one with nothing logged yet", () => {
    const result = computeOutcomes(base({ clients: [{ id: "c2", name: "Zed", workspace: null }, { id: "c1", name: "Acme Co", workspace: "acme" }] }), now);
    assert.deepEqual(result.clients, []);
    assert.deepEqual(result.choices.clients.map((client) => client.id), ["c1", "c2"]);
  });

  it("lists clients highest paid first", () => {
    const result = computeOutcomes(
      base({ clients: [{ id: "c1", name: "A", workspace: null }, { id: "c2", name: "B", workspace: null }], payments: [payment("p1", "2026-11-03", 10, "c1"), payment("p2", "2026-11-03", 90, "c2")] }),
      now,
    );
    assert.deepEqual(result.clients.map((client) => client.clientId), ["c2", "c1"]);
  });
});
