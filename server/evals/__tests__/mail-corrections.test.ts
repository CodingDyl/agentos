import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCorrectionCases, type CorrectedThread } from "../mail-corrections";

const row = (id: string, overrides: Partial<CorrectedThread> = {}): CorrectedThread => ({
  threadId: id,
  fromEmail: `${id}@sender.example.com`,
  subject: `Subject ${id}`,
  snippet: `Snippet ${id}`,
  messageDate: "2026-11-01T09:00:00Z",
  bucket: "needs_you",
  category: "client",
  correctedAt: `2026-11-0${id.length}T09:00:00Z`,
  ...overrides,
});

describe("buildCorrectionCases", () => {
  it("never sends a thread its own correction as an example (leave-one-out)", () => {
    const rows = [row("a"), row("bb"), row("ccc")];
    const cases = buildCorrectionCases(rows, 8);
    assert.equal(cases.length, 3);
    for (const entry of cases) {
      const own = rows.find((candidate) => candidate.subject === entry.vars.subject)!;
      assert.ok(!(entry.vars.corrections as Array<{ subject: string }>).some((example) => example.subject === own.subject));
      assert.equal((entry.vars.corrections as unknown[]).length, 2);
    }
  });

  it("expects the bucket and category the owner chose", () => {
    const [entry] = buildCorrectionCases([row("a", { bucket: "low_priority", category: "sales" })], 8);
    assert.equal(entry.vars.expectedBucket, "low_priority");
    assert.equal(entry.vars.expectedCategory, "sales");
  });

  it("leaves out a thread the owner re-sorted to neither a bucket nor a category", () => {
    assert.deepEqual(buildCorrectionCases([row("a", { bucket: undefined, category: undefined })], 8), []);
  });

  it("offers the same sender's corrections first, then the same domain, then the newest", () => {
    const rows = [
      row("target", { fromEmail: "pat@client.example.com" }),
      row("other", { fromEmail: "x@elsewhere.example.org", correctedAt: "2026-11-09T00:00:00Z" }),
      row("domain", { fromEmail: "kim@client.example.com", correctedAt: "2026-11-02T00:00:00Z" }),
      row("sender", { fromEmail: "pat@client.example.com", correctedAt: "2026-11-01T00:00:00Z" }),
    ];
    const entry = buildCorrectionCases(rows, 8).find((candidate) => candidate.vars.subject === "Subject target")!;
    assert.deepEqual((entry.vars.corrections as Array<{ subject: string }>).map((example) => example.subject), ["Subject sender", "Subject domain", "Subject other"]);
  });

  it("caps the examples", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(`t${index}`));
    for (const entry of buildCorrectionCases(rows, 3)) assert.equal((entry.vars.corrections as unknown[]).length, 3);
  });
});
