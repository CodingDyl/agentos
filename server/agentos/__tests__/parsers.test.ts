import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseFocusEntries,
  parseInboxCount,
  parseProgress,
  parseResumeHere,
  parseWatch,
  resolveFocusProject,
} from "../dashboard";
import {
  condenseToLine,
  getBullets,
  getFirstParagraph,
  getSection,
} from "../markdown";
import {
  parsePortfolio,
  parseProjectNextAction,
  parseProjectStatus,
} from "../projects";
import type { ProjectSummary } from "../../../shared/agentos-types";

describe("portfolio", () => {
  it("reads heading blocks with Key: value fields", () => {
    const entries = parsePortfolio(`# Project Portfolio

## Projects

### Pantry Pilot
Type: Product
State: Active
Priority: High

### VoxMachine
Type: AI SaaS
State: Paused
Priority: Low

## Rules
- Not a project.
`);

    assert.deepEqual(entries, [
      {
        name: "Pantry Pilot",
        type: "Product",
        state: "active",
        priority: "high",
        kind: "product",
        promoted: undefined,
      },
      {
        name: "VoxMachine",
        type: "AI SaaS",
        state: "paused",
        priority: "low",
        kind: "product",
        promoted: undefined,
      },
    ]);
  });

  it("reads a pipe table of name, type, state, priority", () => {
    const entries = parsePortfolio(`| Name | Type | State | Priority |
| --- | --- | --- | --- |
| Pantry Pilot | Product | Active | High |
| Virtara | Agency | Active | Medium |
`);

    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
      name: "Pantry Pilot",
      type: "Product",
      state: "active",
      priority: "high",
      kind: "product",
    });
    assert.equal(entries[1].priority, "medium");
  });

  it("marks internal tooling as infrastructure", () => {
    const [entry] = parsePortfolio(`### AgentOS
Type: Internal Infrastructure
State: Active
Priority: Medium
`);

    assert.equal(entry.kind, "infrastructure");
  });

  it("maps the vocabulary AgentOS uses for finished and stalled work", () => {
    const states = parsePortfolio(`### A
State: Shipped
Priority: High

### B
State: Blocked
Priority: High

### C
State: On hold
Priority: High
`).map((entry) => entry.state);

    assert.deepEqual(states, ["completed", "blocked", "paused"]);
  });

  it("parks projects whose state or priority is unrecognised", () => {
    const [entry] = parsePortfolio(`### Mystery
State: Vibing
Priority: Whenever
`);

    assert.equal(entry.state, "incubating");
    assert.equal(entry.priority, "low");
  });
});

describe("project detail", () => {
  it("takes the next action from the first unchecked NOW task", () => {
    const next = parseProjectNextAction(`# Tasks

## Now

- [ ] Investigate slow recipe search.
- [ ] Identify code duplication.

## Next

- [ ] Improve recipe diversity.
`);

    assert.equal(next, "Investigate slow recipe search.");
  });

  it("skips completed tasks and falls through to NEXT when NOW is done", () => {
    const next = parseProjectNextAction(`## Now

- [x] Already finished.

## Next

- [ ] Improve recipe diversity.
`);

    assert.equal(next, "Improve recipe diversity.");
  });

  it("returns undefined when a project has no task sections", () => {
    const markdown = "# Tasks\n\nNo active tasks currently promoted.\n";

    assert.equal(parseProjectNextAction(markdown), undefined);
  });

  it("reads status from Current Stage, or the body when that is absent", () => {
    assert.equal(
      parseProjectStatus("# Status\n\n## Current Stage\nActive development.\n"),
      "Active development.",
    );
    assert.equal(
      parseProjectStatus("# Status\n\nNo detailed status established yet.\n"),
      "No detailed status established yet.",
    );
  });
});

describe("current focus", () => {
  const focusMarkdown = `# Current Focus

## 2. Pantry Pilot
Move Pantry Pilot toward production.

## 1. AgentOS
Build the first usable version.

## Rule

Do not introduce another major personal project.
`;

  it("orders entries by their stated number, not document order", () => {
    const entries = parseFocusEntries(focusMarkdown);

    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["AgentOS", "Pantry Pilot"],
    );
    assert.equal(entries[0].outcome, "Build the first usable version.");
  });

  it("excludes guidance headings from the focus list", () => {
    const names = parseFocusEntries(focusMarkdown).map((entry) => entry.name);

    assert.ok(!names.includes("Rule"));
  });

  it("falls back to document order when entries are unnumbered", () => {
    const entries = parseFocusEntries("## Alpha\nFirst.\n\n## Beta\nSecond.\n");

    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["Alpha", "Beta"],
    );
  });

  it("reads the watch item from a Rule section when no Risk section exists", () => {
    assert.equal(
      parseWatch(focusMarkdown),
      "Do not introduce another major personal project.",
    );
  });

  it("returns no watch item when the focus file states none", () => {
    assert.equal(parseWatch("# Current Focus\n\n## 1. Thing\nDo it.\n"), undefined);
  });
});

describe("focus project resolution", () => {
  const projects: ProjectSummary[] = [
    { slug: "pantry-pilot", name: "Pantry Pilot", state: "active", priority: "high" },
    { slug: "virtara", name: "Virtara", state: "active", priority: "medium" },
    { slug: "jurivo", name: "Jurivo", state: "incubating", priority: "low" },
  ];

  it("skips focus entries that are not portfolio projects", () => {
    const resolved = resolveFocusProject(
      [{ name: "AgentOS" }, { name: "Pantry Pilot" }],
      projects,
    );

    assert.equal(resolved?.slug, "pantry-pilot");
  });

  it("falls back to the highest-priority live project", () => {
    const resolved = resolveFocusProject([{ name: "AgentOS" }], projects);

    assert.equal(resolved?.slug, "pantry-pilot");
  });

  it("returns undefined when there are no projects at all", () => {
    assert.equal(resolveFocusProject([{ name: "AgentOS" }], []), undefined);
  });
});

describe("work sessions and progress", () => {
  const session = `# Work Session

## Summary
Wired the dashboard to the local adapter.

## Resume Here
Add the projects endpoint.
`;

  it("reads Resume Here from a stopped session", () => {
    assert.equal(parseResumeHere(session), "Add the projects endpoint.");
  });

  it("reads progress from a session summary", () => {
    assert.equal(
      parseProgress(session),
      "Wired the dashboard to the local adapter.",
    );
  });

  it("reads progress from a daily log's first completed bullet", () => {
    const daily = `# 2026-09-05

## Completed
- Fixed Pantry Pilot navigation.
- Improved AI Chef fallback.

## Blockers
- None
`;

    assert.equal(parseProgress(daily), "Fixed Pantry Pilot navigation.");
  });

  it("returns undefined when a log has none of the known sections", () => {
    assert.equal(parseResumeHere("# Session\n\nNothing here.\n"), undefined);
    assert.equal(parseProgress("# Session\n\nNothing here.\n"), undefined);
  });
});

describe("inbox", () => {
  it("counts unprocessed capture items", () => {
    const capture = `# Capture Inbox

Hermes should classify items into:
- Project
- Task

---

## Inbox

- [Decision] Hermes is the source of truth.
- [Idea] Add a projects screen.
`;

    assert.equal(parseInboxCount(capture), 2);
  });

  it("counts an empty inbox as zero", () => {
    assert.equal(parseInboxCount("# Capture Inbox\n\n## Inbox\n"), 0);
  });

  it("counts zero rather than guessing when the Inbox section is missing", () => {
    assert.equal(parseInboxCount("# Capture Inbox\n\n- Preamble bullet\n"), 0);
  });
});

describe("markdown primitives", () => {
  it("stops a section at the next heading of equal or higher level", () => {
    const section = getSection("## A\nkeep\n### sub\nkeep too\n## B\ndrop\n", "A");

    assert.equal(section, "keep\n### sub\nkeep too");
  });

  it("returns undefined for a missing section", () => {
    assert.equal(getSection("## A\nbody\n", "Nope"), undefined);
  });

  it("ignores headings inside fenced code blocks", () => {
    const section = getSection("## A\nreal\n\n```\n## B\n```\n\n## C\nother\n", "A");

    assert.ok(section?.includes("real"));
    assert.ok(!section?.includes("other"));
  });

  it("treats nested bullets as detail, not items", () => {
    assert.deepEqual(getBullets("- one\n  - nested\n- two\n"), ["one", "two"]);
  });


  it("skips Key: value lines when finding the first paragraph", () => {
    assert.equal(getFirstParagraph("Type: Product\nState: Active\n\nReal prose.\n"), "Real prose.");
  });

  it("condenses long prose to its first sentence", () => {
    const long = `${"First sentence here.".padEnd(10, " ")} ${"x".repeat(200)}`;

    assert.equal(condenseToLine(long, 60), "First sentence here.");
  });

  it("leaves short prose untouched", () => {
    assert.equal(condenseToLine("Already short."), "Already short.");
  });
});
