import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  defaultTimesheetWeek,
  dueTaskIds,
  groupWorkLogByWeek,
  isoWeek,
  missingWorkdays,
  nextOccurrence,
  routineStatus,
  timesheetTotals,
} from "../../../shared/career-logic";
import type { TimesheetRow } from "../../../shared/career-types";
import { escapeLittleText } from "../linkedin";
import { readSuggestions } from "../hermes";
import { todayItems } from "../career";
import { mutateCareer, normaliseState, readCareer } from "../store";

const row = (overrides: Partial<TimesheetRow>): TimesheetRow => ({
  date: "2026-09-28",
  project: "R - FNB - Backbase",
  category: "Development",
  hours: 1,
  minutes: 0,
  billable: true,
  description: "Work",
  ticketNumber: "",
  sentiment: "Neutral",
  workedFrom: "Home",
  mapped: true,
  recordedSeconds: 3600,
  ...overrides,
});

describe("career routines", () => {
  // 2026-10-02 is a Friday, 2026-10-06 a Tuesday.
  const timesheet = { id: "timesheet" as const, name: "Timesheet", weekday: 5, enabled: true };

  it("is due on its day and stays due until done", () => {
    assert.equal(routineStatus(timesheet, "2026-10-02").due, true);
    assert.equal(routineStatus(timesheet, "2026-10-05").due, true);
    assert.equal(routineStatus(timesheet, "2026-10-05").dueOn, "2026-10-02");
  });

  it("counts a timesheet done a day early, and is then not due until next week", () => {
    const done = { ...timesheet, lastCompletedOn: "2026-10-01" };
    assert.equal(routineStatus(done, "2026-10-02").due, false);
    assert.equal(routineStatus(done, "2026-10-02").dueOn, "2026-10-09");
    assert.equal(routineStatus(done, "2026-10-07").due, false);
    assert.equal(routineStatus(done, "2026-10-09").due, true);
  });

  it("lets a missed soccer event lapse the day after", () => {
    const soccer = { id: "soccer" as const, name: "Soccer", weekday: 2, enabled: true };
    assert.equal(routineStatus(soccer, "2026-10-06").due, true);
    assert.equal(routineStatus(soccer, "2026-10-07").due, false);
    assert.equal(routineStatus(soccer, "2026-10-07").dueOn, "2026-10-13");
  });

  it("is never due when switched off", () => {
    assert.equal(routineStatus({ ...timesheet, enabled: false }, "2026-10-02").due, false);
  });

  it("finds the next Tuesday", () => {
    assert.equal(nextOccurrence(2, "2026-10-05"), "2026-10-06");
    assert.equal(nextOccurrence(2, "2026-10-06"), "2026-10-06");
  });
});

describe("timesheet arithmetic", () => {
  it("splits recorded time into mapped and unmapped, and submits the rounded mapped rows", () => {
    const totals = timesheetTotals([
      row({ recordedSeconds: 3600 + 8 * 60, hours: 1, minutes: 15 }),
      row({ mapped: false, recordedSeconds: 45 * 60, hours: 0, minutes: 45, issue: "No tag" }),
    ]);
    assert.deepEqual(totals, { recordedMinutes: 113, mappedMinutes: 68, unmappedMinutes: 45, submittedMinutes: 75 });
  });

  it("lists workdays with nothing recorded, up to today", () => {
    assert.deepEqual(missingWorkdays([row({ date: "2026-09-28" })], "2026-09-28", "2026-10-02", "2026-09-30"), ["2026-09-29", "2026-09-30"]);
  });

  it("extracts last week until Friday", () => {
    assert.equal(defaultTimesheetWeek("2026-10-05"), "2026-09-28");
    assert.equal(defaultTimesheetWeek("2026-10-09"), "2026-10-05");
  });

  it("numbers ISO weeks", () => {
    assert.equal(isoWeek("2026-09-28"), 40);
    assert.equal(isoWeek("2026-01-01"), 1);
  });
});

describe("timesheet script", () => {
  const script = path.resolve(import.meta.dirname, "../../../scripts/career/timesheet/extract.py");

  it("aggregates, rounds and flags entries like the notebook did", (context) => {
    let output: string;
    try {
      output = execFileSync("python3", [script], {
        input: JSON.stringify({
          weekStart: "2026-09-28",
          weekEnd: "2026-10-04",
          projects: [{ id: 1, name: "R - FNB - Backbase" }],
          entries: [
            { id: 1, start: "2026-09-28T08:00:00Z", duration: 600, project_id: 1, tags: ["Development"], description: "Standup" },
            { id: 2, start: "2026-09-28T12:00:00Z", duration: 600, project_id: 1, tags: ["Development"], description: "Standup" },
            { id: 3, start: "2026-09-29T08:00:00Z", duration: 3000, project_id: null, tags: [], description: "Admin" },
            { id: 4, start: "2026-09-30T08:00:00Z", duration: -1, project_id: 1, tags: [], description: "Running" },
            { id: 5, start: "2026-10-12T08:00:00Z", duration: 3600, project_id: 1, tags: ["Development"], description: "Outside" },
          ],
        }),
        encoding: "utf8",
      });
    } catch {
      context.skip("python3 is not available");
      return;
    }
    const result = JSON.parse(output) as { rows: TimesheetRow[]; runningEntries: number };
    assert.equal(result.runningEntries, 1);
    assert.equal(result.rows.length, 2);
    const standup = result.rows.find((item) => item.description === "Standup");
    assert.equal(standup?.minutes, 15, "two 10-minute entries become 20 minutes, rounded to 15");
    assert.equal(standup?.billable, true);
    assert.equal(standup?.mapped, true);
    const admin = result.rows.find((item) => item.description === "Admin");
    assert.equal(admin?.mapped, false);
    assert.equal(admin?.issue, "No Toggl project");
  });
});

describe("work log and today", () => {
  it("groups the log by week, newest first", () => {
    const weeks = groupWorkLogByWeek([
      { id: "a", date: "2026-09-29", client: "Standard Bank", workedOn: ["Implemented X"], learned: [], blockedBy: [], createdAt: "" },
      { id: "b", date: "2026-10-05", workedOn: [], learned: ["Caching"], blockedBy: [], createdAt: "" },
      { id: "c", date: "2026-09-30", client: "Standard Bank", workedOn: ["Investigated Y"], learned: [], blockedBy: ["Access"], createdAt: "" },
    ]);
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0].weekStart, "2026-10-05");
    assert.deepEqual(weeks[1].workedOn, ["Implemented X", "Investigated Y"]);
    assert.deepEqual(weeks[1].clients, ["Standard Bank"]);
  });

  it("puts due routines and due open tasks on Today", () => {
    const state = normaliseState({
      taskMeta: [
        { taskId: "CA-001", category: "client", client: "Standard Bank", dueDate: "2026-10-05" },
        { taskId: "CA-002", dueDate: "2026-10-01" },
        { taskId: "CA-003", dueDate: "2026-10-20" },
      ],
    });
    const items = todayItems(
      state,
      [
        { id: "CA-001", title: "Follow up" },
        { id: "CA-003", title: "Later" },
      ],
      "2026-10-06",
    );
    assert.deepEqual(
      items.map((item) => item.id),
      ["routine:timesheet", "routine:soccer", "task:CA-001"],
      "2026-10-06 is a Tuesday: soccer is due that day",
    );
    assert.deepEqual(dueTaskIds(state.taskMeta, new Set(["CA-002"]), "2026-10-06"), ["CA-002"]);
  });
});

describe("career store", () => {
  let root: string;
  const previous = process.env.AGENTOS_ROOT;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "career-"));
    process.env.AGENTOS_ROOT = root;
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("starts with both routines and keeps writes made one after another", async () => {
    const empty = await readCareer();
    assert.deepEqual(
      empty.routines.map((routine) => routine.id),
      ["timesheet", "soccer"],
    );
    await Promise.all([
      mutateCareer((state) => void state.growth.goals.push({ id: "g1", text: "One", status: "active", createdAt: "" })),
      mutateCareer((state) => void state.growth.goals.push({ id: "g2", text: "Two", status: "active", createdAt: "" })),
    ]);
    assert.equal((await readCareer()).growth.goals.length, 2);
  });

  it("drops an unreadable record instead of failing", () => {
    const state = normaliseState({ workLog: [{ id: "x" }, { id: "ok", date: "2026-10-05", workedOn: ["a"], createdAt: "" }] });
    assert.deepEqual(
      state.workLog.map((entry) => entry.id),
      ["ok"],
    );
  });
});

describe("LinkedIn and Hermes text", () => {
  it("escapes LinkedIn's reserved characters", () => {
    assert.equal(escapeLittleText("Use (a) #tag @me"), "Use \\(a\\) \\#tag \\@me");
  });

  it("reads suggestions and drops malformed ones", () => {
    const suggestions = readSuggestions(
      { suggestions: [{ kind: "skill-gap", text: "System design", proposedGoal: "Write one design doc a month" }, { text: "" }, { kind: "weird", text: "Ship X" }] },
      new Date(),
    );
    assert.equal(suggestions.length, 2);
    assert.equal(suggestions[1].kind, "next-step");
  });
});
