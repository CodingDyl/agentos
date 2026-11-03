import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-feature-intake-"));
process.env.AGENTOS_UI_DIR = root;
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const store = await import("../store");
const settings = await import("../feature-settings");
const { checkPreview, enquiryForms, formWorksWithoutJavaScript } = await import("../qa");
const { functionsBrief } = await import("../prompts");
const publish = await import("../publish");
const { setConnectorEnabled } = await import("../../connectors/policy");

let caseNumber = 0;
beforeEach(() => {
  store.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `case-${caseNumber}-`));
});
after(() => {
  store.closeRebuildDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

function newRun() {
  return store.createOrReuseRun({ prospectId: `p-${caseNumber}`, company: "Harris Marcus", websiteUrl: "https://example.test", targetMarket: "Clients", location: "Sandton", conversionGoal: "Enquire", requiredFunctions: ["contact_form", "blog", "booking"], designTemplate: "DESIGN.md", skillVersion: "1.5.0" }).run;
}

describe("feature settings", () => {
  it("keeps a secret sealed: the view says only that it is set, and the database never holds it in the clear", async () => {
    const run = newRun();
    const view = await settings.saveFeatureSettings(run.id, { values: { CONTACT_TO_EMAIL: "office@example.test" }, secrets: { RESEND_API_KEY: "re_live_secret_123" }, legacyUrls: ["/articles/", "/articles/"] });
    assert.deepEqual(view.secretsSet, { RESEND_API_KEY: true });
    assert.equal(JSON.stringify(view).includes("re_live_secret_123"), false);
    assert.deepEqual(view.legacyUrls, ["/articles/"]);
    const row = store.rebuildDatabase().prepare("SELECT feature_settings FROM runs WHERE id = ?").get(run.id) as { feature_settings: string };
    assert.equal(row.feature_settings.includes("re_live_secret_123"), false);
    assert.deepEqual(await settings.previewEnvironment(run.id), { CONTACT_TO_EMAIL: "office@example.test", RESEND_API_KEY: "re_live_secret_123" });
  });

  it("keeps a secret that is left out, clears one sent empty, and clears an empty value", async () => {
    const run = newRun();
    await settings.saveFeatureSettings(run.id, { values: { BOOKING_URL: "https://calendly.com/hmm" }, secrets: { RESEND_API_KEY: "re_1" } });
    await settings.saveFeatureSettings(run.id, { values: { CONTACT_FROM_EMAIL: "web@example.test" } });
    assert.deepEqual(settings.featureSettingsView(run.id).secretsSet, { RESEND_API_KEY: true });
    assert.equal(settings.featureSettingsView(run.id).values.BOOKING_URL, "https://calendly.com/hmm");
    await settings.saveFeatureSettings(run.id, { values: { BOOKING_URL: "" }, secrets: { RESEND_API_KEY: "" } });
    assert.deepEqual(settings.featureSettingsView(run.id).secretsSet, {});
    assert.equal(settings.featureSettingsView(run.id).values.BOOKING_URL, undefined);
  });

  it("refuses an insecure booking page and an old address that is not a path", async () => {
    const run = newRun();
    await assert.rejects(settings.saveFeatureSettings(run.id, { values: { BOOKING_URL: "http://calendly.com/x" } }));
    await assert.rejects(settings.saveFeatureSettings(run.id, { legacyUrls: ["https://old.example/articles"] }));
  });

  it("tells the worker the names that are set and the old addresses, never a value", async () => {
    const run = newRun();
    await settings.saveFeatureSettings(run.id, { values: { CONTACT_TO_EMAIL: "office@example.test" }, secrets: { RESEND_API_KEY: "re_live_secret_123" }, legacyUrls: ["/articles/"] });
    const brief = functionsBrief(store.readRun(run.id), undefined, undefined, settings.briefSettings(run.id));
    assert.match(brief, /Set: CONTACT_TO_EMAIL, RESEND_API_KEY\./);
    assert.match(brief, /- \/articles\//);
    assert.match(brief, /RESEND_API_KEY, CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL/);
    assert.doesNotMatch(brief, /re_live_secret_123|office@example\.test/);
  });
});

describe("the enquiry form without JavaScript", () => {
  it("fails the Harris Marcus form: no method, so the browser would GET the enquiry into the URL", () => {
    const [tag] = enquiryForms('<form class="grid" novalidate><input name="email" type="email"><textarea name="message"></textarea></form>');
    const result = formWorksWithoutJavaScript(tag);
    assert.equal(result.ok, false);
    assert.match(result.detail, /no method/);
  });

  it("passes a server-action form React renders with POST", () => {
    const [tag] = enquiryForms('<form action="" encType="multipart/form-data" method="POST"><input type="email" name="email"></form>');
    assert.equal(formWorksWithoutJavaScript(tag).ok, true);
  });

  it("fails a form whose action only works with JavaScript, and ignores forms that ask for no enquiry", () => {
    assert.equal(formWorksWithoutJavaScript('method="post" action="javascript:throw new Error()"').ok, false);
    assert.deepEqual(enquiryForms('<form method="get" action="/search"><input name="q"></form>'), []);
  });
});

describe("visitor journeys on a site", () => {
  const site: Record<string, { status: number; body?: string; location?: string; type?: string }> = {
    "/": { status: 200, body: '<a href="/contact">Contact</a><script src="/_next/static/app.js"></script>' },
    "/_next/static/app.js": { status: 200, type: "text/javascript" },
    "/contact": { status: 200, body: '<form><input type="email" name="email"><textarea></textarea></form><a href="https://calendly.com/hmm">Book</a>' },
    "/blog": { status: 200, body: "<h1>Articles</h1>" },
    "/articles/": { status: 308, location: "/blog" },
    "/sitemap.xml": { status: 200, type: "application/xml" },
  };
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const page = site[url.pathname] ?? { status: 404, body: "Not found" };
    return new Response(page.body ?? "", { status: page.status, headers: { "content-type": page.type ?? "text/html", ...(page.location ? { location: page.location } : {}) } });
  }) as typeof fetch;

  it("checks the form, delivery settings, the booking link, old addresses and crawler files without submitting", async () => {
    const result = await checkPreview("https://preview.example", ["/", "/contact"], ["contact_form", "blog", "booking"], fetcher, { legacyUrls: ["/articles/", "/news/"], settingsSet: ["BOOKING_URL"], bookingUrl: "https://calendly.com/hmm" });
    const by = Object.fromEntries(result.checks.map((check) => [check.check, check]));
    assert.equal(by["Enquiry form works without JavaScript"].status, "fail");
    assert.equal(by["Enquiries delivered"].status, "blocked");
    assert.match(by["Enquiries delivered"].detail, /RESEND_API_KEY, CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL/);
    assert.equal(by["Booking link goes to the scheduler"].status, "pass");
    assert.equal(by["Old address /articles/"].status, "pass");
    assert.match(by["Old address /articles/"].detail, /Redirects \(308\) to \/blog/);
    assert.equal(by["Old address /news/"].status, "fail");
    assert.equal(by["Serves /sitemap.xml"].status, "pass");
    assert.equal(by["Serves /robots.txt"].status, "fail");
    assert.equal(result.passed, false);
  });
});

describe("the preview environment on Vercel", () => {
  const project = { id: "prj_1", name: "harris-marcus", protected: false } as unknown as Parameters<typeof publish.setPreviewEnvironment>[0];

  it("sends every setting as an encrypted preview-only variable", async () => {
    setConnectorEnabled("vercel", true);
    const sent: { url: string; body: unknown }[] = [];
    const deps = {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response("{}", { status: 201 });
      }) as typeof fetch,
      env: () => ({ VERCEL_API_TOKEN: "token" }),
      git: async () => "",
    };
    const names = await publish.setPreviewEnvironment(project, { RESEND_API_KEY: "re_1", CONTACT_TO_EMAIL: "office@example.test" }, deps);
    assert.deepEqual(names, ["RESEND_API_KEY", "CONTACT_TO_EMAIL"]);
    assert.match(sent[0].url, /\/v10\/projects\/prj_1\/env\?upsert=true/);
    assert.deepEqual(sent[0].body, [
      { key: "RESEND_API_KEY", value: "re_1", type: "encrypted", target: ["preview"] },
      { key: "CONTACT_TO_EMAIL", value: "office@example.test", type: "encrypted", target: ["preview"] },
    ]);
  });

  it("names the variables, never their values, when Vercel refuses", async () => {
    setConnectorEnabled("vercel", true);
    const deps = { fetch: (async () => new Response('{"error":{"message":"forbidden"}}', { status: 403 })) as typeof fetch, env: () => ({ VERCEL_API_TOKEN: "token" }), git: async () => "" };
    await assert.rejects(publish.setPreviewEnvironment(project, { RESEND_API_KEY: "re_secret_value" }, deps), (error: Error) => /RESEND_API_KEY/.test(error.message) && !error.message.includes("re_secret_value"));
  });

  it("does nothing when there is nothing to set", async () => {
    assert.deepEqual(await publish.setPreviewEnvironment(project, {}, { fetch: (async () => assert.fail("no call")) as typeof fetch, env: () => ({}), git: async () => "" }), []);
  });
});
