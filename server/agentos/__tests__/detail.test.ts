import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGitStatus } from "../git";
import {
  parseProjectDecisions,
  parseProjectTasks,
  parseRepositoryPath,
} from "../projects";
import { parseWorkSession } from "../sessions";

describe("tasks", () => {
  const tasks = `# Pantry Pilot Tasks

## Now

- [ ] Investigate slow recipe search.
- [x] Already done.

## Next

- [ ] Improve recipe diversity.

## Later

Only move items here once current work is stable.

## Rule

Prefer completing existing tasks.
`;

  it("groups tasks by horizon, keeping finished ones", () => {
    const parsed = parseProjectTasks(tasks);

    assert.deepEqual(
      parsed.now.map((task) => task.title),
      ["Investigate slow recipe search.", "Already done."],
    );

    // Completed work is read as well as open work now that a task can be
    // delegated: a task keeps its identity after it is done, and dropping it
    // here would lose it at the moment it mattered most.
    assert.deepEqual(
      parsed.now.map((task) => task.completed),
      [false, true],
    );

    assert.deepEqual(
      parsed.next.map((task) => task.title),
      ["Improve recipe diversity."],
    );
    assert.equal(parsed.next[0].section, "next");
  });

  it("treats a horizon with prose but no tasks as empty", () => {
    assert.deepEqual(parseProjectTasks(tasks).later, []);
  });

  it("returns empty horizons when the file has no task sections", () => {
    assert.deepEqual(parseProjectTasks("# Tasks\n\nNothing yet.\n"), {
      now: [],
      next: [],
      later: [],
    });
  });
});

describe("decisions", () => {
  it("reads one decision per heading", () => {
    const decisions = parseProjectDecisions(`# Decisions

## Kitchen
Cooking essentials should be managed separately.

## Meal Planning
Users should retain control over assigning meals to days.
`);

    assert.deepEqual(
      decisions.map((decision) => decision.title),
      ["Kitchen", "Meal Planning"],
    );
    assert.equal(
      decisions[0].detail,
      "Cooking essentials should be managed separately.",
    );
  });

  it("completes a colon lead-in with the list it introduces", () => {
    const [decision] = parseProjectDecisions(`## Navigation
Primary navigation should prioritise:
- Home
- Kitchen
- Groceries
`);

    assert.equal(
      decision.detail,
      "Primary navigation should prioritise: Home, Kitchen, Groceries",
    );
  });

  it("falls back to the bullets when there is no prose", () => {
    const [decision] = parseProjectDecisions("## Engineering\n- Performance\n- Maintainability\n");

    assert.equal(decision.detail, "Performance, Maintainability");
  });

  it("keeps a decision that has a heading but no body", () => {
    const [decision] = parseProjectDecisions("## Placeholder\n");

    assert.deepEqual(decision, { title: "Placeholder", detail: undefined });
  });

  it("returns nothing for a file with no decision headings", () => {
    assert.deepEqual(parseProjectDecisions("# Decisions\n\nNone yet.\n"), []);
  });
});

describe("repository path", () => {
  it("reads the bulleted Local repository field", () => {
    const path = parseRepositoryPath(`# Pantry Pilot

## Connected Systems

- Github repository: CodingDyl/Pantry-Pilot
- Local repository: /Users/dylan/dev/pantry-pilot
`);

    assert.equal(path, "/Users/dylan/dev/pantry-pilot");
  });

  it("reads it as a plain field too", () => {
    assert.equal(
      parseRepositoryPath("## Connected Systems\nLocal repository: /tmp/repo\n"),
      "/tmp/repo",
    );
  });

  it("returns undefined when no repository is linked", () => {
    assert.equal(parseRepositoryPath("# Project\n\n## Purpose\nA thing.\n"), undefined);
  });
});

describe("git status", () => {
  it("maps porcelain codes to words", () => {
    const changes = parseGitStatus(
      [
        " M src/app.tsx",
        "A  src/new.ts",
        "?? src/untracked.ts",
        " D src/gone.ts",
      ].join("\n"),
    );

    assert.deepEqual(changes, [
      { status: "Modified", path: "src/app.tsx" },
      { status: "Added", path: "src/new.ts" },
      { status: "New", path: "src/untracked.ts" },
      { status: "Deleted", path: "src/gone.ts" },
    ]);
  });

  it("keeps the destination of a rename", () => {
    assert.deepEqual(parseGitStatus('R  old.ts -> new.ts'), [
      { status: "Renamed", path: "new.ts" },
    ]);
  });

  it("reads a clean tree as no changes", () => {
    assert.deepEqual(parseGitStatus(""), []);
    assert.deepEqual(parseGitStatus("\n \n"), []);
  });
});

describe("work sessions", () => {
  const session = `# 2026-09-06

## Completed
- Design system implemented.
- Dashboard shipped.

## Still Open
- Data adapter.

## Blockers
- None

## Resume Here
Connect real project data.
`;

  it("reads every section", () => {
    const parsed = parseWorkSession(session, "2026-09-06.md");

    assert.equal(parsed.date, "2026-09-06");
    assert.deepEqual(parsed.completed, [
      "Design system implemented.",
      "Dashboard shipped.",
    ]);
    assert.deepEqual(parsed.stillOpen, ["Data adapter."]);
    assert.equal(parsed.resumeHere, "Connect real project data.");
  });

  it("treats a recorded 'None' as no blockers", () => {
    assert.deepEqual(parseWorkSession(session, "2026-09-06.md").blockers, []);
  });

  it("keeps real blockers", () => {
    const parsed = parseWorkSession(
      "# 2026-09-07\n\n## Blockers\n- Waiting on API keys.\n",
      "2026-09-07.md",
    );

    assert.deepEqual(parsed.blockers, ["Waiting on API keys."]);
  });

  it("takes the date from the filename, falling back to the heading", () => {
    assert.equal(parseWorkSession("# Session notes\n", "2026-09-08-evening.md").date, "2026-09-08");
    assert.equal(parseWorkSession("# Friday catch-up\n", "notes.md").date, "Friday catch-up");
  });

  it("survives a session that only records where to resume", () => {
    const parsed = parseWorkSession("## Resume Here\nPick up the git tab.\n", "2026-09-09.md");

    assert.equal(parsed.resumeHere, "Pick up the git tab.");
    assert.equal(parsed.completed, undefined);
    assert.equal(parsed.stillOpen, undefined);
  });
});
