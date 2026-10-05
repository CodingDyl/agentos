import { buildBusinessHistory } from "./ledger-history";
import { BusinessOperationSchema, applyBusinessOperation } from "./ledger-operations";
import { renderBusinessDocument } from "./ledger-print";
import { financeBusinessExpenses, importFinanceExpenses } from "./finance-import";
import { FinanceExpenseImportRequestSchema } from "../../shared/business-finance-import";
import express from "express";
import { z } from "zod";
import { getVirtecSnapshot } from "../virtec/snapshot";
import { readBusinessState } from "./store";
import {
  BusinessLedgerError, businessAuditBackup, prepareBusinessHistory, commitBusinessLedgerImport, exportBusinessLedger, getBusinessLedgerStatus,
  prepareBusinessLedgerRestore, prepareCrmLedgerImport, previousBusinessLedgerBackup,
} from "./ledger-store";

export const businessLedgerRouter = express.Router();
businessLedgerRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  // Local financial data must not be exposed through DNS rebinding or cross-site forms.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Business records are only available on this machine." }); return;
  }
  const origin = request.get("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Remote origin");
    } catch { response.status(403).json({ error: "Open Business from the local Agentos app." }); return; }
  }
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Business changes require JSON." }); return;
  }
  next();
});

async function entity(id: string) {
  const found = (await readBusinessState()).entities.find((entry) => entry.id === id);
  if (!found) throw new BusinessLedgerError("No such business.", 404);
  return found;
}

function fail(response: express.Response, error: unknown) {
  if (error instanceof BusinessLedgerError) { response.status(error.status).json({ error: error.message }); return; }
  // Never log record payloads or Zod errors containing client data.
  console.error("[agentos] business ledger: operation failed", error instanceof Error ? error.name : "unknown error");
  response.status(500).json({ error: "The business ledger operation failed. No import was partially applied." });
}

businessLedgerRouter.get("/print.js", (_request, response) => { response.type("application/javascript").send('document.getElementById("print").addEventListener("click",()=>window.print());'); });
businessLedgerRouter.post("/:entityId/operate", async (request, response) => {
  const parsed = BusinessOperationSchema.safeParse(request.body);
  if (!parsed.success) { response.status(422).json({ error: "Check the record fields and try again." }); return; }
  try { response.json(applyBusinessOperation(await entity(request.params.entityId), parsed.data)); }
  catch (error) { fail(response, error); }
});
businessLedgerRouter.get("/:entityId/documents/:id/print", async (request, response) => {
  try {
    const records = getBusinessLedgerStatus((await entity(request.params.entityId)).id).records;
    const record = records.find((row) => row.id === request.params.id);
    if (!record) throw new BusinessLedgerError("Document not found.", 404);
    const client = "clientId" in record ? records.find((row) => row.id === record.clientId) : undefined;
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
    response.type("html").send(renderBusinessDocument(record, client?.kind === "client" ? client.companyName ?? client.name : ""));
  } catch (error) { fail(response, error); }
});

/** Finance transactions marked as business, and which business each was already imported into. */
businessLedgerRouter.get("/:entityId/finance-expenses", async (request, response) => {
  try {
    await entity(request.params.entityId);
    response.json(financeBusinessExpenses());
  } catch (error) { fail(response, error); }
});
businessLedgerRouter.post("/:entityId/finance-expenses/import", async (request, response) => {
  const input = FinanceExpenseImportRequestSchema.safeParse(request.body);
  if (!input.success) { response.status(422).json({ error: "Choose up to 500 Finance transactions to import." }); return; }
  try { response.json(importFinanceExpenses(await entity(request.params.entityId), input.data)); }
  catch (error) { fail(response, error); }
});

businessLedgerRouter.get("/:entityId", async (request, response) => {
  try { response.json(getBusinessLedgerStatus((await entity(request.params.entityId)).id)); }
  catch (error) { fail(response, error); }
});

businessLedgerRouter.post("/:entityId/preview", async (request, response) => {
  try {
    const business = await entity(request.params.entityId);
    if (business.source !== "virtec") throw new BusinessLedgerError("This business is not linked to the CRM.");
    response.json(prepareCrmLedgerImport(business, await getVirtecSnapshot({ fresh: true })));
  } catch (error) { fail(response, error); }
});

businessLedgerRouter.post("/:entityId/commit", async (request, response) => {
  const input = z.object({ previewId: z.uuid() }).strict().safeParse(request.body);
  if (!input.success) { response.status(400).json({ error: "A valid import preview is required." }); return; }
  try { response.json(commitBusinessLedgerImport(await entity(request.params.entityId), input.data.previewId)); }
  catch (error) { fail(response, error); }
});

businessLedgerRouter.get("/:entityId/backup", async (request, response) => {
  try {
    const business = await entity(request.params.entityId);
    const backup = request.query.previous === "1" ? previousBusinessLedgerBackup(business.id) : exportBusinessLedger(business);
    response.setHeader("Content-Disposition", `attachment; filename="agentos-${business.id}-business-backup.json"`);
    response.json(backup);
  } catch (error) { fail(response, error); }
});

businessLedgerRouter.post("/:entityId/restore-preview", async (request, response) => {
  try { response.json(prepareBusinessLedgerRestore(await entity(request.params.entityId), request.body)); }
  catch (error) { fail(response, error); }
});

businessLedgerRouter.post("/:entityId/history-preview", async (request, response) => {
  try {
    const business = await entity(request.params.entityId);
    if (business.source !== "virtec") throw new BusinessLedgerError("Billing-history imports require the linked CRM business.", 422);
    const input = buildBusinessHistory(request.body, business.id, getBusinessLedgerStatus(business.id).records);
    response.json(prepareBusinessHistory(business, input));
  } catch (error) { fail(response, error); }
});
businessLedgerRouter.get("/:entityId/history-template", async (request, response) => {
  try {
    const business = await entity(request.params.entityId);
    response.setHeader("Content-Disposition", 'attachment; filename="billing-history-template.json"');
    response.json({ format: "agentos-billing-history", version: 1, entityId: business.id, invoices: [], payments: [], expenses: [] });
  } catch (error) { fail(response, error); }
});
businessLedgerRouter.get("/:entityId/audit/:id/backup", async (request, response) => {
  try {
    const business = await entity(request.params.entityId);
    response.setHeader("Content-Disposition", 'attachment; filename="business-before-change.json"');
    response.json(businessAuditBackup(business.id, request.params.id));
  } catch (error) { fail(response, error); }
});
