import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rebuild-brand-routes-"));
const previous = { root: process.env.AGENTOS_ROOT, ui: process.env.AGENTOS_UI_DIR };
process.env.AGENTOS_ROOT = path.join(root, "vault");
process.env.AGENTOS_UI_DIR = path.join(root, "ui");
// Never a real client drive: a stage started in the background stops at research.
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const store = await import("../store");
const { rebuildRouter } = await import("../routes");
const { conceptBrief, buildBrief } = await import("../prompts");
const { assignDirections } = await import("../design-fingerprints");
const { NICHE_CLICHES } = await import("../design-directions");
const { brandRightsNote } = await import("../stages");
type BrandKit = import("../../../shared/website-rebuild-types").BrandKit;
type RebuildRun = import("../../../shared/website-rebuild-types").RebuildRun;

const app = express();
app.use(express.json());
app.use("/api/rebuilds", rebuildRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rebuilds`;

let caseNumber = 0;
beforeEach(() => {
  store.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${caseNumber}-`));
});
after(async () => {
  store.closeRebuildDatabase();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  if (previous.root === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previous.root;
  if (previous.ui === undefined) delete process.env.AGENTOS_UI_DIR;
  else process.env.AGENTOS_UI_DIR = previous.ui;
});

const kit: BrandKit = {
  capturedAt: "2026-10-05T09:00:00.000Z",
  source: "capture",
  assets: [
    { id: "logo", kind: "logo", artifactId: "a1", path: "projects/te/docs/website-rebuild/brand/capture-r1-logo.png", sourceUrl: "https://te.example/logo.png", include: true },
    { id: "photo-01", kind: "photo", artifactId: "a2", path: "projects/te/docs/website-rebuild/brand/capture-r1-photo-01.jpg", sourceUrl: "https://te.example/van.jpg", alt: "Our van", include: true },
  ],
  colors: [{ hex: "#e85d04", role: "accent", weight: 3 }],
  fonts: [{ family: "Montserrat", role: "heading" }],
};

function newRun(withKit = true): RebuildRun {
  const { run } = store.createOrReuseRun({ prospectId: `p-${caseNumber}`, company: "Total Electric", websiteUrl: "https://te.example", targetMarket: "Homeowners", location: "Cape Town", conversionGoal: "Book a call-out", requiredFunctions: [], designTemplate: "DESIGN.md", skillVersion: "1.3.0" });
  store.setRunField(run.id, "workspace_slug", "te");
  if (withKit) store.setBrandKit(run.id, kit);
  return store.readRun(run.id);
}

const post = (route: string, body: unknown) => fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.from([0, 0, 1, 0, 0, 0, 0, 200]), Buffer.alloc(20)]);

describe("editing the brand kit", () => {
  it("reorders, leaves out and corrects, and marks the kit as edited", async () => {
    const run = newRun();
    const response = await post(`/${run.id}/brand`, {
      assets: [{ id: "photo-01", include: false }, { id: "logo", include: true }],
      colors: [{ hex: "#0b3d91", role: "header" }, { hex: "#e85d04", role: "accent" }, { hex: "#e85d04", role: "accent" }],
      fonts: [{ family: "Open Sans", role: "body" }],
    });
    assert.equal(response.status, 200);
    const after = store.readRun(run.id).brandKit;
    assert.equal(after?.source, "edited");
    assert.deepEqual(after?.assets.map((asset) => [asset.id, asset.include]), [["photo-01", false], ["logo", true]]);
    // A duplicate is dropped; a colour that was there keeps its weight.
    assert.deepEqual(after?.colors, [{ hex: "#0b3d91", role: "header", weight: 1 }, { hex: "#e85d04", role: "accent", weight: 3 }]);
    assert.deepEqual(after?.fonts, [{ family: "Open Sans", role: "body" }]);
  });

  it("refuses a stale list of images, a font name that reads as markup, and a bad colour", async () => {
    const run = newRun();
    const stale = await post(`/${run.id}/brand`, { assets: [{ id: "logo", include: true }], colors: [], fonts: [] });
    assert.equal(stale.status, 409);
    assert.match(((await stale.json()) as { error: string }).error, /changed since this page loaded/);
    const font = await post(`/${run.id}/brand`, { assets: [{ id: "logo", include: true }, { id: "photo-01", include: true }], colors: [], fonts: [{ family: "Arial</style><script>", role: "body" }] });
    assert.equal(font.status, 422);
    const color = await post(`/${run.id}/brand`, { assets: [{ id: "logo", include: true }, { id: "photo-01", include: true }], colors: [{ hex: "red", role: "accent" }], fonts: [] });
    assert.equal(color.status, 422);
    assert.deepEqual(store.readRun(run.id).brandKit, kit);
  });

  it("removes an image for good when it is named as removed", async () => {
    const run = newRun();
    const response = await post(`/${run.id}/brand`, { assets: [{ id: "logo", include: true }], removed: ["photo-01"], colors: [], fonts: [] });
    assert.equal(response.status, 200);
    const after = store.readRun(run.id).brandKit;
    assert.deepEqual(after?.assets.map((asset) => asset.id), ["logo"]);
    assert.ok(store.readRun(run.id).events.some((event) => /1 image removed/.test(event.message)));
  });

  it("still refuses a list that misses an image, names one twice, or removes one it does not have", async () => {
    const run = newRun();
    const both = await post(`/${run.id}/brand`, { assets: [{ id: "logo", include: true }, { id: "photo-01", include: true }], removed: ["photo-01"], colors: [], fonts: [] });
    assert.equal(both.status, 409);
    const unknown = await post(`/${run.id}/brand`, { assets: [{ id: "logo", include: true }, { id: "photo-01", include: true }], removed: ["photo-99"], colors: [], fonts: [] });
    assert.equal(unknown.status, 409);
    const missing = await post(`/${run.id}/brand`, { assets: [], removed: ["logo"], colors: [], fonts: [] });
    assert.equal(missing.status, 409);
    assert.deepEqual(store.readRun(run.id).brandKit, kit);
  });
});

describe("uploading to the brand kit", () => {
  it("stores a real image under a server-made name and puts an uploaded logo first", async () => {
    const run = newRun();
    const response = await fetch(`${base}/${run.id}/brand/assets?kind=logo&alt=${encodeURIComponent("../../etc/passwd")}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(response.status, 201, await response.clone().text());
    const after = store.readRun(run.id);
    const first = after.brandKit?.assets[0];
    assert.equal(first?.kind, "logo");
    assert.equal(first?.sourceUrl, "uploaded");
    assert.deepEqual([first?.width, first?.height], [256, 200]);
    assert.match(first?.path ?? "", /^projects\/te\/docs\/website-rebuild\/brand\/logo-upload-[0-9a-f]{8}\.png$/);
    assert.ok(fs.readFileSync(path.join(root, "vault", first?.path ?? "")).equals(png));
    // The artifact route serves it back.
    const served = await fetch(`${base}/${run.id}/artifacts/${first?.artifactId}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  });

  it("refuses a file that only claims to be an image, a form post and an unknown kind", async () => {
    const run = newRun();
    const disguised = await fetch(`${base}/${run.id}/brand/assets?kind=photo`, { method: "POST", headers: { "Content-Type": "image/png" }, body: "<html><script>alert(1)</script></html>" });
    assert.equal(disguised.status, 415);
    const form = await fetch(`${base}/${run.id}/brand/assets?kind=photo`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
    assert.equal(form.status, 415);
    const kind = await fetch(`${base}/${run.id}/brand/assets?kind=banner`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(kind.status, 422);
    assert.equal(store.readRun(run.id).brandKit?.assets.length, 2);
  });

  it("starts a kit when capture found nothing to put in one", async () => {
    const run = newRun(false);
    const response = await fetch(`${base}/${run.id}/brand/assets?kind=photo`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(response.status, 201);
    assert.equal(store.readRun(run.id).brandKit?.assets.length, 1);
  });
});

describe("skipping the website capture", () => {
  it("skips a blocked capture so the rebuild goes on without the site", async () => {
    const run = newRun(false);
    // A capture is only blocked once the workspace exists.
    store.rebuildDatabase().prepare("UPDATE stages SET status = 'complete', revision = 1 WHERE run_id = ? AND stage = 'workspace'").run(run.id);
    store.blockStage(run.id, "capture", undefined, "The site could not be captured: answered 503. Check the address and retry, or skip this step to work without it.");
    const response = await post(`/${run.id}/stages/capture/skip`, {});
    assert.equal(response.status, 200);
    assert.match(store.readRun(run.id).siteNote ?? "", /^You chose to skip reading the site after it could not be read \(answered 503\.\)/);
    // The background run completes the capture as skipped.
    for (let attempt = 0; attempt < 50 && store.readRun(run.id).stages.find((stage) => stage.id === "capture")?.status !== "complete"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(store.readRun(run.id).stages.find((stage) => stage.id === "capture")?.status, "complete");
  });

  it("refuses to skip a capture that is not blocked", async () => {
    const run = newRun(false);
    const response = await post(`/${run.id}/stages/capture/skip`, {});
    assert.equal(response.status, 409);
  });
});

describe("a concept, opened live", () => {
  it("serves design and brand files, locked down, and nothing else in the repo", async () => {
    const run = newRun();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-concept-files-"));
    fs.mkdirSync(path.join(repo, "design/concept-a"), { recursive: true });
    fs.writeFileSync(path.join(repo, "design/concept-a/hero.html"), "<h1>Hi</h1>");
    fs.writeFileSync(path.join(repo, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(repo, "secret.html"), "nope");
    fs.symlinkSync(path.join(repo, "secret.html"), path.join(repo, "design/link.html"));
    store.setRunField(run.id, "repo_path", repo);
    const get = (file: string) => fetch(`${base}/${run.id}/concept-files/${file}`);

    const page = await get("design/concept-a/hero.html");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("content-security-policy") ?? "", /sandbox allow-scripts/);
    assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
    assert.equal(await page.text(), "<h1>Hi</h1>");

    for (const blocked of ["secret.html", ".env", "design/concept-a/nothing.html", "design/concept-a/%2e%2e/%2e%2e/secret.html"]) assert.equal((await get(blocked)).status, 404, blocked);
    assert.equal((await get("design/link.html")).status, 404, "a link in design/ cannot lead elsewhere in the repo");
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe("the image budget", () => {
  it("is set per run and refuses anything out of range", async () => {
    const run = newRun();
    assert.equal(store.readRun(run.id).artBudget, 0);
    const response = await post(`/${run.id}/art-budget`, { credits: 5 });
    assert.equal(response.status, 200);
    assert.equal(store.readRun(run.id).artBudget, 5);
    assert.equal((await post(`/${run.id}/art-budget`, { credits: 500 })).status, 422);
    assert.equal((await post(`/${run.id}/art-budget`, { credits: "lots" })).status, 422);
  });
});

describe("new concepts", () => {
  it("only the hero stage can start over", async () => {
    const run = newRun();
    assert.equal((await post(`/${run.id}/stages/build/request-changes`, { revision: 1, note: "x", fresh: true })).status, 422);
  });
});

describe("briefs with a brand kit", () => {
  const niche = NICHE_CLICHES[0];
  const briefFor = (run: RebuildRun, index: number) => {
    const assignments = assignDirections(run.id, niche, []);
    return conceptBrief(run, assignments[index], { niche, assignments, prior: [] }, { art: [], missingFonts: [], references: [] });
  };

  it("makes the concepts faithful, evolved and bold, using the logo by relative path", () => {
    const run = newRun();
    assert.match(briefFor(run, 0), /brand\/BRAND\.md/);
    assert.match(briefFor(run, 0), /Brand role: Faithful/);
    assert.match(briefFor(run, 1), /Brand role: Evolved/);
    assert.match(briefFor(run, 2), /Brand role: Bold/);
    assert.match(briefFor(run, 0), /primary logo, brand\/logo\.\*/);
    assert.match(briefFor(run, 0), /many are stock/);
    assert.match(buildBrief(run, "concept-a"), /public\/brand\/ and render them with next\/image/);
  });

  it("uses a wordmark when there is no kit", () => {
    const run = newRun(false);
    assert.doesNotMatch(briefFor(run, 0), /BRAND\.md|Faithful/);
    assert.match(briefFor(run, 0), /confident wordmark/);
    assert.doesNotMatch(buildBrief(run, "concept-a"), /next\/image/);
  });

  it("lists every image from the client's site in the preview handoff, for a rights check", () => {
    const note = brandRightsNote(kit).join("\n");
    assert.match(note, /2 images from the brand kit, 2 of them taken from the client's current site/);
    assert.match(note, /- photo: https:\/\/te\.example\/van\.jpg/);
    assert.match(note, /Montserrat/);
    assert.deepEqual(brandRightsNote(undefined), []);
  });
});
