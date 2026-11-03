import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-review-verdict-"));
process.env.AGENTOS_UI_DIR = root;
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const { describeVerdict, mustFixFindings, parseReviewVerdict, tallyFeatures } = await import("../review-verdict");
const { functionsSummary } = await import("../stages");
const { functionsBrief, reviewBrief } = await import("../prompts");
const store = await import("../store");

after(() => {
  store.closeRebuildDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

// The shape of the real Harris Marcus functions r2 review, cut down.
const OLD_STYLE_REVIEW = `# Functions r2 review

**Verdict: not yet ready for the client.** Enquiry data can still enter URLs.

## Blocker

1. **The form can disclose enquiry data in URLs.** File: \`src/components/ContactForm.tsx:26\`. Add a POST fallback.

## Major

1. **No enforced email abuse protection.** Add rate limits.

2. **Contact delivery and booking completion remain unverified.**

3. **Public placeholders remain.**

4. **Existing Articles URLs have no migration.**

## Minor

1. **Crawler assets are incomplete.**

2. **Navigation provides no current-page state.**

## Checks and limits

- **Copy:** fine.
- **Accessibility:** fine.
`;

const NEW_STYLE_REVIEW = `Verdict: Ready. Nothing here would embarrass us, not even the footer.

## Blocker

- None

## Major

- None

## Minor

1. Tighten the hero spacing at 375px.
`;

describe("reading a review", () => {
  it("reads the verdict and counts each severity from an old-style review", () => {
    assert.deepEqual(parseReviewVerdict(OLD_STYLE_REVIEW), { ready: false, blockers: 1, majors: 4, minors: 2 });
  });

  it("reads the new Verdict line, and a reason that says 'not' does not flip it", () => {
    assert.deepEqual(parseReviewVerdict(NEW_STYLE_REVIEW), { ready: true, blockers: 0, majors: 0, minors: 1 });
  });

  it("gives no verdict when the review states none", () => {
    assert.equal(parseReviewVerdict("Looks fine to me.").ready, null);
  });

  it("hands the next revision the Blocker and Major findings only", () => {
    const findings = mustFixFindings(OLD_STYLE_REVIEW) ?? "";
    assert.match(findings, /## Blocker[\s\S]*ContactForm\.tsx:26/);
    assert.match(findings, /## Major[\s\S]*Articles URLs/);
    assert.doesNotMatch(findings, /Crawler assets|Checks and limits/);
    assert.equal(mustFixFindings(NEW_STYLE_REVIEW), undefined);
  });

  it("says the verdict in one sentence", () => {
    assert.equal(describeVerdict(parseReviewVerdict(OLD_STYLE_REVIEW), "Codex"), "Codex review: not ready yet (1 blocker, 4 major, 2 minor).");
  });
});

describe("the functions summary", () => {
  const report = `| Feature | Status: Pass, Fail or Blocked | Journey tested | Evidence |
| --- | --- | --- | --- |
| Contact form | Blocked | Automated | mocked |
| Blog | **Pass** | Automated | tests |
| Bookings | Blocked | Automated | none |

## Checks AgentOS ran itself

| Command | Result |
|---|---|
| \`npm test\` | Pass |
`;

  it("counts only the feature table, not the checks table after it", () => {
    assert.deepEqual(tallyFeatures(report), { pass: 1, fail: 0, blocked: 2 });
  });

  it("no longer claims the features pass when the report says they are blocked", () => {
    const summary = functionsSummary("Codex", 3, tallyFeatures(report), [{ command: "npm test", success: true }], "Codex review: not ready yet (1 blocker).");
    assert.match(summary, /3 features: 1 pass, 2 blocked\./);
    assert.match(summary, /All 1 checks AgentOS ran passed\./);
    assert.match(summary, /not ready yet/);
    assert.doesNotMatch(summary, /build, lint and tests pass/);
  });

  it("names failed checks and a report that rates nothing", () => {
    const summary = functionsSummary("Codex", 1, { pass: 0, fail: 0, blocked: 0 }, [{ command: "npm run build", success: false }]);
    assert.match(summary, /rates none of them/);
    assert.match(summary, /Failed checks: `npm run build`/);
  });
});

describe("briefs", () => {
  const run = {
    company: "Harris Marcus",
    requiredFunctions: ["contact_form", "blog"],
    websiteUrl: "https://example.test",
    targetMarket: "Clients",
    location: "Johannesburg",
    conversionGoal: "Enquire",
  } as unknown as Parameters<typeof functionsBrief>[0];

  it("puts the last review's findings in the next functions brief", () => {
    const brief = functionsBrief(run, "Fix the footer", "## Blocker\n\n1. Form leaks into the URL.");
    assert.match(brief, /Fix the footer/);
    assert.match(brief, /<<<REVIEW\n## Blocker\n\n1\. Form leaks into the URL\.\nREVIEW>>>/);
  });

  it("asks for a form that works without JavaScript and keeps old article URLs", () => {
    const brief = functionsBrief(run);
    assert.match(brief, /method="post"/);
    assert.match(brief, /never reach a URL/);
    assert.match(brief, /permanent redirect/);
    assert.doesNotMatch(brief, /<<<REVIEW/);
  });

  it("asks the reviewer for a verdict line the stage can read", () => {
    assert.match(reviewBrief(run, "functions", 1, "rebuild/functions-r1"), /`Verdict: Ready` or `Verdict: Not ready`/);
  });
});

describe("approving past a reviewer's blockers", () => {
  it("is refused until the person approves anyway", async () => {
    const { run } = store.createOrReuseRun({
      prospectId: "prospect-review",
      company: "Total Electric",
      websiteUrl: "https://total-electric.example",
      targetMarket: "Homeowners",
      location: "Cape Town",
      conversionGoal: "Book a call-out",
      requiredFunctions: ["contact_form"],
      designTemplate: "DESIGN.md",
      skillVersion: "1.0.0",
    });
    // Everything before functions is done, so functions may be claimed.
    store.rebuildDatabase().prepare("UPDATE stages SET status = 'complete', revision = 1, approved_revision = 1 WHERE run_id = ? AND stage NOT IN ('functions', 'preview')").run(run.id);
    assert.equal(store.claimStage(run.id, "functions", "worker-a"), true);
    store.completeStage(run.id, "functions", "worker-a", "functions r1", [], { review: { ready: false, blockers: 1, majors: 4, minors: 2 } });

    assert.deepEqual(store.readRun(run.id).revisions.find((revision) => revision.stage === "functions")?.review, { ready: false, blockers: 1, majors: 4, minors: 2 });
    assert.throws(() => store.decide(run.id, "functions", 1, "approved"), /found 1 blocker in revision 1/);
    store.decide(run.id, "functions", 1, "approved", undefined, undefined, undefined, undefined, true);
    assert.equal(store.readRun(run.id).stages.find((stage) => stage.id === "functions")?.approvedRevision, 1);
  });
});
