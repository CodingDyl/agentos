import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changedFileCount, readProposal } from "../proposal";

/**
 * Reading a proposal must be conservative in both directions: it should find
 * the section whatever markdown Hermes wraps it in, and it must never turn
 * ordinary prose into a proposal the operator is then asked to approve.
 */

const PROPOSAL = `I've reviewed Pantry Pilot.

## Proposed changes

TASKS.md
- Complete "Implement fallback generation"
- Add "Test AI fallback"

STATUS.md
- Update current milestone

DECISIONS.md
- No change
`;

describe("finding a proposal", () => {
  it("reads the files and their changes", () => {
    const proposal = readProposal(PROPOSAL);

    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      ["TASKS.md", "STATUS.md", "DECISIONS.md"],
    );
    assert.deepEqual(
      proposal?.files[0].changes.map((change) => change.text),
      ['Complete "Implement fallback generation"', 'Add "Test AI fallback"'],
    );
  });

  it("keeps Hermes' reasoning as the preamble", () => {
    assert.equal(readProposal(PROPOSAL)?.preamble, "I've reviewed Pantry Pilot.");
  });

  it("records a file Hermes says it will not touch", () => {
    const proposal = readProposal(PROPOSAL);
    const decisions = proposal?.files.find((f) => f.file === "DECISIONS.md");

    assert.equal(decisions?.unchanged, true);
    assert.equal(decisions?.changes.length, 0);
  });

  it("counts only the files that actually change", () => {
    assert.equal(changedFileCount(readProposal(PROPOSAL)!), 2);
  });

  it("reads the headings the mutation skills actually emit", () => {
    // Straight from the Hermes skills: `project-update`, `portfolio-update`
    // and `stop-work` each name what they are changing in the heading.
    for (const heading of [
      "# Proposed AgentOS Update",
      "# Proposed Portfolio Update",
      "## Proposed AgentOS Updates",
    ]) {
      assert.ok(
        readProposal(`${heading}\n\n**TASKS.md**\n- Mark a task complete`),
        `did not read: ${heading}`,
      );
    }
  });

  it("reads a bold file heading, as the skills write them", () => {
    const proposal = readProposal(
      "# Proposed AgentOS Update\n\n**TASKS.md**\n- Mark a task complete\n\n**DECISIONS.md**\n- None",
    );

    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      ["TASKS.md", "DECISIONS.md"],
    );
    assert.equal(proposal?.files[1].unchanged, true);
  });

  it("accepts the heading however it is decorated", () => {
    for (const heading of [
      "PROPOSED CHANGES",
      "## Proposed Update",
      "**Proposed changes:**",
      "### PROPOSED UPDATES",
    ]) {
      assert.ok(
        readProposal(`${heading}\n\nTASKS.md\n- Do a thing`),
        `did not read: ${heading}`,
      );
    }
  });

  it("ignores rules drawn under the heading", () => {
    const proposal = readProposal(
      "PROPOSED UPDATE\n────────────────\n\nTASKS.md\n- Do a thing",
    );

    assert.equal(proposal?.files.length, 1);
  });
});

describe("change markers", () => {
  it("reads the marker Hermes used", () => {
    const proposal = readProposal(
      "PROPOSED UPDATE\n\nTASKS.md\n✓ Mark navigation redesign complete\n+ Add Chef fallback tests to NOW\n✗ Drop the stale item",
    );

    assert.deepEqual(
      proposal?.files[0].changes.map((change) => change.kind),
      ["complete", "add", "remove"],
    );
  });

  it("keeps the line as Hermes wrote it, without its marker", () => {
    const proposal = readProposal(
      "PROPOSED UPDATE\n\nTASKS.md\n- ✓ Mark navigation redesign complete",
    );

    assert.deepEqual(proposal?.files[0].changes[0], {
      kind: "complete",
      text: "Mark navigation redesign complete",
    });
  });

  it("treats a plain bullet as an edit", () => {
    const proposal = readProposal("PROPOSED CHANGES\n\nSTATUS.md\n- Update milestone");

    assert.equal(proposal?.files[0].changes[0].kind, "edit");
  });

  it("reads numbered items", () => {
    const proposal = readProposal(
      "PROPOSED CHANGES\n\nTASKS.md\n1. First thing\n2. Second thing",
    );

    assert.equal(proposal?.files[0].changes.length, 2);
  });

  it("keeps free text under a file", () => {
    const proposal = readProposal(
      "PROPOSED UPDATE\n\nSTATUS.md\n\nUpdate milestone to:\nChef reliability + performance",
    );

    assert.deepEqual(
      proposal?.files[0].changes.map((change) => change.text),
      ["Update milestone to:", "Chef reliability + performance"],
    );
  });
});

describe("refusing to invent a proposal", () => {
  it("returns nothing for ordinary prose", () => {
    assert.equal(
      readProposal("Here is what I found. Nothing needs changing right now."),
      undefined,
    );
  });

  it("returns nothing for a heading with no files under it", () => {
    assert.equal(readProposal("PROPOSED CHANGES\n\nNothing to do."), undefined);
  });

  it("does not read a sentence as a filename", () => {
    const proposal = readProposal(
      "PROPOSED CHANGES\n\nTASKS.md\n- Do a thing\n\nI will run this now.",
    );

    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      ["TASKS.md"],
    );
  });

  it("is not fooled by the words appearing mid-sentence", () => {
    assert.equal(
      readProposal("I have proposed changes to the plan, see above."),
      undefined,
    );
  });

  it("handles an empty reply", () => {
    assert.equal(readProposal(""), undefined);
  });
});

/**
 * The mutation skills each write their proposal slightly differently. These
 * pin the shapes they actually emit, so a change here cannot quietly stop a
 * skill's proposal from rendering as a card.
 */
describe("the formats the skills emit", () => {
  it("reads a portfolio-update proposal, ignoring its trailing reason", () => {
    const proposal = readProposal(
      [
        "# Proposed Portfolio Update",
        "",
        "**PORTFOLIO.md**",
        "- Move Pantry Pilot to active",
        "",
        "**CURRENT_FOCUS.md**",
        "- None",
        "",
        "**Reason**",
        "Chef reliability work has started.",
      ].join("\n"),
    );

    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      ["PORTFOLIO.md", "CURRENT_FOCUS.md"],
    );
    // The reason is commentary, not a change to CURRENT_FOCUS.md.
    assert.deepEqual(proposal?.files[1].changes, []);
    assert.equal(proposal?.files[1].unchanged, true);
  });

  it("reads an inbox-review proposal, keeping the review as reasoning", () => {
    const proposal = readProposal(
      [
        "# Inbox Review",
        "",
        "## Promote",
        "",
        "1. Add fallback tests",
        "   → pantry-pilot",
        "",
        "# Proposed Inbox Update",
        "",
        "**inbox/CAPTURE.md**",
        '- Remove "Add fallback tests"',
        "",
        "**projects/pantry-pilot/TASKS.md**",
        '- Add "Add fallback tests" to NOW',
        "",
        "**projects/pantry-pilot/DECISIONS.md**",
        "- None",
        "",
        "**Reason**",
        "One item promoted.",
      ].join("\n"),
    );

    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      [
        "inbox/CAPTURE.md",
        "projects/pantry-pilot/TASKS.md",
        "projects/pantry-pilot/DECISIONS.md",
      ],
    );
    assert.ok(proposal?.preamble.includes("Inbox Review"));
    assert.equal(changedFileCount(proposal!), 2);
  });

  it("reads a memory-hygiene proposal, including its archive directory", () => {
    const proposal = readProposal(
      [
        "# Memory Hygiene",
        "",
        "**Active context health**",
        "Cleanup Recommended",
        "",
        "# Proposed Memory Update",
        "",
        "**projects/pantry-pilot/TASKS.md**",
        "- Move 28 completed tasks out",
        "",
        "**archive/logs/daily/2026-08/**",
        "- Move 21 August daily logs here",
        "",
        "**Reason**",
        "Active files are carrying finished work.",
      ].join("\n"),
    );

    // An item leaving one file and landing in another must show both ends, so
    // a move never reads as a deletion.
    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      ["projects/pantry-pilot/TASKS.md", "archive/logs/daily/2026-08/"],
    );
  });

  it("names a full path when the skill gives one", () => {
    const proposal = readProposal(
      "PROPOSED CHANGES\n\n**projects/virtara/STATUS.md**\n- Update milestone",
    );

    assert.equal(proposal?.files[0].file, "projects/virtara/STATUS.md");
  });

  it("does not read an ordinary hyphenated word as a path", () => {
    const proposal = readProposal(
      "PROPOSED CHANGES\n\n**TASKS.md**\n- Do a thing\n\n**Notes**\nSomething else",
    );

    assert.deepEqual(
      proposal?.files.map((file) => file.file),
      ["TASKS.md"],
    );
  });
});
