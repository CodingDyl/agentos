import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import { matchPayments } from "../sources";

const ledgerClient = (id: string, name: string, extra: Partial<{ source: "virtec" | "agentos"; sourceId: string; companyName: string }> = {}) =>
  ({ id, entityId: "e1", kind: "client", source: extra.source ?? "virtec", sourceId: extra.sourceId ?? id, name, companyName: extra.companyName }) as BusinessLedgerRecord;
const ledgerPayment = (id: string, clientId: string, amountMinor = 100, extra: Partial<{ voided: boolean }> = {}) =>
  ({
    id, entityId: "e1", kind: "payment", source: "agentos", sourceId: id, clientId, currency: "ZAR", amountMinor, receivedOn: "2026-11-03", allocations: [],
    voided: extra.voided ? { at: "2026-11-04T00:00:00.000Z", reason: "mistake" } : undefined,
  }) as BusinessLedgerRecord;

const businessClients = [
  { id: "virtec-1", entityId: "e1", name: "Acme Co", companyName: "Acme Holdings" },
  { id: "virtec-2", entityId: "e1", name: "Brightside" },
];

describe("matchPayments", () => {
  it("joins through the ledger client's source id first", () => {
    const records = [ledgerClient("hash-a", "Totally different name", { sourceId: "virtec-1" }), ledgerPayment("p1", "hash-a")];
    const { payments, unmatched } = matchPayments([{ entityId: "e1", records }], businessClients);
    assert.equal(payments[0].clientKey, "virtec-1");
    assert.equal(unmatched, 0);
  });

  it("falls back to an exact name match, ignoring case and spacing", () => {
    const records = [ledgerClient("local-1", "  acme co ", { source: "agentos" }), ledgerPayment("p1", "local-1")];
    assert.equal(matchPayments([{ entityId: "e1", records }], businessClients).payments[0].clientKey, "virtec-1");
    const byCompany = [ledgerClient("local-2", "ACME HOLDINGS", { source: "agentos" }), ledgerPayment("p2", "local-2")];
    assert.equal(matchPayments([{ entityId: "e1", records: byCompany }], businessClients).payments[0].clientKey, "virtec-1");
  });

  it("never matches fuzzily: a near name is unattributed and counted", () => {
    const records = [ledgerClient("local-1", "Acme Company", { source: "agentos" }), ledgerPayment("p1", "local-1")];
    const result = matchPayments([{ entityId: "e1", records }], businessClients);
    assert.equal(result.payments[0].clientKey, undefined);
    assert.equal(result.unmatched, 1);
  });

  it("does not match a client in a different business", () => {
    const records = [ledgerClient("local-1", "Acme Co", { source: "agentos" }), ledgerPayment("p1", "local-1")];
    const result = matchPayments([{ entityId: "other", records: records.map((record) => ({ ...record, entityId: "other" })) as BusinessLedgerRecord[] }], businessClients);
    assert.equal(result.payments[0].clientKey, undefined);
  });

  it("leaves a name shared by two clients unattributed rather than picking one", () => {
    const twins = [...businessClients, { id: "virtec-3", entityId: "e1", name: "Acme Co" }];
    const records = [ledgerClient("local-1", "Acme Co", { source: "agentos" }), ledgerPayment("p1", "local-1")];
    assert.equal(matchPayments([{ entityId: "e1", records }], twins).payments[0].clientKey, undefined);
  });

  it("keeps every payment in the list, and leaves out voided ones", () => {
    const records = [ledgerClient("hash-a", "A", { sourceId: "virtec-2" }), ledgerPayment("p1", "hash-a", 500), ledgerPayment("p2", "hash-a", 700, { voided: true })];
    const { payments } = matchPayments([{ entityId: "e1", records }], businessClients);
    assert.deepEqual(payments.map((payment) => [payment.id, payment.amountMinor]), [["p1", 500]]);
  });

  it("treats a payment whose client record is missing as unattributed", () => {
    const { payments, unmatched } = matchPayments([{ entityId: "e1", records: [ledgerPayment("p1", "ghost")] }], businessClients);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].clientKey, undefined);
    assert.equal(unmatched, 1);
  });
});
