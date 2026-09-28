import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProspectInputSchema, type Prospect } from "../../../shared/traction-types";
import type { VirtecSnapshot } from "../../../shared/virtec-types";
import { buildCrmView, clientToProspect, crmAttention, crmQueueItems, formatRand, leadToProspect } from "../crm";
import { buildQueue } from "../engine";

const NOW = new Date(2026, 8, 28, 12);
const TODAY = "2026-09-28";

function snapshot(overrides: Partial<VirtecSnapshot> = {}): VirtecSnapshot {
  return { configured: true, fetchedAt: NOW.toISOString(), leads: [], clients: [], quotes: [], projects: [], followUps: [], ...overrides };
}

function prospect(overrides: Partial<Prospect>): Prospect {
  return {
    id: "pr_local0001",
    company: "Local",
    stage: "target",
    source: "outbound",
    reasons: [],
    stageChangedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("buildCrmView", () => {
  it("says pending, not empty, while the first read is still out", () => {
    const view = buildCrmView(undefined, [], NOW);
    assert.equal(view.configured, true);
    assert.equal(view.pending, true);
  });

  it("keeps live follow-ups and pending quotes, resolving the client's name", () => {
    const view = buildCrmView(
      snapshot({
        followUps: [
          { id: "f1", status: "open", dueAt: "2026-09-27T08:00:00.000Z" },
          { id: "f2", status: "sent" },
          { id: "f3", status: "snoozed", snoozedUntil: "2026-10-05T00:00:00.000Z" },
        ],
        quotes: [
          { id: "q1", status: "pending", clientId: "c1", features: [] },
          { id: "q2", status: "accepted", features: [] },
        ],
        clients: [{ id: "c1", name: "John", companyName: "Acme" }],
      }),
      [],
      NOW,
    );

    assert.deepEqual(view.followUps.map((followUp) => followUp.id), ["f1"]);
    assert.deepEqual(view.quotes.map((quote) => [quote.id, quote.clientName]), [["q1", "Acme"]]);
  });

  it("offers leads not yet imported and not ruled out, best score first", () => {
    const view = buildCrmView(
      snapshot({
        leads: [
          { id: "a", name: "A", score: 40, scoreReasons: [] },
          { id: "b", name: "B", score: 90, scoreReasons: [] },
          { id: "c", name: "C", score: 95, scoreReasons: [], status: "disqualified" },
          { id: "d", name: "D", score: 99, scoreReasons: [] },
        ],
      }),
      [prospect({ crmId: "virtec:lead:d" })],
      NOW,
    );

    assert.deepEqual(view.leads.map((lead) => lead.id), ["b", "a"]);
  });
});

describe("crm queue items", () => {
  it("queues follow-ups due by today, overdue invoices first", () => {
    const items = crmQueueItems(
      [
        { id: "q", type: "quote_pending", status: "open", companyName: "Acme", dueAt: "2026-09-27T08:00:00.000Z", reason: "No answer for 5 days.", amount: 25000 },
        { id: "i", type: "invoice_overdue", status: "open", customerName: "Jo", dueAt: "2026-09-20T08:00:00.000Z" },
        { id: "later", type: "quote_pending", status: "open", dueAt: "2026-10-10T08:00:00.000Z" },
      ],
      TODAY,
    );
    const queue = buildQueue([], [], TODAY, [], items);

    assert.deepEqual(queue.map((item) => item.id), ["crm:i", "crm:q"]);
    assert.equal(queue[1].title, "Follow up on quote: Acme");
    assert.deepEqual(queue[1].detail, ["No answer for 5 days.", "R 25 000"]);
  });

  it("claims an imported client so it is not queued twice", () => {
    const client = prospect({ id: "pr_client001", stage: "won", relationship: "strong", crmId: "virtec:client:c1" });
    const items = crmQueueItems([{ id: "i", type: "invoice_overdue", status: "open", customerId: "c1" }], TODAY);
    const queue = buildQueue([client], [], TODAY, [], items);

    assert.deepEqual(queue.map((item) => item.id), ["crm:i"]);
    assert.equal(queue[0].prospectId, client.id);
  });

  it("respects a snooze on a CRM item", () => {
    const items = crmQueueItems([{ id: "i", status: "open" }], TODAY);
    assert.deepEqual(buildQueue([], [{ itemId: "crm:i", until: "2026-10-01" }], TODAY, [], items), []);
  });
});

describe("mapping", () => {
  it("turns a lead into a valid prospect, without inventing an observation", () => {
    const input = leadToProspect({
      id: "abc",
      name: "Example Realty",
      websiteUrl: "https://example.com",
      ownerEmail: "not an email",
      score: 75,
      scoreReasons: ["No lead capture"],
      outreachStage: "replied",
      outreachPitch: "Offer a conversion audit",
      track: "virtara",
    });

    const parsed = ProspectInputSchema.parse(input);
    assert.equal(parsed.fit, "high");
    assert.equal(parsed.stage, "conversation");
    assert.equal(parsed.email, undefined);
    assert.equal(parsed.observation, undefined);
    assert.equal(parsed.crmId, "virtec:lead:abc");
  });

  it("drops a website that is not http(s)", () => {
    assert.equal(leadToProspect({ id: "x", name: "X", websiteUrl: "javascript:alert(1)", scoreReasons: [] }).website, undefined);
  });

  it("turns a client into a won prospect", () => {
    const parsed = ProspectInputSchema.parse(clientToProspect({ id: "c1", name: "John Smith", companyName: "Acme", totalSpent: 45000 }));
    assert.equal(parsed.company, "Acme");
    assert.equal(parsed.contact, "John Smith");
    assert.equal(parsed.stage, "won");
    assert.match(parsed.notes ?? "", /R 45 000/);
  });

  it("raises Virtec's own warnings, and nothing when there are none", () => {
    assert.deepEqual(crmAttention(snapshot({ revenue: { overdueInvoiceCount: 0 } })), []);
    const [flag] = crmAttention(snapshot({ revenue: { overdueInvoiceCount: 3 } }));
    assert.equal(flag.message, "3 invoices are overdue by 7+ days (Virtec)");
  });

  it("formats Rand without a locale's non-breaking space", () => {
    assert.equal(formatRand(385000), "R 385 000");
    assert.equal(formatRand(undefined), undefined);
  });
});
