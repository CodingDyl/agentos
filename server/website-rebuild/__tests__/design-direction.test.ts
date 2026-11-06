import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-design-direction-"));
process.env.AGENTOS_UI_DIR = path.join(root, "ui");

const store = await import("../store");
const directions = await import("../design-directions");
const fingerprints = await import("../design-fingerprints");
const prompts = await import("../prompts");
const { tallyFeatures } = await import("../review-verdict");
const { functionsSummary } = await import("../stages");
const { checkPreview, cardFields, isDemo } = await import("../qa");
type RebuildRun = import("../../../shared/website-rebuild-types").RebuildRun;
type DesignFingerprint = import("../design-fingerprints").DesignFingerprint;

const { DESIGN_DIRECTIONS, DIRECTION_BY_ID, NICHE_CLICHES, GENERAL_NICHE, ANTI_PATTERNS, detectNiche } = directions;
const { assignDirections, ensureAssignments, priorFingerprints, runFingerprints, recordMade, recordCritique, parseFingerprint, parseCritique, gateConcepts, marketKey } = fingerprints;

let caseNumber = 0;
beforeEach(() => {
  store.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${caseNumber}-`));
});
after(() => {
  store.closeRebuildDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

const law = NICHE_CLICHES.find((niche) => niche.id === "law")!;

function newRun(overrides: { prospect?: string; company?: string; targetMarket?: string; functions?: RebuildRun["requiredFunctions"] } = {}): RebuildRun {
  return store.createOrReuseRun({
    prospectId: overrides.prospect ?? `p-${caseNumber}-${Math.random()}`,
    company: overrides.company ?? "Harris Marcus Attorneys",
    websiteUrl: "https://harris.example",
    targetMarket: overrides.targetMarket ?? "Families needing a conveyancing attorney",
    location: "Sandton",
    conversionGoal: "Book a consultation",
    requiredFunctions: overrides.functions ?? ["contact_form"],
    designTemplate: "DESIGN.md",
    skillVersion: "1.7.0",
  }).run;
}

const fingerprint = (direction: string, extra: Partial<DesignFingerprint> = {}): DesignFingerprint => ({
  runId: "earlier",
  concept: "concept-a",
  niche: "law",
  market: "x",
  direction,
  wildcard: false,
  paletteFamily: DIRECTION_BY_ID.get(direction)!.palette.family,
  palette: [],
  autoRevised: false,
  escalated: false,
  ...extra,
});

describe("the direction library", () => {
  it("has at least twelve distinct directions, each with type, colour, layout, imagery and a reference outside web templates", () => {
    assert.ok(DESIGN_DIRECTIONS.length >= 12);
    assert.equal(new Set(DESIGN_DIRECTIONS.map((entry) => entry.id)).size, DESIGN_DIRECTIONS.length);
    assert.equal(new Set(DESIGN_DIRECTIONS.map((entry) => `${entry.type.display}|${entry.type.text}`)).size, DESIGN_DIRECTIONS.length, "every direction has its own font pair");
    assert.equal(new Set(DESIGN_DIRECTIONS.map((entry) => entry.palette.family)).size, DESIGN_DIRECTIONS.length, "every direction has its own palette family");
    for (const entry of DESIGN_DIRECTIONS) {
      assert.ok(entry.reference && entry.layout && entry.imagery && entry.type.logic && entry.palette.logic, entry.id);
      assert.doesNotMatch(`${entry.type.display} ${entry.type.text}`, /\b(Inter|Roboto|Arial|Poppins|Montserrat|Open Sans)\b/, `${entry.id} uses a banned default face`);
    }
  });

  it("maps the seven niches, and every wildcard is a real direction", () => {
    for (const id of ["law", "plumbing", "electrical", "dental", "accounting", "auto", "restaurant"]) assert.ok(NICHE_CLICHES.some((niche) => niche.id === id), id);
    for (const niche of [...NICHE_CLICHES, GENERAL_NICHE]) {
      assert.ok(niche.cliches.length >= 3, niche.id);
      for (const wildcard of niche.wildcards) assert.ok(DIRECTION_BY_ID.has(wildcard), `${niche.id}: ${wildcard}`);
    }
  });

  it("bans the usual slop, including the icon plus three cards grid and vague copy", () => {
    const all = ANTI_PATTERNS.map((entry) => entry.rule).join("\n");
    for (const pattern of [/Inter/, /gradient/i, /three cards/i, /[Ss]tock-photo/, /[Ee]moji/, /Your trusted partner/, /[Cc]ards inside cards/]) assert.match(all, pattern);
  });

  it("matches the skill's reference files, which are generated from this data", () => {
    const skill = path.resolve(import.meta.dirname, "../../../skills/website-design-direction");
    const read = (file: string) => fs.readFileSync(path.join(skill, file), "utf8");
    assert.match(read("SKILL.md"), /^---\nname: website-design-direction\n/);
    for (const entry of DESIGN_DIRECTIONS) assert.ok(read("references/directions.md").includes(`## ${entry.name} (\`${entry.id}\`)`), entry.id);
    for (const niche of NICHE_CLICHES) assert.ok(read("references/niche-cliches.md").includes(`(\`${niche.id}\`)`), niche.id);
    for (const pattern of ANTI_PATTERNS) assert.ok(read("references/anti-patterns.md").includes(pattern.rule), pattern.rule);
    for (const criterion of directions.CRITIQUE_RUBRIC) assert.ok(read("references/rubric.md").includes(criterion.five), criterion.id);
    assert.match(read("references/rubric.md"), /\*\*28 passes\.\*\*/);
  });

  it("finds the niche from the target market first, then the company name", () => {
    assert.equal(detectNiche({ targetMarket: "Homeowners", company: "Total Electric" }).id, "electrical");
    assert.equal(detectNiche({ targetMarket: "People buying a house who need a conveyancer", company: "Smith Inc" }).id, "law");
    assert.equal(detectNiche({ targetMarket: "Families with kids' teeth to fix", company: "Bright Electric" }).id, "dental");
    assert.equal(detectNiche({ targetMarket: "Pet owners", company: "Paws" }).id, "general");
  });
});

describe("direction assignment", () => {
  it("is deterministic from the run id, gives three different directions, and always makes concept C a wildcard", () => {
    const first = assignDirections("run-123", law, []);
    assert.deepEqual(first.map((entry) => entry.direction.id), assignDirections("run-123", law, []).map((entry) => entry.direction.id));
    assert.equal(new Set(first.map((entry) => entry.direction.id)).size, 3);
    assert.deepEqual(first.map((entry) => entry.concept), ["concept-a", "concept-b", "concept-c"]);
    assert.equal(first[2].wildcard, true);
    assert.ok(law.wildcards.includes(first[2].direction.id));
    // Other runs get other picks: over many ids the library is used, not one favourite.
    const used = new Set(Array.from({ length: 40 }, (_, index) => assignDirections(`run-${index}`, law, []).map((entry) => entry.direction.id)).flat());
    assert.ok(used.size >= 10, `only ${used.size} directions used`);
  });

  it("excludes directions, font pairs and palette families earlier runs in the niche used, while unused ones remain", () => {
    const earlier = assignDirections("run-1", law, []);
    const prior = earlier.map((entry) => fingerprint(entry.direction.id, { concept: entry.concept }));
    const next = assignDirections("run-2", law, prior);
    for (const entry of next) {
      assert.ok(!prior.some((old) => old.direction === entry.direction.id), `${entry.direction.id} was used before`);
      assert.ok(!prior.some((old) => old.paletteFamily === entry.direction.palette.family));
    }
    // A font pair the worker actually used counts even under another direction's name.
    const swiss = DIRECTION_BY_ID.get("swiss-grid")!;
    const withFonts = [fingerprint("editorial-broadsheet", { displayFont: swiss.type.display, textFont: swiss.type.text })];
    for (let index = 0; index < 20; index += 1) assert.ok(!assignDirections(`r-${index}`, law, withFonts).some((entry) => entry.direction.id === "swiss-grid"));
  });

  it("still gives a wildcard and three directions when every direction has been used, least used first", () => {
    const prior = DESIGN_DIRECTIONS.flatMap((entry) => [fingerprint(entry.id), ...(entry.id === "magazine-collage" ? [] : [fingerprint(entry.id)])]);
    const next = assignDirections("run-many", law, prior);
    assert.equal(new Set(next.map((entry) => entry.direction.id)).size, 3);
    assert.equal(next[2].direction.id, "magazine-collage", "the least-used wildcard is chosen");
  });
});

describe("the fingerprint store", () => {
  it("records a run's assignment once, keeps it on retry, and shows it on the run", () => {
    const run = newRun();
    const niche = detectNiche(run);
    const first = ensureAssignments(run, niche);
    assert.deepEqual(ensureAssignments(run, niche).map((entry) => entry.direction.id), first.map((entry) => entry.direction.id));
    const view = store.readRun(run.id).designConcepts;
    assert.deepEqual(view.map((entry) => entry.concept), ["concept-a", "concept-b", "concept-c"]);
    assert.equal(view[2].wildcard, true);
    assert.equal(view[0].directionName, first[0].direction.name);
    assert.equal(view[0].score, undefined);
  });

  it("excludes earlier runs in the same niche or the same market, never the run itself", () => {
    const one = newRun();
    const oneDirections = ensureAssignments(one, law).map((entry) => entry.direction.id);
    const two = newRun({ company: "Mokoena Legal", targetMarket: "Businesses needing a litigation attorney" });
    const twoDirections = ensureAssignments(two, detectNiche(two)).map((entry) => entry.direction.id);
    assert.equal(twoDirections.filter((id) => oneDirections.includes(id)).length, 0, "a second law firm gets none of the first's directions");
    assert.equal(priorFingerprints(two.id, "law", two.targetMarket).length, 3);
    assert.equal(priorFingerprints(one.id, "law", one.targetMarket).length, 3);
    // An unknown niche only shares with the same market.
    const pets = newRun({ company: "Paws", targetMarket: "Pet owners" });
    ensureAssignments(pets, GENERAL_NICHE);
    assert.equal(priorFingerprints("someone-else", "general", "pet  owners!").length, 3);
    assert.equal(priorFingerprints("someone-else", "general", "Horse owners").length, 0);
    assert.equal(marketKey("Pet Owners!"), "pet owners");
  });

  it("stores what the worker made and the critique's score, and forgets them with the run", () => {
    const run = newRun();
    ensureAssignments(run, law);
    const made = parseFingerprint("# Concept\nTokens #ffffff\n<!-- agentos-fingerprint\ndirection: swiss-grid\ndisplay-font: \"Schibsted Grotesk\"\ntext-font: Schibsted Grotesk\npalette: #FFFFFF, #0a0a0a, #FF4F00\nhero-layout: grid-asymmetric\n-->");
    assert.deepEqual(made, { direction: "swiss-grid", displayFont: "Schibsted Grotesk", textFont: "Schibsted Grotesk", palette: ["#FFFFFF", "#0A0A0A", "#FF4F00"], heroLayout: "grid-asymmetric" });
    assert.deepEqual(parseFingerprint("No block, colours #123456 and #abcdef").palette, ["#123456", "#ABCDEF"]);
    recordMade(run.id, "concept-a", made);
    recordCritique(run.id, "concept-a", { score: 24, passed: false, autoRevised: true, escalated: true, reason: "scored 24/40, below 28" });
    const stored = runFingerprints(run.id)[0];
    assert.equal(stored.displayFont, "Schibsted Grotesk");
    assert.deepEqual(stored.palette, ["#FFFFFF", "#0A0A0A", "#FF4F00"]);
    const view = store.readRun(run.id).designConcepts[0];
    assert.deepEqual([view.score, view.passed, view.autoRevised, view.escalated], [24, false, true, true]);
    store.deleteRunRecords(run.id);
    assert.equal(runFingerprints(run.id).length, 0);
  });
});

describe("the critique gate", () => {
  const critique = (scores: (number | undefined)[]) =>
    parseCritique(scores.map((score, index) => `## concept-${"abc"[index]}\nDirection: x\n${score === undefined ? "" : `Score: ${score}/40`}\nSlop: centred hero\nFix: commit harder`).join("\n\n"));
  const made = [
    { concept: "concept-a" as const, direction: "swiss-grid" },
    { concept: "concept-b" as const, direction: "botanical" },
    { concept: "concept-c" as const, direction: "risograph-zine" },
  ];

  it("reads one score per concept from the critique file", () => {
    const parsed = parseCritique("# Critique\n\n## concept-a\nScore: **31/40**\nSlop: None\n\n## concept-b\nScore: 22 / 40\n\n## concept-c\nno score here");
    assert.deepEqual(parsed.map((entry) => entry.score), [31, 22, undefined]);
    assert.match(parsed[0].notes, /Slop: None/);
    assert.doesNotMatch(parsed[0].notes, /concept-b/);
  });

  it("passes concepts at or above 28 and sends the rest back once", () => {
    const results = gateConcepts({ critiques: critique([28, 27, 35]), made, prior: [], attempt: 0 });
    assert.deepEqual(results.map((entry) => entry.action), ["pass", "revise", "pass"]);
    assert.match(results[1].reason ?? "", /27\/40, below 28/);
  });

  it("escalates to the person after the one revision, with the score kept", () => {
    const results = gateConcepts({ critiques: critique([20, 30, 30]), made, prior: [], attempt: 1 });
    assert.deepEqual(results.map((entry) => entry.action), ["escalate", "pass", "pass"]);
    assert.equal(results[0].score, 20);
  });

  it("sends back a concept that repeats an earlier run's direction and font pair, however well it scored", () => {
    const prior = [fingerprint("botanical", { niche: "law" })];
    const results = gateConcepts({ critiques: critique([30, 38, 30]), made, prior, attempt: 0 });
    assert.equal(results[1].action, "revise");
    assert.match(results[1].reason ?? "", /repeats an earlier law run \(Botanical/);
    // Same direction with different fonts is not a repeat.
    const other = gateConcepts({ critiques: critique([30, 38, 30]), made: [made[0], { ...made[1], displayFont: "Literata", textFont: "Karla" }, made[2]], prior, attempt: 0 });
    assert.equal(other[1].action, "pass");
  });

  it("hands an unscored concept to the person rather than looping", () => {
    assert.equal(gateConcepts({ critiques: critique([30, undefined, 30]), made, prior: [], attempt: 0 })[1].action, "escalate");
  });
});

describe("the briefs", () => {
  const design = () => {
    const run = newRun();
    const niche = detectNiche(run);
    return { run, design: { niche, assignments: assignDirections(run.id, niche, []), prior: [fingerprint("cinematic-dark", { displayFont: "Bodoni Moda", textFont: "Red Hat Text", palette: ["#0D0C0B", "#EDE6DA"] })] } };
  };

  it("hero: each concept's direction, the wildcard, the niche's clichés, earlier runs' fonts and colours, the anti-patterns and the fingerprint block", () => {
    const { run, design: input } = design();
    const brief = prompts.heroBrief(run, undefined, input);
    for (const assignment of input.assignments) assert.ok(brief.includes(`${assignment.concept}: ${assignment.direction.name} (${assignment.direction.id})`), assignment.concept);
    assert.match(brief, /concept-c: .*the wildcard/);
    assert.match(brief, /navy and gold/);
    assert.match(brief, /Font pairs: Bodoni Moda \+ Red Hat Text/);
    assert.match(brief, /Dominant colours: #0D0C0B, #EDE6DA/);
    assert.match(brief, /icon plus three cards/);
    assert.match(brief, /<!-- agentos-fingerprint/);
    assert.match(brief, /below 28/);
    // Without design inputs the brief is unchanged in shape.
    assert.doesNotMatch(prompts.heroBrief(run), /agentos-fingerprint/);
  });

  it("critique and revision: the rubric, the output format, and only the failing concepts", () => {
    const { run, design: input } = design();
    const critique = prompts.critiqueBrief(run, input, prompts.critiqueFile(1, 1));
    assert.match(critique, /reviews\/hero-critique-r1\.md/);
    assert.match(critique, /Score: <total>\/40/);
    assert.match(critique, /Escapes the niche default/);
    assert.match(critique, /safe, competent, average concept is a fail/);
    const revision = prompts.heroRevisionBrief(run, input, [{ concept: "concept-b", reason: "scored 20/40, below 28", notes: "Slop: centred hero" }]);
    assert.match(revision, /^Revise concept-b/);
    assert.match(revision, /Do not touch concept-a or concept-c/);
    assert.match(revision, /Slop: centred hero/);
    assert.ok(revision.includes(input.assignments[1].direction.name));
    assert.ok(!revision.includes(`- concept-a: ${input.assignments[0].direction.name}`));
  });

  it("build: the approved direction on every page, with the anti-patterns; the build review scores the rubric", () => {
    const { run } = design();
    const direction = DIRECTION_BY_ID.get("technical-spec-sheet");
    const brief = prompts.buildBrief(run, "concept-b", undefined, undefined, direction);
    assert.match(brief, /Technical spec sheet \(technical-spec-sheet\)/);
    assert.match(brief, /every page, not just the hero/);
    assert.match(brief, /Never do any of these/);
    const review = prompts.reviewBrief(run, "build", 1, "rebuild/build-r1", direction);
    assert.match(review, /Design score: <total>\/40/);
    assert.doesNotMatch(prompts.reviewBrief(run, "functions", 1, "rebuild/functions-r1"), /Design score/);
    assert.equal(prompts.parseDesignScore("Verdict: Ready\nGood.\nDesign score: **26/40**"), 26);
    assert.equal(prompts.parseDesignScore("Verdict: Ready"), undefined);
  });

  it("functions: every selected feature built with a mock and a live adapter, demo mode rules, and no coming-soon path", () => {
    const run = newRun({ functions: ["contact_form", "blog", "booking", "newsletter", "ecommerce"] });
    const brief = prompts.functionsBrief(run);
    assert.doesNotMatch(brief, /shop: do not build|mark it Blocked|fail visibly|Do not build a booking engine/i);
    assert.equal(brief.match(/coming soon/gi)?.length, 1, "only the rule against it");
    assert.match(brief, /none is left out or marked coming soon/);
    assert.match(brief, /`mock` implementation and a `live` one/);
    assert.match(brief, /VERCEL_ENV !== \\"production\\"|VERCEL_ENV !== "production"/);
    assert.match(brief, /DEMO_MODE=true/);
    assert.match(brief, /production deployment without credentials never fakes success/);
    assert.ok(brief.includes(`"${prompts.DEMO_BADGE}"`));
    assert.match(brief, /\/admin\/demo-inbox/);
    assert.match(brief, /noindex/);
    assert.match(brief, /never in the sitemap/);
    assert.match(brief, /calendar of the coming weeks/);
    assert.match(brief, /Payments connect at launch \(e\.g\. Yoco, PayFast, Shopify\)/);
    assert.match(brief, /no card, bank or payment fields anywhere/i);
    assert.match(brief, /ZAR/);
    assert.match(brief, /555/);
    assert.match(brief, /Never real people's names/);
    assert.match(brief, /lib\/demo\//);
    assert.match(brief, /FUNCTIONALITY\.md/);
    assert.match(brief, /\| Online shop \| Demo, Live or Not configured \| SHOP_PROVIDER, SHOP_API_KEY \|/);
    assert.match(brief, /\| Blog \| Demo, Live or Not configured \| None \|/);
    assert.match(brief, /Mode Demo, Status Pass/);
    assert.match(brief, /honeypot/);
    assert.match(brief, /no GET submission/);
    // Only the selected features are briefed.
    assert.doesNotMatch(prompts.functionsBrief(newRun({ functions: ["contact_form"] })), /Online shop|demo storefront/);
  });
});

describe("demo mode in the functions summary and QA", () => {
  it("counts a feature working in demo mode as a pass", () => {
    const report = "| Feature | Mode | Status | Journey |\n|---|---|---|---|\n| Contact form | Demo | Pass | yes |\n| Shop | Demo | **Pass** | yes |\n| Blog | Live | Pass | yes |\n| Newsletter | Demo | Demo | yes |";
    const tally = tallyFeatures(report);
    assert.deepEqual(tally, { pass: 4, fail: 0, blocked: 0, demo: 3 });
    const summary = functionsSummary("Codex", 4, tally, [{ command: "npm test", success: true }]);
    assert.match(summary, /4 features: 4 pass \(3 in demo mode on sample data\)\./);
    assert.doesNotMatch(summary, /blocked/);
    assert.match(functionsSummary("Codex", 1, { pass: 1, fail: 0, blocked: 0, demo: 1 }, []), /1 pass \(working in demo mode on sample data\)/);
  });

  const site = (pages: Record<string, { status: number; body?: string; type?: string }>) =>
    (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const page = pages[url.pathname] ?? { status: 404, body: "Not found" };
      return new Response(page.body ?? "", { status: page.status, headers: { "content-type": page.type ?? "text/html" } });
    }) as typeof fetch;
  const home = '<script src="/_next/static/app.js"></script><footer>This is a demo site.</footer>';
  const badge = `<span data-demo="true">${prompts.DEMO_BADGE}</span>`;
  const demoSite = {
    "/": { status: 200, body: home },
    "/_next/static/app.js": { status: 200, type: "text/javascript" },
    "/contact": { status: 200, body: `<div data-demo="true">${badge}<form method="post" action="/contact"><input type="email" name="email"><textarea name="message"></textarea></form></div>` },
    "/book": { status: 200, body: `<section data-demo="true">${badge}<h1>Book a consultation</h1><button>Book</button></section>` },
    "/shop": { status: 200, body: `<section data-demo="true">${badge}<button disabled>Payments connect at launch (e.g. Yoco, PayFast, Shopify)</button></section>` },
    "/admin/demo-inbox": { status: 200, body: '<meta name="robots" content="noindex, nofollow"><h1>Demo inbox</h1>' },
    "/sitemap.xml": { status: 200, body: "<urlset><url><loc>/</loc></url></urlset>", type: "application/xml" },
    "/robots.txt": { status: 200, type: "text/plain" },
  };

  it("passes a preview whose unconfigured features run in demo mode, marked as demo", async () => {
    const result = await checkPreview("https://p.example", ["/", "/contact", "/book"], ["contact_form", "booking", "ecommerce", "newsletter"], site(demoSite), { legacyUrls: [], settingsSet: [] });
    const by = Object.fromEntries(result.checks.map((check) => [check.check, check]));
    assert.equal(by["Enquiries delivered"].status, "pass");
    assert.match(by["Enquiries delivered"].detail, /Demo mode/);
    assert.equal(by["Booking works on sample availability"].status, "pass");
    assert.equal(by["Shop loads"].status, "pass");
    assert.equal(by["Demo inbox hidden from search"].status, "pass");
    assert.equal(by["No card fields"].status, "pass");
    assert.equal(result.passed, true, JSON.stringify(result.checks.filter((check) => check.status === "fail")));
  });

  it("fails card fields anywhere, an indexable demo inbox and demo routes in the sitemap", async () => {
    const result = await checkPreview("https://p.example", ["/", "/contact"], ["contact_form", "ecommerce"], site({
      ...demoSite,
      "/shop": { status: 200, body: `${badge}<input autocomplete="cc-number" name="number">` },
      "/admin/demo-inbox": { status: 200, body: "<h1>Demo inbox</h1>" },
      "/sitemap.xml": { status: 200, body: "<loc>/admin/demo-inbox</loc>", type: "application/xml" },
    }), { legacyUrls: [], settingsSet: [] });
    const by = Object.fromEntries(result.checks.map((check) => [check.check, check]));
    assert.equal(by["No card fields"].status, "fail");
    assert.equal(by["Demo inbox hidden from search"].status, "fail");
    assert.equal(by["Sitemap has no demo routes"].status, "fail");
    assert.equal(result.passed, false);
    assert.deepEqual(cardFields('<input name="cvv"><input name="email">'), ['<input name="cvv">']);
    assert.equal(isDemo("<p>live</p>"), false);
  });
});
