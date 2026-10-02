import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessClient } from "../../../../shared/business-types";
import { followUpMailto, isBusinessTab, matchesClient, sortClients } from "../business-model";

function client(id: string, extra: Partial<BusinessClient> = {}): BusinessClient {
  return { id, entityId: "virtec", name: id, active: true, maintenance: false, totalSpent: 0, projects: [], quotes: [], activeProjectCount: 0, pendingQuoteValue: 0, openFollowUps: 0, ...extra };
}

describe("business model", () => {
  it("sorts live work first, inactive clients last", () => {
    const sorted = sortClients([client("b", { active: false, activeProjectCount: 5 }), client("a"), client("c", { activeProjectCount: 2 })]);
    assert.deepEqual(sorted.map((entry) => entry.id), ["c", "a", "b"]);
  });

  it("matches on name, company or email, ignoring case", () => {
    const ada = client("ada", { companyName: "Ada Law", email: "ada@example.com" });
    assert.ok(matchesClient(ada, "LAW"));
    assert.ok(matchesClient(ada, "example.com"));
    assert.ok(matchesClient(ada, "  "));
    assert.ok(!matchesClient(ada, "zzz"));
  });

  it("only accepts known tabs", () => {
    assert.ok(isBusinessTab("clients"));
    assert.ok(!isBusinessTab("invoices"));
    assert.ok(!isBusinessTab(null));
  });

  it("builds a mailto that keeps spaces, newlines and ampersands intact", () => {
    const link = followUpMailto("ada@example.com", "Quote & scope", "Hi Ada,\nChecking in.");
    assert.ok(link?.startsWith("mailto:ada@example.com?"));
    const params = new URL(link as string).searchParams;
    assert.equal(params.get("subject"), "Quote & scope");
    assert.equal(params.get("body"), "Hi Ada,\nChecking in.");
    assert.equal(followUpMailto(undefined, "x", "y"), undefined);
  });
});
