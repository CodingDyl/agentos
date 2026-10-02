import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-business-routes-"));
process.env.AGENTOS_UI_DIR = directory;
// No Virtec: the route must refuse before ever reaching Gmail.
delete process.env.VIRTEC_BASE_URL;
delete process.env.VIRTEC_API_KEY;

const { businessRouter, replySubject } = await import("../routes");
const { BusinessDraftRequestSchema } = await import("../../../shared/business-types");

let base = "";
let server: ReturnType<express.Express["listen"]>;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/business", businessRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/business`;
});

after(() => {
  server.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("business drafts", () => {
  it("refuses a client Virtec does not have", async () => {
    const response = await post(`${base}/drafts`, { clientId: "nobody", body: "Hello" });
    assert.equal(response.status, 404);
  });

  it("never takes a recipient from the request", () => {
    const parsed = BusinessDraftRequestSchema.parse({ clientId: "c1", body: "Hi", to: "attacker@example.com" });
    assert.equal("to" in parsed, false);
  });

  it("rejects an empty body and a thread id that is not Gmail's shape", async () => {
    assert.equal((await post(`${base}/drafts`, { clientId: "c1", body: "" })).status, 400);
    assert.equal((await post(`${base}/drafts`, { clientId: "c1", body: "x", threadId: "../drafts" })).status, 400);
  });

  it("adds Re: once and keeps the subject on one line", () => {
    assert.equal(replySubject("Quote"), "Re: Quote");
    assert.equal(replySubject("RE: Quote"), "RE: Quote");
    assert.equal(replySubject("Line\r\nBreak"), "Re: Line Break");
    assert.equal(replySubject("  "), "Re: your message");
  });
});

describe("business follow-ups", () => {
  it("refuses to act when Virtec is not writable", async () => {
    const response = await post(`${base}/follow-ups/f1`, { action: "sent" });
    assert.equal(response.status, 409);
  });
});
