import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, it } from "node:test";
import type { BusinessEntity } from "../../../shared/business-types";
import type { BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import { applyBusinessOperation, nextServiceDate, type BusinessOperation } from "../ledger-operations";
import { closeBusinessLedger, getBusinessLedgerStatus } from "../ledger-store";
import { renderBusinessDocument } from "../ledger-print";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-billing-"));
const entity: BusinessEntity = { id: "virtec", name: "Virtara", kind: "agency", source: "virtec", workspaces: [] };
beforeEach(() => { closeBusinessLedger(); process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root,"case-")); });
after(() => { closeBusinessLedger(); fs.rmSync(root,{recursive:true,force:true}); });
const base = (id: string) => ({ id, sourceId:id, source:"agentos" as const, entityId:entity.id });
function run(input: Omit<BusinessOperation,"revision">) { return applyBusinessOperation(entity, {revision:getBusinessLedgerStatus(entity.id).revision,...input}); }
function save(record: BusinessLedgerRecord) { return run({action:"save",record}); }
function setup() {
  save({...base("client"),kind:"client",name:"Test Client"});
  save({...base("quote"),kind:"quote",clientId:"client",title:"Website",detail:"complete",currency:"ZAR",issuedOn:"2026-10-03",dueOn:"2026-11-03",items:[{description:"Build <script>alert(1)</script>",quantity:2,unitPriceMinor:12525}]});
}
it("calculates totals, locks issued quotes, converts once and preserves client identity", () => {
  setup();
  let result = run({action:"issue",id:"quote"});
  const quote = result.records.find(row=>row.id === "quote")!;
  assert.ok(quote.kind === "quote"); assert.equal(quote.amountMinor,25050); assert.equal(quote.number,"AG-Q-2026-00001");
  assert.throws(()=>save({...quote,title:"Changed"}),/cannot be edited/);
  run({action:"accept",id:"quote"}); result=run({action:"convert",id:"quote",date:"2026-10-03"});
  assert.equal(result.counts.invoice,1); assert.throws(()=>run({action:"convert",id:"quote"}),/already has an invoice/);
  const html=renderBusinessDocument(quote,"Other"); assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("Test Client")); assert.ok(!html.includes("<script>alert"));
});
it("prevents stale changes, cross-business writes and source impersonation",()=>{
  setup();
  assert.throws(()=>applyBusinessOperation(entity,{revision:0,action:"accept",id:"quote"}),/changed/);
  assert.throws(()=>save({...base("x"),entityId:"other",kind:"client",name:"Bad"}),/Invalid business/);
  assert.throws(()=>save({...base("x"),source:"virtec",kind:"client",name:"Bad"}),/owned by Agentos/);
});
it("records partial payments, rejects overpayments atomically and refuses draft allocations",()=>{
  setup();run({action:"issue",id:"quote"});run({action:"accept",id:"quote"});
  const invoice=run({action:"convert",id:"quote"}).records.find(row=>row.kind==="invoice")!;
  const payment: BusinessLedgerRecord={...base("pay"),kind:"payment",clientId:"client",currency:"ZAR",amountMinor:10000,receivedOn:"2026-10-03",allocations:[{invoiceId:invoice.id,amountMinor:10000}]};
  assert.throws(()=>save(payment),/issued invoices/);run({action:"issue",id:invoice.id});save(payment);
  assert.throws(()=>save({...payment,...base("pay2"),amountMinor:20000,allocations:[{invoiceId:invoice.id,amountMinor:20000}]}));
  assert.equal(getBusinessLedgerStatus(entity.id).counts.payment,1);
});
it("generates one period at a time, ignores paused services, and prevents same-period duplication",()=>{
  setup();
  save({...base("service"),kind:"service",clientId:"client",title:"Hosting",currency:"ZAR",amountMinor:50000,state:"active",cadence:"monthly",nextInvoiceDate:"2026-10-01"});
  let result=run({action:"generate",date:"2026-10-03"});assert.equal(result.counts.invoice,1);
  result=run({action:"generate",date:"2026-10-03"});assert.equal(result.counts.invoice,1);
  const service=result.records.find(row=>row.kind==="service")!; assert.ok(service.kind==="service");assert.equal(service.nextInvoiceDate,"2026-11-01");
  save({...service,state:"paused"});assert.equal(run({action:"generate",date:"2027-01-01"}).counts.invoice,1);
  save({...service,nextInvoiceDate:"2026-10-01"});assert.throws(()=>run({action:"generate",date:"2026-10-03"}),/already exists/);
});
it("clamps monthly dates without overflowing February",()=>{
  assert.equal(nextServiceDate("2026-01-31",1),"2026-02-28"); assert.equal(nextServiceDate("2026-02-28",1,31),"2026-03-31"); assert.equal(nextServiceDate("2028-01-31",1),"2028-02-29");assert.equal(nextServiceDate("2026-12-31",1),"2027-01-31");
});

it("voids mistaken payments without deleting their original fields and retains an audit backup", async () => {
  const { businessAuditBackup } = await import("../ledger-store");
  const { businessInvoicePaid } = await import("../../../shared/business-billing-calculations");
  setup(); run({ action: "issue", id: "quote" }); run({ action: "accept", id: "quote" });
  const invoice = run({ action: "convert", id: "quote" }).records.find((row) => row.kind === "invoice")!;
  run({ action: "issue", id: invoice.id });
  save({ ...base("payment"), kind: "payment", clientId: "client", currency: "ZAR", amountMinor: 10000, receivedOn: "2026-10-03", allocations: [{ invoiceId: invoice.id, amountMinor: 10000 }] });
  assert.throws(() => run({ action: "void", id: invoice.id, reason: "Wrong invoice" }), /allocations/);
  assert.throws(() => run({ action: "void", id: "payment" }), /reason/);
  const result = run({ action: "void", id: "payment", reason: "Duplicate bank entry" });
  const payment = result.records.find((row) => row.id === "payment")!;
  assert.ok(payment.kind === "payment"); assert.equal(payment.amountMinor, 10000); assert.equal(payment.allocations.length, 1);
  assert.equal(businessInvoicePaid(result.records, invoice.id), 0);
  assert.equal(result.audit[0].reason, "Duplicate bank entry");
  assert.equal(businessAuditBackup(entity.id, result.audit[0].id).records.find((row) => row.id === "payment")?.voided, undefined);
  assert.throws(() => run({ action: "void", id: "payment", reason: "Again" }), /active/);
  assert.throws(() => save({ ...payment, voided: undefined }), /Voided/);
  run({ action: "void", id: invoice.id, reason: "Incorrect invoice" });
});
it("reallocates client credit without changing received cash and rejects excess or other clients", () => {
  setup(); run({ action: "issue", id: "quote" }); run({ action: "accept", id: "quote" });
  const invoice = run({ action: "convert", id: "quote" }).records.find((row) => row.kind === "invoice")!;
  run({ action: "issue", id: invoice.id });
  save({ ...base("credit"), kind: "payment", clientId: "client", currency: "ZAR", amountMinor: 10000, receivedOn: "2026-10-03", allocations: [] });
  assert.throws(() => run({ action: "allocate", id: "credit", reason: "Apply", allocations: [{ invoiceId: invoice.id, amountMinor: 10001 }] }), /exceed/);
  const result = run({ action: "allocate", id: "credit", reason: "Apply received credit", allocations: [{ invoiceId: invoice.id, amountMinor: 5000 }] });
  const payment = result.records.find((row) => row.id === "credit")!;
  assert.ok(payment.kind === "payment"); assert.equal(payment.amountMinor, 10000); assert.equal(payment.allocations[0].amountMinor, 5000);
  save({ ...base("other"), kind: "client", name: "Other client" });
  save({ ...base("other-payment"), kind: "payment", clientId: "other", currency: "ZAR", amountMinor: 10000, receivedOn: "2026-10-03", allocations: [] });
  assert.throws(() => run({ action: "allocate", id: "other-payment", reason: "Wrong client", allocations: [{ invoiceId: invoice.id, amountMinor: 5000 }] }), /same client/);
});
it("replays the same request once, but rejects reuse for a different operation", () => {
  setup();
  const input: BusinessOperation = { requestId: "7f8f4a40-844a-44f0-9bab-9f459892a061", revision: getBusinessLedgerStatus(entity.id).revision, action: "issue", id: "quote" };
  const first = applyBusinessOperation(entity, input);
  const replay = applyBusinessOperation(entity, input);
  assert.equal(first.revision, replay.revision); assert.equal(first.audit.length, replay.audit.length);
  assert.throws(() => applyBusinessOperation(entity, { ...input, action: "accept" }), /different changes/);
});
it("calculates VAT exactly, requires explicit registration and freezes printed supplier details", async () => {
  const { calculateBusinessTotals } = await import("../../../shared/business-billing-calculations");
  const { BusinessProfileSchema } = await import("../../../shared/business-ledger-types");
  assert.deepEqual(calculateBusinessTotals([{ quantity: 1, unitPriceMinor: 10000 }], { rateBps: 1500, mode: "exclusive" }), { subtotalMinor: 10000, vatMinor: 1500, amountMinor: 11500 });
  assert.deepEqual(calculateBusinessTotals([{ quantity: 1, unitPriceMinor: 11500 }], { rateBps: 1500, mode: "inclusive" }), { subtotalMinor: 10000, vatMinor: 1500, amountMinor: 11500 });
  assert.equal(calculateBusinessTotals([{ quantity: 1, unitPriceMinor: 10 }], { rateBps: 1500, mode: "exclusive" }).vatMinor, 2);
  assert.throws(() => calculateBusinessTotals([{ quantity: 1, unitPriceMinor: Number.MAX_SAFE_INTEGER }], { rateBps: 1500, mode: "exclusive" }));
  assert.equal(BusinessProfileSchema.safeParse({ legalName: "Test", vatEnabled: true }).success, false);
  setup();
  const quote = getBusinessLedgerStatus(entity.id).records.find((row) => row.id === "quote")!;
  assert.ok(quote.kind === "quote");
  assert.throws(() => save({ ...quote, tax: { rateBps: 1500, mode: "exclusive" } }), /Enable VAT/);
  const profile = BusinessProfileSchema.parse({ legalName: "Original supplier", address: "Test address", vatNumber: "Test VAT", vatEnabled: true, paymentInstructions: "Test bank details" });
  run({ action: "profile", profile });
  save({ ...quote, tax: { rateBps: 1500, mode: "exclusive" } });
  assert.throws(() => run({ action: "issue", id: "quote" }), /billing address/);
  save({ ...base("client"), kind: "client", name: "Test Client", address: "Client street" });
  const issued = run({ action: "issue", id: "quote" }).records.find((row) => row.id === "quote")!;
  run({ action: "profile", profile: { ...profile, address: "New supplier address", paymentInstructions: "New bank" } });
  const rendered = renderBusinessDocument(issued, "Client");
  assert.match(rendered, /Test address/); assert.match(rendered, /Test bank details/); assert.match(rendered, /VAT 15%/); assert.ok(!rendered.includes("New bank"));
});
