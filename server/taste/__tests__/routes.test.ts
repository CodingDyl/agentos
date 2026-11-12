import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

/** The Taste Vault API against a temporary library and vault. No browser is ever launched. */

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-taste-routes-"));
process.env.AGENTOS_UI_DIR = path.join(directory, "state");
process.env.AGENTOS_MEDIA_DIR = path.join(directory, "media");
process.env.AGENTOS_ROOT = path.join(directory, "vault");

await fs.mkdir(path.join(directory, "vault/projects/demo"), { recursive: true });
await fs.writeFile(path.join(directory, "vault/projects/PORTFOLIO.md"), "# Portfolio\n## Projects\n### Demo\nType: Product\nState: Active\nPriority: High\n");
await fs.writeFile(path.join(directory, "vault/projects/demo/PROJECT.md"), "# Demo\n");

const library = await import("../../designs/library");
const taste = await import("../taste");
const { tasteRouter } = await import("../routes");

let captures = 0;
taste.tasteDeps.capture = async () => {
  captures += 1;
  return Buffer.from("a picture of a page");
};

const app = express();
app.use(express.json());
app.use("/api/taste", tasteRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taste`;

const send = (route: string, method: string, body: unknown) =>
  fetch(base + route, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field
const json = async (response: Response): Promise<any> => response.json();

const add = (id: string, type: "reference" | "uploaded" = "reference") =>
  library.createAsset({ id, filename: `${id}.png`, storedName: `${id}.png`, hasThumbnail: false, type });

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

describe("the Taste Vault API", () => {
  it("refuses a private address, and a body that is not a URL request", async () => {
    const refused = await send("/url", "POST", { url: "http://169.254.169.254/latest/meta-data" });
    assert.equal(refused.status, 400);
    assert.match((await json(refused)).error, /public website/);

    assert.equal((await send("/url", "POST", {})).status, 400);
    assert.equal((await send("/url", "POST", { url: "https://example.com", extra: true })).status, 400);
    assert.equal(captures, 0);
  });

  it("photographs a public page into a reference", async () => {
    const response = await send("/url", "POST", { url: "https://example.com/pricing", notes: "Clear tiers", tags: ["pricing"] });
    assert.equal(response.status, 201);
    const { asset } = await json(response);
    assert.equal(asset.type, "reference");
    assert.equal(asset.sourceUrl, "https://example.com/pricing");
    assert.equal(asset.notes, "Clear tiers");
    assert.deepEqual(asset.attachedTo, []);

    const again = await send("/url", "POST", { url: "https://example.com/pricing" });
    assert.equal(again.status, 200);
    assert.equal((await json(again)).duplicate, true);
  });

  it("only takes JSON writes", async () => {
    const response = await fetch(`${base}/url`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "https://example.com" });
    assert.equal(response.status, 415);
  });

  it("validates a change and refuses a workspace that does not exist", async () => {
    await add("ref-a");

    assert.equal((await send("/ref-a", "PATCH", { snippet: "x".repeat(20_001) })).status, 400);
    assert.equal((await send("/ref-a", "PATCH", { attachedTo: "demo" })).status, 400);
    assert.equal((await send("/ref-a", "PATCH", { favorite: true })).status, 400);

    const unknown = await send("/ref-a", "PATCH", { attachedTo: ["demo", "nowhere"] });
    assert.equal(unknown.status, 400);
    assert.match((await json(unknown)).error, /nowhere/);
    assert.deepEqual((await taste.listTaste()).find((asset) => asset.id === "ref-a")?.attachedTo, []);
  });

  it("updates the why-note, tags, snippet and attachment of a reference", async () => {
    const response = await send("/ref-a", "PATCH", { notes: "Quiet header", tags: ["Nav"], snippet: "<header />", attachedTo: ["demo"] });
    assert.equal(response.status, 200);
    const { asset } = await json(response);
    assert.equal(asset.notes, "Quiet header");
    assert.deepEqual(asset.tags, ["nav"]);
    assert.equal(asset.snippet, "<header />");
    assert.deepEqual(asset.attachedTo, ["demo"]);

    const cleared = await json(await send("/ref-a", "PATCH", { snippet: null, attachedTo: [] }));
    assert.equal(cleared.asset.snippet, undefined);
    assert.deepEqual(cleared.asset.attachedTo, []);
    assert.equal(cleared.asset.notes, "Quiet header");
  });

  it("does not change an asset that is not a reference, or one that does not exist", async () => {
    await add("upload-a", "uploaded");
    assert.equal((await send("/upload-a", "PATCH", { notes: "x" })).status, 404);
    assert.equal((await send("/missing", "PATCH", { notes: "x" })).status, 404);
  });

  it("lists references newest first, and one workspace's when asked", async () => {
    await send("/ref-a", "PATCH", { attachedTo: ["demo"] });

    const all = (await json(await fetch(base))).items as { id: string; type: string; createdAt: string }[];
    assert.ok(all.length >= 2);
    assert.ok(all.every((item) => item.type === "reference"));
    assert.deepEqual(all.map((item) => item.createdAt), [...all.map((item) => item.createdAt)].sort().reverse());

    const demo = (await json(await fetch(`${base}?workspace=demo`))).items as { id: string }[];
    assert.deepEqual(demo.map((item) => item.id), ["ref-a"]);
    assert.deepEqual((await json(await fetch(`${base}?workspace=other`))).items, []);
  });
});
