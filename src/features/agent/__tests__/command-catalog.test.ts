import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentSkill } from "@shared/agentos-types";
import {
  buildCommands,
  buildQuickCommands,
  FALLBACK_SKILLS,
  flattenGroups,
  groupCommands,
  labelFor,
  overflowCount,
  projectInContext,
  scoreCommand,
  searchCommands,
  toCommand,
} from "../command-catalog";

/**
 * The console's commands come from Hermes.
 *
 * These cover the part that stays in the frontend: how a discovered skill is
 * named, scoped to a project, grouped, and ranked — and that a Hermes which
 * cannot be asked still leaves a usable console.
 */

function skill(
  name: string,
  scope: AgentSkill["scope"] = "workspace",
  extra: Partial<AgentSkill> = {},
): AgentSkill {
  return { name, command: `/${name}`, scope, ...extra };
}

/** A Hermes with skills the frontend has never heard of. */
const DISCOVERED: AgentSkill[] = [
  skill("start-day", "workspace", { category: "Daily", description: "Plan today" }),
  skill("capture", "workspace", { category: "Daily" }),
  skill("work-on", "project", { category: "Project" }),
  skill("project-sync", "project", { category: "Project" }),
  skill("weekly-review", "workspace", { category: "Review" }),
  skill("memory-hygiene", "workspace", { category: "System" }),
  skill("brew-coffee", "workspace", { category: "Skills" }),
];

describe("labels", () => {
  it("reads a skill name as a label", () => {
    assert.equal(labelFor("start-day"), "Start day");
    assert.equal(labelFor("project-sync"), "Project sync");
  });
});

describe("commands from discovered skills", () => {
  it("scopes a project skill to the selected project", () => {
    const command = toCommand(skill("work-on", "project"), "pantry-pilot");

    assert.equal(command.command, "/work-on pantry-pilot");
    assert.equal(command.needsProject, false);
  });

  it("leaves a project skill unscoped and flagged when no project is selected", () => {
    const command = toCommand(skill("work-on", "project"));

    assert.equal(command.command, "/work-on");
    assert.equal(command.needsProject, true);
  });

  it("never scopes a workspace skill", () => {
    assert.equal(toCommand(skill("start-day"), "virtara").command, "/start-day");
  });

  it("builds a command for every skill Hermes reports", () => {
    assert.equal(buildCommands(DISCOVERED).length, DISCOVERED.length);
  });

  it("includes a skill the frontend has never heard of", () => {
    const commands = buildCommands(DISCOVERED).map((command) => command.command);

    assert.ok(commands.includes("/brew-coffee"));
  });
});

describe("falling back when Hermes cannot be asked", () => {
  it("uses the baseline when no skills were discovered", () => {
    assert.deepEqual(buildCommands([]), buildCommands(FALLBACK_SKILLS));
    assert.deepEqual(buildCommands(undefined), buildCommands(FALLBACK_SKILLS));
  });

  it("replaces the baseline entirely once discovery succeeds", () => {
    const names = buildCommands(DISCOVERED).map((command) => command.name);

    assert.ok(!names.includes("dashboard"), "baseline leaked into discovery");
  });

  it("only ever emits commands Hermes named", () => {
    for (const command of buildCommands(DISCOVERED, "virtara")) {
      assert.match(command.command, /^\/[a-z0-9-]+( [a-z0-9-]+)?$/);
    }
  });
});

describe("quick commands", () => {
  it("shows only the skills that earn a permanent button", () => {
    assert.deepEqual(
      buildQuickCommands(DISCOVERED).map((quick) => quick.label),
      ["Start day", "Capture", "Work on", "Project sync"],
    );
  });

  it("keeps a fixed order regardless of how Hermes lists them", () => {
    const reversed = [...DISCOVERED].reverse();

    assert.deepEqual(
      buildQuickCommands(reversed).map((quick) => quick.label),
      buildQuickCommands(DISCOVERED).map((quick) => quick.label),
    );
  });

  it("never shows a button for a skill Hermes does not have", () => {
    assert.deepEqual(buildQuickCommands([skill("capture")]), [
      { label: "Capture", command: "/capture", description: undefined, disabled: false },
    ]);
  });

  it("disables project commands until a project is selected", () => {
    const disabled = buildQuickCommands(DISCOVERED)
      .filter((quick) => quick.disabled)
      .map((quick) => quick.label);

    assert.deepEqual(disabled, ["Work on", "Project sync"]);
  });

  it("scopes and enables them once a project is selected", () => {
    const quick = buildQuickCommands(DISCOVERED, "pantry-pilot");

    assert.ok(quick.every((entry) => !entry.disabled));
    assert.ok(
      quick.some((entry) => entry.command === "/work-on pantry-pilot"),
      "project command was not scoped",
    );
  });

  it("counts the skills that live only in the palette", () => {
    // start-day, capture, work-on and project-sync get buttons; the rest do not.
    assert.equal(overflowCount(DISCOVERED), 3);
  });
});

describe("searching", () => {
  const commands = buildCommands(DISCOVERED);

  it("ignores a leading slash", () => {
    assert.equal(
      scoreCommand(toCommand(skill("start-day")), "/start"),
      scoreCommand(toCommand(skill("start-day")), "start"),
    );
  });

  it("ranks a name prefix above a description match", () => {
    const results = searchCommands(commands, "capture", {});

    assert.equal(results[0]?.name, "capture");
  });

  it("finds a command by its description", () => {
    assert.deepEqual(
      searchCommands(commands, "plan today", {}).map((command) => command.name),
      ["start-day"],
    );
  });

  it("matches out-of-order characters as a last resort", () => {
    assert.ok(
      searchCommands(commands, "pjsync", {}).some(
        (command) => command.name === "project-sync",
      ),
    );
  });

  it("returns nothing when nothing matches", () => {
    assert.deepEqual(searchCommands(commands, "zzzz", {}), []);
  });

  it("returns everything for an empty query", () => {
    assert.equal(searchCommands(commands, "", {}).length, commands.length);
  });
});

describe("context-aware ranking", () => {
  const commands = buildCommands(DISCOVERED, "pantry-pilot");

  it("suggests project commands when a project is in context", () => {
    const groups = groupCommands(commands, { project: "pantry-pilot" });

    assert.equal(groups[0]?.label, "Suggested");
    assert.deepEqual(
      groups[0]?.commands.map((command) => command.name),
      ["work-on", "project-sync"],
    );
  });

  it("suggests daily commands when no project is in context", () => {
    const groups = groupCommands(buildCommands(DISCOVERED), {});

    assert.deepEqual(
      groups[0]?.commands.map((command) => command.name),
      ["start-day", "capture"],
    );
  });

  it("shows a suggested command once, not twice", () => {
    const names = flattenGroups(
      groupCommands(commands, { project: "pantry-pilot" }),
    ).map((command) => command.name);

    assert.equal(new Set(names).size, names.length);
  });

  it("keeps every command reachable", () => {
    const grouped = flattenGroups(groupCommands(commands, { project: "x" }));

    assert.equal(grouped.length, commands.length);
  });

  it("orders categories predictably", () => {
    const labels = groupCommands(buildCommands(DISCOVERED), {}).map(
      (group) => group.label,
    );

    assert.deepEqual(labels, ["Suggested", "Project", "Review", "System", "Skills"]);
  });

  it("groups a category Hermes invented rather than dropping it", () => {
    const groups = groupCommands(
      buildCommands([skill("moon-phase", "workspace", { category: "Astronomy" })]),
      {},
    );

    assert.deepEqual(groups, [
      {
        label: "Astronomy",
        commands: [
          {
            name: "moon-phase",
            label: "Moon phase",
            command: "/moon-phase",
            description: undefined,
            category: "Astronomy",
            needsProject: false,
          },
        ],
      },
    ]);
  });
});

describe("the project a route is about", () => {
  it("reads the slug from a project route", () => {
    assert.equal(projectInContext("/projects/pantry-pilot", ""), "pantry-pilot");
    assert.equal(projectInContext("/projects/pantry-pilot/", ""), "pantry-pilot");
  });

  it("reads the console's own selection", () => {
    assert.equal(projectInContext("/agent", "?project=virtara"), "virtara");
  });

  it("has no project on the portfolio or the dashboard", () => {
    assert.equal(projectInContext("/projects", ""), undefined);
    assert.equal(projectInContext("/", ""), undefined);
    assert.equal(projectInContext("/agent", ""), undefined);
  });
});
