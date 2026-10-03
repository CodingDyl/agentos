import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { get } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { BusinessImportPreviewSchema, BusinessLedgerBackupSchema, BusinessLedgerStatusSchema } from "../../../shared/business-ledger-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-business-ledger-routes-"));
process.env.AGENTOS_UI_DIR = directory;
delete process.env.VIRTEC_BASE_URL;
delete process.env.VIRTEC_API_KEY;
const { businessLedgerRouter } = await import("../ledger-routes");
const { closeBusinessLedger } = await import("../ledger-store");
let base = "";
let server: ReturnType<express.Express["listen"]>;
before(async () => {
  const app = express(); app.use(express.json({ limit: "16mb" })); app.use("/ledger", businessLedgerRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ledger`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  closeBusinessLedger(); fs.rmSync(directory, { recursive: true, force: true });
});
const post = (url: string, body: unknown, headers = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("business ledger API", () => {
  it("validates business identity, origin, host, and request format", async () => {
    assert.equal((await fetch(`${base}/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/virtec`, { headers: { Origin: "https://untrusted.example" } })).status, 403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(`${base}/virtec`, { headers: { Host: "untrusted.example" } }, (response) => { response.resume(); resolve(response.statusCode); }).on("error", reject);
    });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(`${base}/virtec/preview`, { method: "POST" })).status, 415);
    assert.equal((await post(`${base}/virtec/commit`, { previewId: "guessed" })).status, 400);
  });

  it("returns a blocked preview when CRM sources cannot be read", async () => {
    const response = await post(`${base}/virtec/preview`, {});
    const preview = BusinessImportPreviewSchema.parse(await response.json());
    assert.equal(preview.ready, false);
    assert.equal((await post(`${base}/virtec/commit`, { previewId: preview.id })).status, 409);
    assert.equal((await post(`${base}/pantry-pilot/preview`, {})).status, 409);
  });

  it("restores exactly the reviewed records and downloads a validated backup", async () => {
    const backup = {
      format: "agentos-business-ledger", version: 1, exportedAt: "2026-10-03T12:00:00.000Z",
      entity: { id: "virtec", name: "Virtara", source: "virtec", kind: "agency", workspaces: [] },
      records: [{ id: "client-1", entityId: "virtec", source: "agentos", sourceId: "client-1", kind: "client", name: "Test Client" }],
    };
    const preview = BusinessImportPreviewSchema.parse(await (await post(`${base}/virtec/restore-preview`, backup)).json());
    assert.equal(preview.ready, true);
    const before = BusinessLedgerStatusSchema.parse(await (await fetch(`${base}/virtec`)).json());
    assert.equal(before.records.length, 0);
    const result = await post(`${base}/virtec/commit`, { previewId: preview.id });
    assert.equal(result.status, 200);
    assert.equal(BusinessLedgerStatusSchema.parse(await result.json()).counts.client, 1);
    const download = await fetch(`${base}/virtec/backup`);
    assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.deepEqual(BusinessLedgerBackupSchema.parse(await download.json()).records, backup.records);
    assert.equal(BusinessLedgerBackupSchema.parse(await (await fetch(`${base}/virtec/backup?previous=1`)).json()).records.length, 0);
    assert.equal((await post(`${base}/virtec/restore-preview`, backup)).status, 409);
    assert.equal((await post(`${base}/pantry-pilot/restore-preview`, backup)).status, 422);
    assert.equal((await post(`${base}/virtec/restore-preview`, { format: "wrong" })).status, 422);
  });
});

it("validates native operations and serves safe printable documents", async () => {
  const status = BusinessLedgerStatusSchema.parse(await (await fetch(`${base}/virtec`)).json());
  assert.equal((await post(`${base}/virtec/operate`, { revision: status.revision, action: "invalid" })).status, 422);
  const document = { id: "print-quote", sourceId: "print-quote", source: "agentos", entityId: "virtec", kind: "quote", clientId: "client-1", title: "Quote", detail: "complete", currency: "ZAR", issuedOn: "2026-10-03", dueOn: "2026-11-03", items: [{ description: "Hosting", quantity: 1, unitPriceMinor: 50000 }] };
  const saved = await post(`${base}/virtec/operate`, { revision: status.revision, action: "save", record: document });
  assert.equal(saved.status, 200);
  const print = await fetch(`${base}/virtec/documents/print-quote/print`);
  assert.equal(print.status, 200); assert.match(print.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(await print.text(), /DRAFT — not issued/);
  assert.equal((await fetch(`${base}/pantry-pilot/documents/print-quote/print`)).status, 404);
});
