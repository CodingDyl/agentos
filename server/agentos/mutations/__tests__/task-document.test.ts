import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allTasks,
  findTask,
  insertTask,
  moveTask,
  parseTaskDocument,
  removeTask,
  reorderSection,
  serializeTaskDocument,
  tasksInSection,
  updateTask,
} from "../task-document";

/**
 * The round trip, tested against the shape a real vault file actually has.
 *
 * The fixture below is the structure of a live `TASKS.md`: prose inside a task
 * section, a section with no tasks at all, and a trailing section that is
 * nothing but the operator's own writing. Every one of those is something a
 * regenerating serializer would quietly destroy, which is why the fixture looks
 * like this rather than like a tidy list.
 */

const REAL = `# Pantry Pilot Tasks

## Now

- [x] [PP-001] Investigate slow recipe search and recommendation performance.
- [ ] [PP-002] Identify major code duplication and technical debt.

## Next

- [ ] [PP-003] Improve recipe diversity.
- [ ] [PP-004] Improve pantry-aware Chef recommendations.

## Later

Only move items here once current work is stable.

## Rule

Prefer completing existing tasks before adding additional features.
`;

const edit = (
  markdown: string,
  change: (document: ReturnType<typeof parseTaskDocument>) => void,
): string => {
  const document = parseTaskDocument(markdown);
  change(document);
  return serializeTaskDocument(document);
};

describe("reading and writing a task file", () => {
  it("round-trips an untouched file byte for byte", () => {
    // The property everything else rests on. If this drifts by a single space,
    // every mutation is silently rewriting the operator's file.
    assert.equal(serializeTaskDocument(parseTaskDocument(REAL)), REAL);
  });

  it("round-trips a file with no sections at all", () => {
    const sparse = "# Tasks\n\nNo active tasks currently promoted into AgentOS.\n";

    assert.equal(serializeTaskDocument(parseTaskDocument(sparse)), sparse);
  });

  it("reads tasks with their ids and state", () => {
    const tasks = allTasks(parseTaskDocument(REAL));

    assert.equal(tasks.length, 4);
    assert.equal(tasks[0].id, "PP-001");
    assert.equal(tasks[0].completed, true);
    assert.equal(tasks[1].title, "Identify major code duplication and technical debt.");
  });

  it("does not treat a checkbox inside a fence as a task", () => {
    const fenced = "# Tasks\n\n## Now\n\n```\n- [ ] [PP-999] not a task\n```\n";

    assert.equal(allTasks(parseTaskDocument(fenced)).length, 0);
    assert.equal(serializeTaskDocument(parseTaskDocument(fenced)), fenced);
  });
});

describe("changing a task", () => {
  it("rewrites only the line it changed", () => {
    const next = edit(REAL, (document) => {
      updateTask(document, "PP-002", { completed: true });
    });

    assert.ok(next.includes("- [x] [PP-002] Identify major code duplication"));
    // Everything else is untouched, prose included.
    assert.ok(next.includes("Only move items here once current work is stable."));
    assert.ok(next.includes("## Rule"));
    assert.ok(next.includes("Prefer completing existing tasks"));
    assert.equal(next.split("\n").length, REAL.split("\n").length);
  });

  it("keeps the operator's prose when a task is added to a prose-only section", () => {
    const next = edit(REAL, (document) => {
      insertTask(document, "later", { id: "PP-005", title: "Household sharing" });
    });

    const later = next.slice(next.indexOf("## Later"), next.indexOf("## Rule"));

    assert.ok(later.includes("Only move items here once current work is stable."));
    assert.ok(later.includes("- [ ] [PP-005] Household sharing"));
    // The note stays above the list it introduces.
    assert.ok(
      later.indexOf("Only move items") < later.indexOf("[PP-005]"),
      "prose must stay above the tasks",
    );
  });

  it("adds a new task below the existing ones in its section", () => {
    const next = edit(REAL, (document) => {
      insertTask(document, "now", { id: "PP-005", title: "New work" });
    });

    const now = next.slice(next.indexOf("## Now"), next.indexOf("## Next"));

    assert.ok(now.indexOf("[PP-002]") < now.indexOf("[PP-005]"));
  });

  it("creates a missing section in canonical order, not at the end", () => {
    const next = edit(REAL, (document) => {
      insertTask(document, "done", { id: "PP-006", title: "Finished", completed: true });
    });

    // After Later, and crucially before the operator's own trailing section.
    assert.ok(next.indexOf("## Later") < next.indexOf("## Done"));
    assert.ok(next.indexOf("## Done") < next.indexOf("## Rule"));
    assert.ok(next.includes("- [x] [PP-006] Finished"));
  });

  it("creates a section in a file that has none", () => {
    const sparse = "# Tasks\n\nNo active tasks currently promoted into AgentOS.\n";

    const next = edit(sparse, (document) => {
      insertTask(document, "now", { id: "JV-001", title: "First task" });
    });

    assert.ok(next.includes("## Now"));
    assert.ok(next.includes("- [ ] [JV-001] First task"));
    assert.ok(next.includes("No active tasks currently promoted into AgentOS."));
  });
});

describe("moving a task", () => {
  it("moves it between sections without disturbing anything else", () => {
    const next = edit(REAL, (document) => {
      moveTask(document, "PP-003", "now");
    });

    const now = next.slice(next.indexOf("## Now"), next.indexOf("## Next"));
    const nextSection = next.slice(next.indexOf("## Next"), next.indexOf("## Later"));

    assert.ok(now.includes("[PP-003]"));
    assert.ok(!nextSection.includes("[PP-003]"));
    assert.ok(next.includes("Prefer completing existing tasks"));
  });

  it("honours a position within the target section", () => {
    const next = edit(REAL, (document) => {
      moveTask(document, "PP-003", "now", 0);
    });

    const now = next.slice(next.indexOf("## Now"), next.indexOf("## Next"));

    assert.ok(now.indexOf("[PP-003]") < now.indexOf("[PP-001]"));
  });

  it("reports nothing for a task that is not there", () => {
    const document = parseTaskDocument(REAL);

    assert.equal(moveTask(document, "PP-404", "now"), undefined);
    assert.equal(serializeTaskDocument(document), REAL);
  });
});

describe("reordering a section", () => {
  it("moves only the task lines", () => {
    const next = edit(REAL, (document) => {
      reorderSection(document, "next", ["PP-004", "PP-003"]);
    });

    const section = next.slice(next.indexOf("## Next"), next.indexOf("## Later"));

    assert.ok(section.indexOf("[PP-004]") < section.indexOf("[PP-003]"));
  });

  it("keeps a task the caller never mentioned", () => {
    // A stale screen sending an incomplete order must not delete the task it
    // did not know about.
    const next = edit(REAL, (document) => {
      reorderSection(document, "next", ["PP-004"]);
    });

    assert.ok(next.includes("[PP-003]"));
    assert.ok(next.includes("[PP-004]"));
  });
});

describe("removing a task", () => {
  it("takes out the line and nothing around it", () => {
    const next = edit(REAL, (document) => {
      removeTask(document, "PP-003");
    });

    assert.ok(!next.includes("[PP-003]"));
    assert.ok(next.includes("[PP-004]"));
    assert.ok(next.includes("## Later"));
    assert.ok(next.includes("Only move items here once current work is stable."));
  });
});

describe("locating a task", () => {
  it("says which section it is in", () => {
    const found = findTask(parseTaskDocument(REAL), "PP-004");

    assert.equal(found?.section, "next");
  });

  it("lists a section's tasks in order", () => {
    const tasks = tasksInSection(parseTaskDocument(REAL), "next");

    assert.deepEqual(
      tasks.map(({ block }) => block.id),
      ["PP-003", "PP-004"],
    );
  });
});
