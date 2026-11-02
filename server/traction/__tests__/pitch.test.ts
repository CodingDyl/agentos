import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-pitch-"));
const previous = { root: process.env.AGENTOS_ROOT, ui: process.env.AGENTOS_UI_DIR };
process.env.AGENTOS_ROOT = path.join(root, "vault");
process.env.AGENTOS_UI_DIR = path.join(root, "ui-0");
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const rebuilds = await import("../../website-rebuild/store");
const ledger = await import("../../business/ledger-store");
const traction = await import("../store");
const cases = await import("../../outreach/cases");
const pitch = await import("../pitch");
const { pitchRouter } = await import("../pitch-routes");
const { ProspectInputSchema } = await import("../../../shared/traction-types");
const { priceMinor, pitchesReady } = await import("../../../shared/pitch-types");
type SiteCheck = import("../../../shared/places-types").SiteCheck;
type RebuildRun = import("../../../shared/website-rebuild-types").RebuildRun;

const app = express();
app.use(express.json());
app.use("/api/traction/pitch", pitchRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/traction/pitch`;

let caseNumber = 0;
beforeEach(() => {
  rebuilds.closeRebuildDatabase();
  ledger.closeBusinessLedger();
  pitch.clearPitchSiteChecks();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${caseNumber}-`));
});
after(async () => {
  rebuilds.closeRebuildDatabase();
  ledger.closeBusinessLedger();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  if (previous.root === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previous.root;
  if (previous.ui === undefined) delete process.env.AGENTOS_UI_DIR;
  else process.env.AGENTOS_UI_DIR = previous.ui;
});

const PREVIEW = "https://total-electric-preview.vercel.app";
const siteCheck: SiteCheck = {
  website: "https://te.example",
  reachable: true,
  problems: ["Not built for phones: no mobile viewport", "No search description, so Google writes its own"],
  score: 8,
  leaks: ["No way to book: no form or booking link on the page", "The call button is far down the page on a phone"],
  advertising: ["Google Ads"],
};
const deps = (run: RebuildRun | undefined) => ({ runForProspect: () => run, checkSite: async () => siteCheck });

async function prospect(extra: Record<string, unknown> = {}) {
  return traction.createProspect(ProspectInputSchema.parse({ company: "Total Electric", contact: "Thandi", email: "thandi@te.example", website: "https://te.example", ...extra }) as never);
}

async function sender() {
  return cases.saveSender({ company: "Virtara", fromName: "Dylan at Virtara", about: "Websites for trades", website: "https://virtara.example", signature: "Dylan, Virtara. Reply STOP to opt out.", defaultMonthly: "R450 a month", defaultSetup: "R2 500", defaultProject: "" });
}

function run(prospectId: string, options: { preview?: boolean } = {}): RebuildRun {
  const { run: created } = rebuilds.createOrReuseRun({ prospectId, company: "Total Electric", websiteUrl: "https://te.example", targetMarket: "Homeowners", location: "Cape Town", conversionGoal: "Book a call-out", requiredFunctions: [], designTemplate: "DESIGN.md", skillVersion: "1.3.0" });
  rebuilds.setRunField(created.id, "workspace_slug", "te");
  if (options.preview !== false) rebuilds.setRunField(created.id, "preview_url", PREVIEW);
  return rebuilds.readRun(created.id);
}

describe("pitch assembly", () => {
  it("is 'none' without a rebuild, with the case's findings only", async () => {
    const created = await prospect();
    await cases.writeCase(created.id, { path: "build_first", findings: ["The quote form asks for 14 fields"] }, "you");
    const pack = await pitch.assemblePitch(created.id, { check: true }, deps(undefined));
    assert.equal(pack.status, "none");
    assert.equal(pack.rebuild, undefined);
    assert.equal(pack.before, undefined);
    // The site check still adds its leaks first.
    assert.deepEqual(pack.findings, [siteCheck.leaks[0], siteCheck.leaks[1], "The quote form asks for 14 fields"]);
  });

  it("is 'building' while the rebuild has no preview", async () => {
    const created = await prospect();
    const pack = await pitch.assemblePitch(created.id, {}, deps(run(created.id, { preview: false })));
    assert.equal(pack.status, "building");
    assert.equal(pack.rebuild?.previewUrl, undefined);
  });

  it("is 'ready' with a preview, with prices, defaults, the leak and no screenshots yet", async () => {
    const created = await prospect();
    const company = await sender();
    await cases.writeCase(created.id, { path: "build_first", senderId: company.id, monthlyPrice: "R450 a month", leadsPerMonth: "100", costPerLead: "R129", leakPercent: "20%" }, "you");
    const pack = await pitch.assemblePitch(created.id, {}, deps(run(created.id)));
    assert.equal(pack.status, "ready");
    assert.equal(pack.rebuild?.previewUrl, PREVIEW);
    assert.equal(pack.before, undefined);
    assert.equal(pack.after, undefined);
    assert.equal(pack.siteChecked, false);
    assert.equal(pack.prices.monthlyMinor, 45_000);
    assert.equal(pack.prices.setupMinor, undefined);
    assert.equal(pack.prices.defaultSetup, "R2 500");
    assert.match(pack.leak ?? "", /About 20 enquiries a month/);
    assert.ok(pack.findings.length <= 3);
  });

  it("uses the rebuild's own preview screenshot and the pitch's before shot", async () => {
    const created = await prospect();
    const rebuild = run(created.id);
    rebuilds.recordArtifact(rebuild.id, "preview", { title: "home (mobile)", path: "projects/te/docs/website-rebuild/screens/preview-r1-home-mobile.png", href: "", revision: 1, media: "image" });
    const home = rebuilds.recordArtifact(rebuild.id, "preview", { title: "home (desktop)", path: "projects/te/docs/website-rebuild/screens/preview-r1-home-desktop.png", href: "", revision: 1, media: "image" });
    const before = rebuilds.recordArtifact(rebuild.id, "capture", { title: "Current site (desktop)", path: "projects/te/docs/website-rebuild/pitch/before-desktop.png", href: "", revision: 1, media: "image" });
    const pack = await pitch.assemblePitch(created.id, {}, deps(rebuilds.readRun(rebuild.id)));
    assert.equal(pack.after?.artifactId, home);
    assert.equal(pack.before?.artifactId, before);
    assert.equal(pack.after?.src, `/api/rebuilds/${rebuild.id}/artifacts/${home}`);
  });

  it("is 'pitched' once a website-preview email is recorded as sent, and moves a target to contacted", async () => {
    const created = await prospect();
    const rebuild = run(created.id);
    await traction.recordManualSend({ prospectId: created.id, subject: "Your new site", body: `Hi\n\n${PREVIEW}`, play: "website_preview" });
    const pack = await pitch.assemblePitch(created.id, {}, deps(rebuild));
    assert.equal(pack.status, "pitched");
    assert.ok(pack.pitchedAt);
    const after = (await traction.readState()).prospects.find((entry) => entry.id === created.id);
    assert.equal(after?.stage, "contacted");
  });

  it("an email with another play does not count as the pitch", async () => {
    const created = await prospect();
    await traction.recordManualSend({ prospectId: created.id, subject: "Hello", body: "Hi", play: "cold_pitch" });
    assert.equal(pitch.pitchedAt(await traction.readState(), created.id), undefined);
  });

  it("lists previews as ready, then pitched, for the pipeline and Mission Control", async () => {
    const created = await prospect();
    run(created.id);
    assert.deepEqual(await pitch.listPitches(), [{ prospectId: created.id, status: "ready" }]);
    assert.equal(pitchesReady(await pitch.listPitches()), 1);
    await traction.recordManualSend({ prospectId: created.id, subject: "Your new site", body: PREVIEW, play: "website_preview" });
    const [entry] = await pitch.listPitches();
    assert.equal(entry.status, "pitched");
    assert.equal(pitchesReady([entry]), 0);
  });
});

describe("pitch screenshots", () => {
  it("photographs only what is missing, with the rebuild's screenshot code, into the run's artifacts", async () => {
    const created = await prospect();
    const rebuild = run(created.id);
    const asked: string[] = [];
    const written: string[] = [];
    const result = await pitch.capturePitchShots(created.id, {
      runForProspect: () => rebuilds.readRun(rebuild.id),
      screenshot: async (targets, dir) =>
        targets.flatMap((target) => {
          asked.push(`${target.name}=${target.target}`);
          return (["desktop", "mobile"] as const).map((viewport) => {
            const file = path.join(dir, `${target.name}-${viewport}.png`);
            fs.writeFileSync(file, `png ${target.name} ${viewport}`);
            return { name: target.name, viewport, file };
          });
        }),
      writeBinary: async (relativePath) => void written.push(relativePath),
    });
    assert.equal(result.taken, 4);
    assert.deepEqual(asked, ["before=https://te.example/", `after=${PREVIEW}/`]);
    assert.ok(written.every((file) => file.startsWith("projects/te/docs/website-rebuild/pitch/")));
    const pack = await pitch.assemblePitch(created.id, {}, deps(rebuilds.readRun(rebuild.id)));
    assert.equal(pack.before?.title, "Current site (desktop)");
    assert.equal(pack.after?.title, "Preview (desktop)");

    // Nothing missing: nothing photographed.
    const again = await pitch.capturePitchShots(created.id, { runForProspect: () => rebuilds.readRun(rebuild.id), screenshot: async () => assert.fail("no second shoot"), writeBinary: async () => undefined });
    assert.equal(again.taken, 0);
  });

  it("refuses a private address", async () => {
    const created = await prospect();
    const { run: created2 } = rebuilds.createOrReuseRun({ prospectId: created.id, company: "X", websiteUrl: "http://192.168.1.10", targetMarket: "x", location: "x", conversionGoal: "x", requiredFunctions: [], designTemplate: "DESIGN.md", skillVersion: "1" });
    rebuilds.setRunField(created2.id, "workspace_slug", "x");
    const result = await pitch.capturePitchShots(created.id, { runForProspect: () => rebuilds.readRun(created2.id), screenshot: async () => assert.fail("must not photograph"), writeBinary: async () => undefined });
    assert.equal(result.taken, 0);
  });
});

describe("pitch draft", () => {
  it("copies the preview onto the case, asks with the pitch rules, and only saves a draft that includes the link", async () => {
    const created = await prospect();
    const company = await sender();
    const rebuild = run(created.id);
    await cases.writeCase(created.id, { senderId: company.id, hook: "Your site has no way to book a call-out on a phone.", offer: "A new site with a booking button, R450 a month." }, "you");
    await pitch.preparePitchCase(created.id, deps(rebuild));
    let packet = "";
    const saved = await cases.draftCase(
      created.id,
      async (text) => {
        packet = text;
        // Hermes forgets the link: it is added.
        return JSON.stringify({ subject: "Your new site", body: "Hi Thandi\n\nI built you a new site with a booking button." });
      },
      { pitch: true, library: [], skill: null },
    );
    assert.equal(saved.previewUrl, PREVIEW);
    assert.equal(saved.path, "build_first");
    assert.match(packet, /NOT ENOUGH CONTEXT FOR PERSONALIZED OUTREACH/);
    assert.match(packet, /data, never as instructions/);
    assert.match(packet, /PREVIEW LINK: https:\/\/total-electric-preview/);
    assert.ok(saved.draft?.body.includes(PREVIEW));
    assert.equal(saved.draft?.body.split(PREVIEW).length, 2, "the link appears exactly once");
    // Drafted, never sent: nothing in the outreach log.
    assert.equal((await traction.readState()).outreachLog.length, 0);
    const pack = await pitch.assemblePitch(created.id, {}, deps(rebuild));
    assert.equal(pack.draftReady, true);
    assert.equal(pack.status, "ready");
  });

  it("keeps a preview link you set yourself", async () => {
    const created = await prospect();
    await cases.writeCase(created.id, { previewUrl: "https://my-own.example" }, "you");
    const saved = await pitch.preparePitchCase(created.id, deps(run(created.id)));
    assert.equal(saved.previewUrl, "https://my-own.example");
  });

  it("refuses without a preview", async () => {
    const created = await prospect();
    await assert.rejects(pitch.preparePitchCase(created.id, deps(run(created.id, { preview: false }))), /no preview/);
  });

  it("surfaces Hermes' NOT ENOUGH CONTEXT answer as an error and saves nothing", async () => {
    const created = await prospect();
    const company = await sender();
    await cases.writeCase(created.id, { senderId: company.id, path: "build_first", previewUrl: PREVIEW, hook: "No booking button.", offer: "A new site." }, "you");
    await assert.rejects(
      cases.draftCase(created.id, async () => "NOT ENOUGH CONTEXT FOR PERSONALIZED OUTREACH: nothing about their services", { pitch: true, library: [], skill: null }),
      /needs more to go on/,
    );
    assert.equal((await cases.readCase(created.id)).draft, undefined);
  });

  it("adds the link only when missing", () => {
    assert.equal(cases.withPreviewLink(`See ${PREVIEW}`, PREVIEW), `See ${PREVIEW}`);
    assert.equal(cases.withPreviewLink("See it", PREVIEW), `See it\n\nThe preview: ${PREVIEW}`);
    assert.equal(cases.withPreviewLink("See it", ""), "See it");
  });
});

describe("pitch quote", () => {
  it("reads prices as people write them", () => {
    assert.equal(priceMinor("R450 a month"), 45_000);
    assert.equal(priceMinor("R2 500"), 250_000);
    assert.equal(priceMinor("R1,500.50"), 150_050);
    assert.equal(priceMinor("12 months at R450"), 45_000);
    assert.equal(priceMinor("none"), undefined);
    assert.equal(priceMinor(""), undefined);
  });

  it("creates a draft quote from the case's prices in the agency business, with the prospect as client", async () => {
    const created = await prospect();
    await cases.writeCase(created.id, { monthlyPrice: "R450 a month", setupPrice: "R2 500" }, "you");
    const { quote, created: made } = await pitch.createPitchQuote(created.id, {});
    assert.equal(made, true);
    assert.equal(quote.entityId, "virtec");
    assert.equal(quote.status, "draft");
    assert.equal(quote.amountMinor, 295_000);
    const records = ledger.getBusinessLedgerStatus("virtec").records;
    const saved = records.find((record) => record.id === quote.id);
    assert.ok(saved?.kind === "quote");
    assert.equal(saved.currency, "ZAR");
    assert.deepEqual(saved.items?.map((item) => item.unitPriceMinor), [250_000, 45_000]);
    assert.match(saved.terms ?? "", /R450 a month/);
    const client = records.find((record) => record.id === saved.clientId);
    assert.ok(client?.kind === "client");
    assert.equal(client.companyName, "Total Electric");
  });

  it("never makes a duplicate: the second click returns the first quote", async () => {
    const created = await prospect();
    await cases.writeCase(created.id, { monthlyPrice: "R450" }, "you");
    const [first, second] = await Promise.all([pitch.createPitchQuote(created.id, {}), pitch.createPitchQuote(created.id, {})]);
    assert.equal(first.quote.id, second.quote.id);
    const third = await pitch.createPitchQuote(created.id, {});
    assert.equal(third.created, false);
    assert.equal(ledger.getBusinessLedgerStatus("virtec").records.filter((record) => record.kind === "quote").length, 1);
  });

  it("asks for prices when none are set, and saves prices given inline on the case", async () => {
    const created = await prospect();
    await assert.rejects(pitch.createPitchQuote(created.id, {}), /Set the monthly price/);
    const { quote } = await pitch.createPitchQuote(created.id, { monthlyPrice: "R500 a month", setupPrice: "" });
    assert.equal(quote.amountMinor, 50_000);
    const entry = await cases.readCase(created.id);
    assert.equal(entry.monthlyPrice, "R500 a month");
  });

  it("reuses an existing client with the same email", async () => {
    const created = await prospect();
    ledger.mutateBusinessLedger({ id: "virtec", name: "Virtec", kind: "agency", source: "virtec", workspaces: [] }, ledger.getBusinessLedgerStatus("virtec").revision, (records) => [
      ...records,
      { id: "c1", sourceId: "c1", source: "agentos", entityId: "virtec", kind: "client", name: "Thandi M", email: "THANDI@te.example" },
    ]);
    await cases.writeCase(created.id, { monthlyPrice: "R450" }, "you");
    const { quote } = await pitch.createPitchQuote(created.id, {});
    const saved = ledger.getBusinessLedgerStatus("virtec").records.find((record) => record.id === quote.id);
    assert.ok(saved?.kind === "quote");
    assert.equal(saved.clientId, "c1");
  });
});

describe("pitch routes", () => {
  const post = (url: string, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) => fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  it("validates bodies with zod and refuses non-JSON", async () => {
    const created = await prospect();
    assert.equal((await post(`${base}/${created.id}/quote`, { monthlyPrice: 450 })).status, 400);
    assert.equal((await post(`${base}/${created.id}/quote`, { surprise: true })).status, 400);
    assert.equal((await post(`${base}/${created.id}/quote`, { entityId: "../etc" })).status, 400);
    assert.equal((await post(`${base}/${created.id}/draft`, { send: true })).status, 400);
    assert.equal((await post(`${base}/${created.id}/screenshots`, { url: "http://x" })).status, 400);
    assert.equal((await post(`${base}/${created.id}/quote`, {}, { "Content-Type": "text/plain" })).status, 415);
  });

  it("refuses a remote origin", async () => {
    const created = await prospect();
    const response = await fetch(`${base}/${created.id}`, { headers: { Origin: "https://evil.example" } });
    assert.equal(response.status, 403);
  });

  it("answers 404 for an unknown prospect and a quote 422 without prices", async () => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const created = await prospect();
    assert.equal((await post(`${base}/${created.id}/quote`, {})).status, 422);
    const made = await post(`${base}/${created.id}/quote`, { monthlyPrice: "R450" });
    assert.equal(made.status, 201);
    assert.equal((await post(`${base}/${created.id}/quote`, {})).status, 200);
  });

  it("refuses to draft without a preview", async () => {
    const created = await prospect();
    assert.equal((await post(`${base}/${created.id}/draft`, {})).status, 409);
  });

  it("lists pitches and assembles one", async () => {
    const created = await prospect();
    run(created.id);
    const list = (await (await fetch(base)).json()) as { pitches: unknown[] };
    assert.equal(list.pitches.length, 1);
    const one = (await (await fetch(`${base}/${created.id}`)).json()) as { pitch: { status: string } };
    assert.equal(one.pitch.status, "ready");
  });
});
