import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ART_RULES, generateArt, parseArtPlan } from "../art";
import { COMPOSITIONS, COMPOSITION_BY_ID, NAV_BY_ID, type HeroMetrics } from "../compositions";
import { facesOf, fontId, fontKit, motionKit } from "../concept-kit";
import type { DirectionAssignment } from "../design-fingerprints";
import { DIRECTION_BY_ID } from "../design-directions";
import { MOTION_SIGNATURES } from "../compositions";
import { SAME_HEADLINE, auditReport, detectSlop, headlineOverlap, judgeConcepts, skeletonSimilarity, type MeasuredConcept } from "../hero-audit";
import { deadLinks, parseInventory, placeholderText, sampleValue } from "../interaction-audit";
import { localSiteEnv } from "../screens";

const metrics = (overrides: Partial<HeroMetrics> = {}): HeroMetrics => ({
  viewport: { width: 1440, height: 900 },
  h1: { text: "Sign nothing until we have read it", words: 7, px: 140, family: "anton", rect: { x: 40, y: 100, width: 1300, height: 300 } },
  fonts: { loaded: ["anton", "manrope"], headlineLoaded: true, bodyLoaded: true },
  remoteRequests: [],
  errors: [],
  overflowX: false,
  mediaCoverage: 0,
  media: [],
  canvasCoverage: 0,
  rows: [],
  wideBand: false,
  navLinks: [],
  cta: { x: 40, y: 700, width: 200, height: 60 },
  motionSeen: true,
  headlineCovered: 0,
  skeleton: "tttt\n....",
  ...overrides,
});

const assignment = (concept: DirectionAssignment["concept"], composition: string, nav: string): DirectionAssignment => ({
  concept,
  direction: DIRECTION_BY_ID.get("kinetic-poster")!,
  wildcard: false,
  pair: { display: "Anton", text: "Manrope" },
  composition: COMPOSITION_BY_ID.get(composition)!,
  nav: NAV_BY_ID.get(nav)!,
  motion: MOTION_SIGNATURES[0],
});

const measured = (concept: MeasuredConcept["concept"], desktop: Partial<HeroMetrics> = {}, findings: MeasuredConcept["findings"] = []): MeasuredConcept => ({ concept, desktop: metrics(desktop), mobile: metrics({ viewport: { width: 390, height: 844 } }), findings });

describe("the composition checks", () => {
  const check = (id: string, m: Partial<HeroMetrics>) => COMPOSITION_BY_ID.get(id)!.check(metrics(m));

  it("every composition has real references and a family", () => {
    for (const entry of COMPOSITIONS) {
      assert.ok(entry.references.length > 0, entry.id);
      for (const reference of entry.references) assert.match(reference.url, /^https:\/\//);
    }
    for (const family of ["image", "type", "interaction"]) assert.ok(COMPOSITIONS.filter((entry) => entry.family === family).length >= 3, family);
  });

  it("tells a type monument from a modest headline", () => {
    assert.equal(check("type-monument", {}), undefined);
    assert.match(check("type-monument", { h1: { text: "x", words: 1, px: 64, family: "a", rect: { x: 0, y: 0, width: 1300, height: 80 } } }) ?? "", /64px/);
  });

  it("wants a full-bleed image to fill the screen, with the headline low", () => {
    assert.match(check("full-bleed-lower-third", { mediaCoverage: 0.3 }) ?? "", /30%/);
    assert.match(check("full-bleed-lower-third", { mediaCoverage: 1 }) ?? "", /top half/);
    assert.equal(check("full-bleed-lower-third", { mediaCoverage: 1, h1: { text: "x", words: 1, px: 80, family: "a", rect: { x: 40, y: 650, width: 800, height: 100 } } }), undefined);
  });

  it("needs real rows or a real question for the interactive compositions", () => {
    assert.match(check("index-router", {}) ?? "", /0 rows/);
    const row = (y: number) => ({ x: 0, y, width: 1440, height: 110 });
    assert.equal(check("index-router", { rows: [row(0), row(110), row(220), row(330)] }), undefined);
    assert.match(check("intake-first", {}) ?? "", /data-intake/);
    assert.match(check("intake-first", { intake: { choices: 2, rect: row(0) } }) ?? "", /2 answers/);
    assert.equal(check("intake-first", { intake: { choices: 4, rect: row(0) } }), undefined);
  });

  it("measures an overlap between headline and image", () => {
    const h1 = { text: "x", words: 1, px: 100, family: "a", rect: { x: 100, y: 100, width: 400, height: 200 } };
    assert.match(check("offset-overlap", { h1, media: [{ x: 800, y: 0, width: 500, height: 800, kind: "img" }] }) ?? "", /does not overlap/);
    assert.equal(check("offset-overlap", { h1, media: [{ x: 300, y: 0, width: 900, height: 800, kind: "img" }] }), undefined);
  });

  it("tells a navigation apart by where its links are", () => {
    const nav = (id: string, m: Partial<HeroMetrics>) => NAV_BY_ID.get(id)!.check(metrics(m));
    const top = [0, 1, 2, 3].map((index) => ({ x: 900 + index * 100, y: 30, width: 80, height: 20 }));
    assert.match(nav("corner-menu", { navLinks: top }) ?? "", /more than two links/);
    assert.match(nav("bottom-bar", { navLinks: top }) ?? "", /not along the bottom/);
    assert.match(nav("side-rail", { navLinks: top }) ?? "", /do not run down the side/);
    assert.match(nav("centred-logo", { logo: { x: 40, y: 20, width: 120, height: 40 } }) ?? "", /not centred/);
    assert.equal(nav("stacked-corner", { navLinks: [0, 1, 2].map((index) => ({ x: 40, y: 40 + index * 24, width: 90, height: 20 })) }), undefined);
  });
});

describe("the rendered audit", () => {
  const assignments = [assignment("concept-a", "type-monument", "corner-menu"), assignment("concept-b", "type-monument", "corner-menu")];

  it("measures how alike two heroes occupy the screen", () => {
    assert.equal(skeletonSimilarity("tt..\nmm..", "tt..\nmm.."), 1);
    assert.equal(skeletonSimilarity("tt..\n....", "..tt\n...."), 0);
    assert.equal(skeletonSimilarity("....", "...."), 0);
  });

  it("measures how alike two headlines are, ignoring small words", () => {
    assert.equal(headlineOverlap("Corporate law in Rivonia", "Corporate and commercial law, Rivonia"), 1);
    assert.ok(headlineOverlap("Sign nothing until we have read it", "Your deal, read by the partner doing it") < SAME_HEADLINE);
    assert.equal(headlineOverlap("", "Anything"), 0);
  });

  it("fails what the browser saw: fallback fonts, outside requests, script errors, no call to action, sideways scroll", () => {
    const [audit] = judgeConcepts(
      [
        {
          concept: "concept-a",
          desktop: metrics({ h1: { text: "Hi", words: 1, px: 140, family: "georgia", rect: { x: 0, y: 0, width: 1300, height: 100 } }, fonts: { loaded: [], headlineLoaded: false, bodyLoaded: false }, remoteRequests: ["https://fonts.googleapis.com/x"], errors: ["boom"], cta: undefined }),
          mobile: metrics({ overflowX: true }),
          findings: [],
        },
      ],
      assignments,
    );
    const text = audit.failures.join("\n");
    for (const pattern of [/renders in "georgia"/, /fonts\.googleapis\.com/, /throws: boom/, /data-hero-cta/, /sideways at 390px/]) assert.match(text, pattern);
  });

  it("fails a concept that is not its assigned composition or navigation", () => {
    const [audit] = judgeConcepts([measured("concept-a", { h1: { text: "Small", words: 1, px: 40, family: "anton", rect: { x: 0, y: 0, width: 300, height: 50 } }, navLinks: [0, 1, 2].map((index) => ({ x: 900 + index * 100, y: 20, width: 80, height: 20 })) })], assignments);
    assert.match(audit.failures.join("\n"), /Not the assigned composition \(Type monument\)/);
    assert.match(audit.failures.join("\n"), /Not the assigned navigation \(Corner menu\)/);
  });

  it("turns slop detector findings into failures, and other findings into warnings", () => {
    const [audit] = judgeConcepts([measured("concept-a", {}, [{ id: "hero-eyebrow-chip", name: "Hero eyebrow chip", slop: true, snippet: "" }, { id: "tight-leading", name: "Tight leading", slop: false, snippet: "" }])], assignments);
    assert.match(audit.failures.join("\n"), /Slop detector: Hero eyebrow chip/);
    assert.match(audit.warnings.join("\n"), /Detector: Tight leading/);
  });

  it("fails a headline something else covers, at either width", () => {
    const [desktop] = judgeConcepts([measured("concept-a", { headlineCovered: 0.45 })], assignments);
    assert.match(desktop.failures.join("\n"), /covers 45% of the headline at 1440px/);
    const [phone] = judgeConcepts([{ ...measured("concept-a"), mobile: metrics({ viewport: { width: 390, height: 844 }, headlineCovered: 0.3 }) }], assignments);
    assert.match(phone.failures.join("\n"), /covers 30% of the headline at 390px/);
    assert.deepEqual(judgeConcepts([measured("concept-a", { headlineCovered: 0.1 })], assignments)[0].failures, [], "touching an image on purpose is fine");
  });

  it("trusts the browser over the detector on a headline sized by script, and groups repeated warnings", () => {
    const flat = { id: "flat-type-hierarchy", name: "Flat type hierarchy", slop: true, snippet: "h1 16px" };
    assert.deepEqual(judgeConcepts([measured("concept-a", {}, [flat])], assignments)[0].failures, []);
    assert.match(judgeConcepts([measured("concept-a", { h1: { text: "Small", words: 1, px: 18, family: "anton", rect: { x: 0, y: 0, width: 1300, height: 20 } } }, [flat])], [])[0].failures.join("\n"), /Flat type hierarchy/);
    const cramped = { id: "cramped-padding", name: "Cramped padding", slop: false, snippet: "<li>" };
    assert.deepEqual(judgeConcepts([measured("concept-a", {}, [cramped, cramped, cramped])], assignments)[0].warnings, ["Detector: Cramped padding (3 places), such as <li>."]);
  });

  it("fails the second of two concepts with the same skeleton or headline, once", () => {
    const skeleton = "tttt\nmmmm";
    const [a, b] = judgeConcepts([measured("concept-a", { skeleton }), measured("concept-b", { skeleton })], assignments);
    assert.deepEqual(a.failures, []);
    assert.match(b.failures.join("\n"), /same page layout as concept-a/);
    assert.match(b.failures.join("\n"), /same headline angle as concept-a/);
  });

  it("fails a concept that repeats an earlier run's skeleton", () => {
    const [audit] = judgeConcepts([measured("concept-a", { skeleton: "tttt\nmmmm" })], assignments, [{ skeleton: "tttt\nmmmm", runId: "old", concept: "concept-b" }]);
    assert.match(audit.failures.join("\n"), /earlier concept in this niche/);
  });

  it("reports a hero that would not open, and writes a readable report", () => {
    const audits = judgeConcepts([{ concept: "concept-a", findings: [], error: "net::ERR_FILE_NOT_FOUND" }], assignments);
    assert.match(audits[0].failures[0], /could not be opened/);
    assert.match(auditReport(audits), /## concept-a[\s\S]*ERR_FILE_NOT_FOUND/);
  });

  it("runs Impeccable's detector on a real file, without a model", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-detect-"));
    const file = path.join(dir, "hero.html");
    fs.writeFileSync(file, '<!doctype html><html><head><style>body{background:#f1e9d8}</style></head><body><main><span class="eyebrow">BOUTIQUE LAW FIRM</span><h1>Hello</h1></main></body></html>');
    const findings = await detectSlop(file);
    assert.ok(findings.some((finding) => finding.id === "cream-palette" && finding.slop), JSON.stringify(findings));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the concept kit", () => {
  it("prefers a variable weight axis, and otherwise keeps the weights a design needs", () => {
    assert.equal(fontId("Bodoni Moda"), "bodoni-moda");
    const variable = facesOf("bodoni-moda", { variable: true, styles: ["normal", "italic"] }, { wght: { min: "400", max: "900" } });
    assert.deepEqual(variable.map((face) => [face.style, face.weight]), [["normal", "400 900"], ["italic", "400 900"]]);
    const stat = facesOf("gilda-display", { variable: false, weights: [400], styles: ["normal"], variants: { "400": { normal: { latin: { url: { woff2: "https://x/gilda.woff2" } } } } } });
    assert.deepEqual(stat.map((face) => face.url), ["https://x/gilda.woff2"]);
  });

  it("downloads fonts with open licences only, writes font-face rules, and says what it could not fetch", async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-fonts-"));
    const fetcher = (async (url: string) => {
      if (url.endsWith("/fonts/gilda-display")) return new Response(JSON.stringify({ license: "OFL-1.1", variable: false, weights: [400], styles: ["normal"], variants: { "400": { normal: { latin: { url: { woff2: "https://cdn.example/gilda.woff2" } } } } } }));
      if (url.endsWith("/fonts/paid-face")) return new Response(JSON.stringify({ license: "Commercial", variable: false, weights: [400], styles: ["normal"] }));
      if (url === "https://cdn.example/gilda.woff2") return new Response(new Uint8Array([1, 2, 3]));
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const kit = await fontKit(["Gilda Display", "Paid Face", "No Such Font"], fetcher, cache);
    assert.deepEqual(kit.missing, ["Paid Face", "No Such Font"]);
    assert.deepEqual(Object.keys(kit.files), ["design/kit/fonts/gilda-display/gilda-display-400-normal.woff2"]);
    assert.match(kit.css, /font-family: "Gilda Display"; src: url\("\.\.\/kit\/fonts\/gilda-display\/gilda-display-400-normal\.woff2"\)/);
    // A second run is served from the cache.
    const again = await fontKit(["Gilda Display"], (async (url: string) => (url.includes("cdn.example") ? new Response("", { status: 500 }) : fetcher(url))) as unknown as typeof fetch, cache);
    assert.deepEqual(again.missing, []);
    fs.rmSync(cache, { recursive: true, force: true });
  });

  it("ships the pinned motion libraries", async () => {
    const files = await motionKit();
    assert.deepEqual(Object.keys(files).sort(), ["design/kit/motion/ScrollTrigger.min.js", "design/kit/motion/SplitText.min.js", "design/kit/motion/gsap.min.js", "design/kit/motion/lenis.min.js"]);
    for (const data of Object.values(files)) assert.ok(data.length > 1000);
  });
});

describe("concept imagery", () => {
  const plan = parseArtPlan(JSON.stringify({ images: [1, 2, 3].map((index) => ({ concept: "concept-a", name: `art-${index}`, prompt: "A slab of aged bronze under one low light", aspect: "16:9" })) }))!;

  it("rejects a malformed plan, and caps each concept at three images", () => {
    assert.equal(parseArtPlan("not json"), undefined);
    assert.equal(parseArtPlan(undefined), undefined);
    assert.equal(parseArtPlan(JSON.stringify({ images: [{ concept: "concept-z", name: "x", prompt: "y" }] })), undefined);
    assert.equal(parseArtPlan(JSON.stringify({ images: [{ concept: "concept-a", name: "../escape", prompt: "A slab of aged bronze under light" }] })), undefined);
    const many = parseArtPlan(JSON.stringify({ images: [1, 2, 3, 4, 5].map((index) => ({ concept: "concept-a", name: `art-${index}`, prompt: "A slab of aged bronze under one low light" })) }))!;
    assert.equal(many.images.length, 3);
  });

  it("prices each image first, adds the standing rules, and stops at the budget", async () => {
    const prompts: string[] = [];
    const result = await generateArt(plan, 0.5, { price: async () => 0.25, generate: async (prompt) => { prompts.push(prompt); return Buffer.from("png"); } });
    assert.equal(result.spent, 0.5);
    assert.equal(Object.keys(result.files).length, 2);
    assert.match(result.notes[0], /skipped, 0\.25 credits would pass the budget of 0\.5/);
    for (const prompt of prompts) assert.ok(prompt.endsWith(ART_RULES));
    assert.match(result.ledger, /concept-a,design\/concept-a\/art\/art-1\.png,gpt_image_2_5,0\.25/);
  });

  it("spends nothing on an image it cannot price, or one that fails", async () => {
    const unpriced = await generateArt(plan, 5, { price: async () => undefined, generate: async () => Buffer.from("png") });
    assert.equal(unpriced.spent, 0);
    assert.equal(unpriced.notes.length, 3);
    const failing = await generateArt(plan, 5, { price: async () => 0.25, generate: async () => { throw new Error("plan refused"); } });
    assert.equal(failing.spent, 0);
    assert.match(failing.notes[0], /plan refused/);
  });
});

describe("the interaction audit's helpers", () => {
  it("spots links that go nowhere", () => {
    assert.deepEqual(deadLinks(["/contact", "#", "", "javascript:void(0)", "#section", "https://x.example"]), ["#", ""]);
  });

  it("spots placeholder text but not ordinary words", () => {
    assert.equal(placeholderText("Our office hours are 8 to 5"), undefined);
    assert.equal(placeholderText("Bookings: Coming soon"), "Coming soon");
    assert.equal(placeholderText("Call [office hours]"), "[office hours]");
  });

  it("fills a form with values its fields will accept", () => {
    assert.equal(sampleValue({ type: "email", name: "x", label: "" }), "sample.visitor@example.com");
    assert.equal(sampleValue({ type: "text", name: "phone", label: "" }), "021 555 0142");
    assert.equal(sampleValue({ type: "text", name: "fullName", label: "" }), "Sample Visitor");
    assert.match(sampleValue({ type: "date", name: "", label: "" }), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads the component inventory, and refuses a bad one", () => {
    assert.deepEqual(parseInventory('[{"name":"Finder","route":"/","selector":"[data-component=\\"f\\"]","mode":"demo","env":[]}]')?.map((entry) => entry.name), ["Finder"]);
    assert.equal(parseInventory('[{"name":"Finder"}]'), undefined);
    assert.equal(parseInventory("nope"), undefined);
    assert.equal(parseInventory(undefined), undefined);
  });

  it("runs a local copy of a client's site with none of AgentOS's keys", () => {
    const env = localSiteEnv({ PATH: "/bin", HOME: "/home/x", RESEND_API_KEY: "a", ANTHROPIC_API_KEY: "b", GITHUB_TOKEN: "c", VERCEL_TOKEN: "d", VERCEL_ENV: "production", CONTACT_TO_EMAIL: "e@example.com", SOME_SECRET: "f" });
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"]);
  });
});
