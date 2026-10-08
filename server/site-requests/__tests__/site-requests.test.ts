import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-site-requests-"));
const previous = { root: process.env.AGENTOS_ROOT, ui: process.env.AGENTOS_UI_DIR };
process.env.AGENTOS_ROOT = path.join(root, "vault");
process.env.AGENTOS_UI_DIR = path.join(root, "ui");

const store = await import("../store");
const { runTriage, parseTriageAnswer, triageDeps, triagePrompt } = await import("../triage");
const { draftQuoteEmail, mailDeps, quoteEmail } = await import("../quote-email");
const { siteRequestRouter } = await import("../routes");
const { coverageOf, clientStatusLabel } = await import("../../../shared/site-request-types");
type MailComposeInput = import("../../../shared/mail-compose-types").MailComposeInput;

const app = express();
app.use(express.json());
app.use("/api/site-requests", siteRequestRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/site-requests`;

const realClock = store.siteRequestClock.now;
let caseNumber = 0;
beforeEach(() => {
  store.closeSiteRequestDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${caseNumber}-`));
  store.siteRequestClock.now = realClock;
  triageDeps.current = { classify: async () => { throw new Error("Hermes is not part of this test."); } };
});
after(async () => {
  store.closeSiteRequestDatabase();
  store.siteRequestClock.now = realClock;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  if (previous.root === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previous.root;
  if (previous.ui === undefined) delete process.env.AGENTOS_UI_DIR;
  else process.env.AGENTOS_UI_DIR = previous.ui;
});

const care = () => store.saveSite({ slug: "total-electric", company: "Total Electric", contactEmail: "owner@total-electric.example", plan: "care", productionUrl: "https://total-electric.example" });
const bare = () => store.saveSite({ slug: "no-plan", company: "No Plan Plumbing", plan: "none" });
const ask = (siteSlug = "total-electric", title = "Change the phone number") => store.createRequest({ siteSlug, kind: "change", title, description: `Please ${title.toLowerCase()} on the contact page.`, page: "/contact" });
const small = (hours: number) => ({ classification: "small_edit" as const, estimateHours: hours, reason: "A copy change." });

describe("coverage", () => {
  it("pays only for a small edit on a plan that has the hours left, and says why not", () => {
    const base = { plan: "care" as const, includedHoursPerMonth: 2, hoursUsed: 0, classification: "small_edit" as const, estimateHours: 1 };
    assert.equal(coverageOf(base).covered, true);
    assert.match(coverageOf({ ...base, plan: "none" }).reason, /no Care or Maintenance plan/);
    assert.match(coverageOf({ ...base, classification: "new_feature" }).reason, /new feature is quoted/);
    assert.match(coverageOf({ ...base, estimateHours: 1.5, hoursUsed: 1 }).reason, /1\.5h is more than the 1h left of this month's 2h/);
    assert.match(coverageOf({ ...base, hoursUsed: 2 }).reason, /used up/);
    assert.equal(coverageOf({ ...base, estimateHours: 2 }).covered, true, "exactly the hours left is covered");
  });

  it("tells the client four things, whatever is happening behind them", () => {
    assert.equal(clientStatusLabel("received"), "Received");
    assert.equal(clientStatusLabel("quoted"), "Received");
    assert.equal(clientStatusLabel("approved"), "In progress");
    assert.equal(clientStatusLabel("blocked"), "In progress");
    assert.equal(clientStatusLabel("ready_for_review"), "Ready for review");
    assert.equal(clientStatusLabel("live"), "Live");
    assert.equal(clientStatusLabel("declined"), "Closed");
  });
});

describe("sites and requests", () => {
  it("registers a site with Care's two hours, and refuses a request for a site that is not registered", () => {
    const site = care();
    assert.equal(site.includedHoursPerMonth, 2);
    assert.equal(site.hoursUsedThisMonth, 0);
    assert.throws(() => store.createRequest({ siteSlug: "ghost", kind: "change", title: "x", description: "y" }), /not registered/);
    assert.throws(() => store.saveSite({ slug: "Bad Slug", company: "x", plan: "none" }), /lowercase/);
  });

  it("receives a request, tells the client 'Received', and keeps its history from the start", () => {
    care();
    const request = ask();
    assert.equal(request.status, "received");
    assert.equal(request.clientStatus, "Received");
    assert.equal(request.canApprove, false);
    assert.match(request.buildBlocker ?? "", /Triage/);
    assert.match(request.events[0].message, /Received from Total Electric/);
    assert.throws(() => store.createRequest({ siteSlug: "total-electric", kind: "change", title: "  ", description: "y" }), /short title/);
  });

  it("a covered request waits for approval; approving it records who decided what", () => {
    care();
    const request = ask();
    const triaged = store.setTriage(request.id, small(1), "ai");
    assert.equal(triaged.status, "triaged");
    assert.equal(triaged.triage?.covered, true);
    assert.equal(triaged.canApprove, true);
    const approved = store.approveRequest(request.id);
    assert.equal(approved.status, "approved");
    assert.equal(approved.clientStatus, "In progress");
    assert.ok(approved.approvedAt);
    assert.deepEqual(approved.events.map((event) => event.kind).reverse().slice(0, 4), ["status", "triage", "status", "decision"]);
  });

  it("spends the month's hours when a request is approved, not twice", () => {
    care();
    const first = ask("total-electric", "Update the hero text");
    const second = ask("total-electric", "Swap the footer logo");
    store.setTriage(first.id, small(1.5), "person");
    store.setTriage(second.id, small(1.5), "person");
    assert.equal(store.readRequest(second.id).triage?.covered, true, "both look covered while nothing is spent");
    store.approveRequest(first.id);
    assert.equal(store.readSite("total-electric").hoursUsedThisMonth, 1.5);
    assert.throws(() => store.approveRequest(second.id), /No longer covered/);
    const after = store.readRequest(second.id);
    assert.equal(after.status, "quote_needed");
    assert.equal(after.triage?.covered, false);
  });

  it("a new month starts with the whole allowance again", () => {
    care();
    const request = ask();
    store.setTriage(request.id, small(2), "person");
    store.approveRequest(request.id);
    assert.equal(store.readSite("total-electric").hoursUsedThisMonth, 2);
    const next = new Date(store.siteRequestClock.now());
    next.setMonth(next.getMonth() + 1, 15);
    store.siteRequestClock.now = () => next.getTime();
    assert.equal(store.readSite("total-electric").hoursUsedThisMonth, 0);
    const another = ask("total-electric", "Another small change");
    assert.equal(store.setTriage(another.id, small(2), "person").triage?.covered, true);
  });

  it("changing a site's plan re-reads its open requests against it", () => {
    bare();
    const request = ask("no-plan", "Fix a typo");
    assert.equal(store.setTriage(request.id, small(0.5), "ai").status, "quote_needed");
    store.saveSite({ slug: "no-plan", company: "No Plan Plumbing", plan: "care" });
    const after = store.readRequest(request.id);
    assert.equal(after.status, "triaged");
    assert.equal(after.triage?.covered, true);
  });
});

describe("the build gate", () => {
  it("will not approve a request the plan does not cover until its quote is accepted", () => {
    bare();
    const request = ask("no-plan", "Add a booking system");
    assert.throws(() => store.approveRequest(request.id), /Triage this request first/);
    const triaged = store.setTriage(request.id, { classification: "new_feature", estimateHours: 12, reason: "Booking is a new feature." }, "ai");
    assert.equal(triaged.status, "quote_needed");
    assert.equal(triaged.canApprove, false);
    assert.throws(() => store.approveRequest(request.id), /Outside the plan/);

    const quoted = store.makeQuote(request.id, { estimatedHours: 12, complexity: "Medium", urgency: "Standard", hourlyRate: 300 });
    assert.equal(quoted.status, "quoted");
    assert.equal(quoted.quote?.total, 5400, "12h × R300 × 1.5");
    assert.equal(quoted.canApprove, false);
    assert.throws(() => store.approveRequest(request.id), /waiting for the client to accept/);
    assert.equal(store.readRequest(request.id).status, "quoted", "a refused approval changes nothing");

    const accepted = store.acceptQuote(request.id);
    assert.equal(accepted.canApprove, true);
    assert.equal(store.approveRequest(request.id).status, "approved");
  });

  it("is the same through the API: an out-of-plan request cannot be approved by calling approve", async () => {
    bare();
    const request = ask("no-plan", "Add a shop");
    store.setTriage(request.id, { classification: "new_feature", estimateHours: 20, reason: "A shop." }, "person");
    const refused = await fetch(`${base}/${request.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { error: string }).error, /Outside the plan/);
    assert.equal(store.readRequest(request.id).status, "quote_needed");
  });

  it("a quote cannot be made for what the plan covers, and an accepted quote is never replaced", () => {
    care();
    const covered = ask();
    store.setTriage(covered.id, small(1), "ai");
    assert.throws(() => store.makeQuote(covered.id, { estimatedHours: 1, complexity: "Low", urgency: "Standard", hourlyRate: 300 }), /needs no quote/);

    bare();
    const feature = ask("no-plan", "Build a portal");
    store.setTriage(feature.id, { classification: "new_feature", estimateHours: 30, reason: "Portal." }, "person");
    store.makeQuote(feature.id, { estimatedHours: 30, complexity: "High", urgency: "Standard", hourlyRate: 300 });
    store.acceptQuote(feature.id);
    assert.throws(() => store.makeQuote(feature.id, { estimatedHours: 1, complexity: "Low", urgency: "Standard", hourlyRate: 300 }), /already accepted/);
  });

  it("an approved request can no longer be re-triaged, and a closed one cannot be approved", () => {
    care();
    const request = ask();
    store.setTriage(request.id, small(1), "ai");
    store.approveRequest(request.id);
    assert.throws(() => store.setTriage(request.id, small(1), "person"), /already been approved/);
    const other = ask("total-electric", "A second one");
    store.closeRequest(other.id, "declined", "Out of scope");
    assert.throws(() => store.approveRequest(other.id), /already declined/);
    assert.equal(store.readRequest(other.id).clientStatus, "Closed");
  });
});

describe("AI triage", () => {
  it("records the AI's proposal as the AI's, and a person's override replaces it", async () => {
    care();
    const request = ask();
    const seen: string[] = [];
    triageDeps.current = {
      classify: async (found, site) => {
        seen.push(triagePrompt(found, site));
        return 'Here you go:\n{"classification":"small_edit","estimateHours":"0.75","reason":"A phone number is copy."}\nHope that helps.';
      },
    };
    const triaged = await runTriage(request.id);
    assert.equal(triaged.triage?.setBy, "ai");
    assert.equal(triaged.triage?.estimateHours, 0.75);
    assert.match(seen[0], /Client: Total Electric\. Plan: Care\./);
    assert.match(seen[0], /Page: \/contact/);

    const overridden = store.setTriage(request.id, { classification: "new_feature", estimateHours: 6, reason: "Actually a new form." }, "person");
    assert.equal(overridden.triage?.setBy, "person");
    assert.equal(overridden.status, "quote_needed");
  });

  it("records nothing when Hermes is down or answers badly", async () => {
    care();
    const request = ask();
    await assert.rejects(runTriage(request.id), /could not triage this: Hermes is not part of this test\. Triage it yourself/);
    for (const reply of ["no json here", '{"classification":"huge","estimateHours":2,"reason":"x"}', '{"classification":"small_edit","estimateHours":"lots","reason":"x"}', '{"classification":"small_edit","estimateHours":2}']) {
      assert.throws(() => parseTriageAnswer(reply), /Triage it yourself/, reply);
    }
    assert.equal(store.readRequest(request.id).triage, undefined);
    assert.equal(store.readRequest(request.id).status, "received");
  });
});

describe("quote email", () => {
  it("is saved as a draft to the client's contact, never sent, and recorded", async () => {
    bare();
    store.saveSite({ slug: "no-plan", company: "No Plan Plumbing", plan: "none", contactEmail: "boss@noplan.example" });
    const request = ask("no-plan", "Add online booking");
    store.setTriage(request.id, { classification: "new_feature", estimateHours: 10, reason: "Booking." }, "ai");
    await assert.rejects(draftQuoteEmail(request.id), /Price the request/);
    store.makeQuote(request.id, { estimatedHours: 10, complexity: "Medium", urgency: "Standard", hourlyRate: 300 });

    const drafts: MailComposeInput[] = [];
    mailDeps.current = { draft: async (input) => { drafts.push(input); return { item: { id: "d1", kind: "draft", to: input.to, subject: input.subject, tag: "normal", attachmentCount: 0, labelApplied: true, createdAt: new Date().toISOString() } }; } };
    const result = await draftQuoteEmail(request.id);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].mode, "draft");
    assert.deepEqual(drafts[0].to, ["boss@noplan.example"]);
    assert.match(drafts[0].body, /Total: R4 500\.00/);
    assert.doesNotMatch(drafts[0].body, /—/, "no em dashes, house style");
    assert.ok(result.quote?.draftedAt);
    assert.match(result.events[0].message, /Nothing was sent/);
  });

  it("needs somewhere to send it", async () => {
    bare();
    const request = ask("no-plan", "Add a blog");
    store.setTriage(request.id, { classification: "new_feature", estimateHours: 4, reason: "Blog." }, "ai");
    store.makeQuote(request.id, { estimatedHours: 4, complexity: "Low", urgency: "Standard", hourlyRate: 300 });
    await assert.rejects(draftQuoteEmail(request.id), /no contact email/);
    const text = quoteEmail(store.readRequest(request.id), "No Plan Plumbing", store.readRequest(request.id).quote!);
    assert.equal(text.subject, "Quote: Add a blog");
  });
});

describe("the API", () => {
  const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("takes a request in, triages it behind the answer, and answers with the request", async () => {
    care();
    triageDeps.current = { classify: async () => '{"classification":"small_edit","estimateHours":1,"reason":"Copy."}' };
    const created = await post("", { siteSlug: "total-electric", kind: "change", title: "New opening hours", description: "Open at 7 from Monday.", priority: "urgent" });
    assert.equal(created.status, 201);
    const request = (await created.json()) as { id: string; priority: string };
    assert.equal(request.priority, "urgent");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const read = (await (await fetch(`${base}/${request.id}`)).json()) as { status: string; triage?: { setBy: string } };
    assert.equal(read.status, "triaged");
    assert.equal(read.triage?.setBy, "ai");
    const list = (await (await fetch(`${base}?site=total-electric`)).json()) as { id: string }[];
    assert.deepEqual(list.map((entry) => entry.id), [request.id]);
  });

  it("says what is wrong instead of failing quietly", async () => {
    care();
    assert.equal((await post("", { siteSlug: "total-electric", kind: "change", title: "", description: "x" })).status, 422);
    assert.equal((await post("", { siteSlug: "ghost", kind: "change", title: "x", description: "y" })).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const override = await post(`/${ask().id}/triage/override`, { classification: "small_edit" });
    assert.equal(override.status, 422);
    const notJson = await fetch(`${base}/anything/approve`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
    assert.equal(notJson.status, 415);
  });

  it("lists rebuilt sites that are not registered yet, and registers one over the API", async () => {
    const empty = (await (await fetch(`${base}/sites`)).json()) as { sites: unknown[]; suggestions: unknown[] };
    assert.deepEqual(empty.sites, []);
    const put = await fetch(`${base}/sites/total-electric`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: "Total Electric", plan: "care" }) });
    assert.equal(put.status, 200);
    assert.equal(((await put.json()) as { includedHoursPerMonth: number }).includedHoursPerMonth, 2);
    const mismatch = await fetch(`${base}/sites/total-electric`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: "other", company: "x", plan: "none" }) });
    assert.equal(mismatch.status, 422);
  });
});
