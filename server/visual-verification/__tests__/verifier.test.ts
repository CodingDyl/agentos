import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVisualReviewPacket,
  readVisualVerification,
} from "../verifier";

/**
 * The reviewer is a language model, so the thing worth testing is not that it
 * is right — it is that this module never turns something it could not read
 * into a pass. A wrongly-unverifiable job costs a second look; a wrongly-passed
 * one is how a screen nobody checked reaches production.
 */

function reply(payload: unknown): string {
  return `Some prose about the screenshots.\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

describe("reading a visual verdict", () => {
  it("reads a pass with no findings", () => {
    const result = readVisualVerification(
      reply({
        verdict: "PASS",
        summary: "It follows the direction closely.",
        strengths: ["Typography matches the specimen"],
        issues: [],
      }),
    );

    assert.equal(result.verdict, "pass");
    assert.equal(result.summary, "It follows the direction closely.");
    assert.deepEqual(result.strengths, ["Typography matches the specimen"]);
  });

  it("treats a reply it cannot parse as unverifiable, never as a pass", () => {
    const result = readVisualVerification(
      "It looks great to me, ship it. No JSON here.",
    );

    assert.equal(result.verdict, "unverifiable");
    assert.ok(result.unverifiableReason);
  });

  it("does not pass a reply whose verdict word it does not recognise", () => {
    const result = readVisualVerification(
      reply({ verdict: "LOOKS_FINE", summary: "All good." }),
    );

    assert.equal(result.verdict, "unverifiable");
  });

  it("reads `blocked` as unverifiable, since it means the same thing", () => {
    const result = readVisualVerification(
      reply({ verdict: "BLOCKED", summary: "I was not shown the mobile view." }),
    );

    assert.equal(result.verdict, "unverifiable");
    assert.equal(result.unverifiableReason, "I was not shown the mobile view.");
  });

  it("keeps a changes-required reading of unstructured prose", () => {
    const result = readVisualVerification(
      "This needs work. CHANGES REQUIRED: the cards are over-framed.",
    );

    assert.equal(result.verdict, "changes_required");
  });

  it("refuses a pass that also raises a major finding", () => {
    const result = readVisualVerification(
      reply({
        verdict: "PASS",
        summary: "Close enough.",
        issues: [
          {
            severity: "major",
            category: "layout",
            title: "Grid is single-column",
            detail: "The references are all masonry.",
          },
        ],
      }),
    );

    // The findings are the more specific claim, so they win.
    assert.equal(result.verdict, "changes_required");
    assert.match(result.summary, /changes required/i);
  });

  it("lets a pass stand when the only findings are minor", () => {
    const result = readVisualVerification(
      reply({
        verdict: "PASS",
        summary: "Good.",
        issues: [
          {
            severity: "minor",
            category: "spacing",
            title: "Label sits 2px low",
            detail: "Barely visible.",
          },
        ],
      }),
    );

    assert.equal(result.verdict, "pass");
  });

  it("keeps a finding it cannot classify, as a major one", () => {
    const result = readVisualVerification(
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "Some problems.",
        issues: [{ severity: "catastrophic", category: "vibes", title: "Off" }],
      }),
    );

    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].severity, "major");
    assert.equal(result.issues[0].category, "other");
    // A finding with no detail is still a finding; the title carries it.
    assert.equal(result.issues[0].detail, "Off");
  });

  it("only counts a criterion as satisfied when it says so explicitly", () => {
    const result = readVisualVerification(
      reply({
        verdict: "CHANGES_REQUIRED",
        summary: "Partly there.",
        criteria: [
          { criterion: "Masonry grid", satisfied: true },
          { criterion: "Mobile layout", satisfied: "yes" },
          { criterion: "Section labels" },
        ],
      }),
    );

    assert.deepEqual(
      result.criteria.map((entry) => entry.satisfied),
      [true, false, false],
    );
  });

  it("reads the last fenced block, which is the one it asked for", () => {
    const text = [
      "Here is a shape I am not returning:",
      "```json",
      '{ "verdict": "PASS", "summary": "wrong one" }',
      "```",
      "And my actual verdict:",
      "```json",
      '{ "verdict": "CHANGES_REQUIRED", "summary": "right one" }',
      "```",
    ].join("\n");

    const result = readVisualVerification(text);

    assert.equal(result.verdict, "changes_required");
    assert.equal(result.summary, "right one");
  });

  it("keeps the reply as it arrived, because a parse is a reading", () => {
    const text = reply({ verdict: "PASS", summary: "Fine." });

    assert.equal(readVisualVerification(text).raw, text);
  });
});

describe("the packet a visual reviewer is given", () => {
  const context = {
    references: [
      {
        assetId: "asset_1",
        path: "/media/originals/asset_1.png",
        filename: "masonry.png",
        tags: ["grid"],
        notes: undefined,
      },
    ],
    missing: [],
    designBrief: "# Design Library Brief",
    designBriefPath: "projects/agentos/design/BRIEF.md",
    designSystem: "Editorial Terminal",
    designSystemPath: "DESIGN.md",
  };

  const packet = () =>
    buildVisualReviewPacket({
      project: "agentos",
      objective: "Build the design library grid",
      revision: 1,
      acceptanceCriteria: ["Images dominate the grid"],
      screenshots: [
        {
          route: "/designs",
          viewport: "desktop",
          path: "/state/jobs/job_x/visual/r1/designs-desktop.png",
        },
      ],
      context,
      captureFailures: [],
    });

  it("names both sides of the comparison, and which is which", () => {
    const text = packet();

    assert.match(text, /APPROVED REFERENCE DIRECTION/);
    assert.match(text, /IMPLEMENTATION SCREENSHOTS/);
    assert.match(text, /designs-desktop\.png/);
    assert.match(text, /masonry\.png/);
  });

  it("says the references are direction rather than a baseline", () => {
    assert.match(packet(), /not exact mockups/i);
  });

  it("says it is not a code review", () => {
    assert.match(packet(), /not a code review/i);
  });

  it("reports routes it could not capture rather than hiding them", () => {
    const text = buildVisualReviewPacket({
      project: "agentos",
      objective: "Build it",
      revision: 2,
      acceptanceCriteria: [],
      screenshots: [],
      context,
      captureFailures: ["/designs at mobile: the server answered 500."],
    });

    assert.match(text, /COULD NOT BE CAPTURED/);
    assert.match(text, /answered 500/);
    // A revision has to be told it is one, or it cannot check the last round
    // of findings was addressed.
    assert.match(text, /revision 2/i);
  });

  it("says outright when there was no brief, rather than going quiet", () => {
    const text = buildVisualReviewPacket({
      project: "agentos",
      objective: "Build it",
      revision: 1,
      acceptanceCriteria: [],
      screenshots: [],
      context: { ...context, designBrief: undefined, designBriefPath: undefined },
      captureFailures: [],
    });

    assert.match(text, /None was attached/);
  });
});
