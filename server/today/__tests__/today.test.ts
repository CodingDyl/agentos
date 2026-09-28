import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../../../shared/agentos-types";
import { findBriefJob, parseBriefPlan, readResponse, runAtFromFilename } from "../brief";
import { readCalendarEvents } from "../calendar";
import { formatAgenda } from "../agenda";
import { buildWrap } from "../wrap";

// Hermes' real reply of 2026-09-25, from cron/output.
const BRIEF_RESPONSE = `# Today

**Main outcome**
Advance Pantry Pilot by identifying and documenting major code duplication and technical debt to improve maintainability.

**Top 3**
1. Identify major code duplication and technical debt within Pantry Pilot (\`PP-002\`).
2. Simplify the Pantry Pilot Onboarding Flow (\`PP-012\`).
3. Implement Google Auth for Pantry Pilot (\`PP-013\`).

**If there's time**
- Set up the First-time onboarding wizard (\`PP-014\`).

**Avoid**
Starting new personal projects that are not AgentOS or Pantry Pilot.

**Calendar**
- Calendar context is unavailable due to an authentication issue with the Google Workspace skill.
`;

describe("morning brief", () => {
  it("reads the reply after the last Response heading", () => {
    const file = `# Cron Job\n\n## Prompt\n\n## Response inside the skill text is not it\n\n## Response\n\n${BRIEF_RESPONSE}`;
    assert.equal(readResponse(file), BRIEF_RESPONSE.trim());
  });

  it("parses the start-day format into a plan", () => {
    const plan = parseBriefPlan(BRIEF_RESPONSE);
    assert.ok(plan);
    assert.match(plan.mainOutcome ?? "", /^Advance Pantry Pilot/);
    assert.equal(plan.top.length, 3);
    assert.equal(plan.top[1], "Simplify the Pantry Pilot Onboarding Flow (`PP-012`).");
    assert.deepEqual(plan.ifTime, ["Set up the First-time onboarding wizard (`PP-014`)."]);
    assert.match(plan.avoid ?? "", /^Starting new personal projects/);
    assert.deepEqual(plan.notes.map((note) => note.label), ["Calendar"]);
  });

  it("is not a plan when Hermes answered with something else", () => {
    // Hermes' real reply of 2026-09-28.
    assert.equal(parseBriefPlan("I cannot access Google Calendar due to a Python version incompatibility."), undefined);
  });

  it("finds the brief job by name, or by its start-day skill", () => {
    assert.deepEqual(
      findBriefJob(JSON.stringify({ jobs: [{ id: "w1", name: "Weekly Review" }, { id: "m1", name: "AgentOS Morning Brief" }] })),
      { id: "m1", name: "AgentOS Morning Brief" },
    );
    assert.deepEqual(findBriefJob(JSON.stringify([{ id: "x", name: "Daily plan", skills: ["start-day"] }])), {
      id: "x",
      name: "Daily plan",
    });
    assert.equal(findBriefJob("{broken"), undefined);
  });

  it("reads the run time from Hermes' filename, in local time", () => {
    const at = runAtFromFilename("2026-09-28_07-30-35.md");
    assert.equal(at?.getHours(), 7);
    assert.equal(at?.getMinutes(), 30);
    assert.equal(runAtFromFilename("notes.md"), undefined);
  });
});

describe("readCalendarEvents", () => {
  it("keeps real events, drops cancelled and declined ones, and finds the call link", () => {
    const events = readCalendarEvents({
      items: [
        {
          id: "a",
          summary: "Client call",
          start: { dateTime: "2026-09-29T09:00:00+02:00" },
          end: { dateTime: "2026-09-29T09:30:00+02:00" },
          conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }] },
        },
        { id: "b", status: "cancelled", summary: "Gone", start: { dateTime: "2026-09-29T10:00:00+02:00" } },
        {
          id: "c",
          summary: "Declined",
          start: { dateTime: "2026-09-29T11:00:00+02:00" },
          attendees: [{ self: true, responseStatus: "declined" }],
        },
        { id: "d", start: { date: "2026-09-29" } },
      ],
    });
    assert.deepEqual(
      events.map((event) => [event.id, event.title, event.allDay, event.meetingUrl]),
      [
        ["a", "Client call", false, "https://meet.google.com/abc"],
        ["d", "(No title)", true, undefined],
      ],
    );
  });

  it("returns nothing for an unexpected payload", () => {
    assert.deepEqual(readCalendarEvents({ nope: true }), []);
  });
});

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: overrides.id ?? Math.random().toString(36),
    timestamp: "2026-09-28T10:00:00",
    source: "user",
    level: "success",
    type: "task.completed",
    title: "Task marked complete",
    ...overrides,
  };
}

describe("buildWrap", () => {
  const now = new Date(2026, 8, 28, 18, 0, 0);
  const projects = [{ slug: "pantry-pilot", name: "Pantry Pilot" }];

  it("lists today's completions with real task names, once each, oldest first", () => {
    const wrap = buildWrap({
      now,
      projects,
      events: [
        event({ id: "2", type: "worker.integrated", description: "Add a meta description (690b6bb5)", timestamp: "2026-09-28T15:00:00", project: "pantry-pilot" }),
        event({ id: "1", type: "worker.approved", description: "Add a meta description", timestamp: "2026-09-28T14:00:00", project: "pantry-pilot" }),
        event({ id: "0", description: "PP-004", project: "pantry-pilot", timestamp: "2026-09-28T09:00:00" }),
        event({ id: "old", description: "PP-001", project: "pantry-pilot", timestamp: "2026-09-27T09:00:00" }),
        event({ id: "noise", type: "run.completed", title: "Hermes run completed" }),
      ],
      taskTitles: new Map([["pantry-pilot", new Map([["PP-004", "Fix the shopping list sync"]])]]),
      openNow: new Map(),
    });

    assert.deepEqual(
      wrap.done.map((item) => [item.kind, item.title, item.project]),
      [
        ["task", "Fix the shopping list sync", "Pantry Pilot"],
        ["worker", "Add a meta description", "Pantry Pilot"],
      ],
    );
  });

  it("carries over open Now tasks, capped, with the full count", () => {
    const openNow = new Map([
      ["pantry-pilot", Array.from({ length: 10 }, (_, index) => ({ id: `PP-${index}`, title: `Task ${index}` }))],
    ]);
    const wrap = buildWrap({ now, projects, events: [], taskTitles: new Map(), openNow });
    assert.equal(wrap.carryOver.length, 8);
    assert.equal(wrap.carryOverTotal, 10);
    assert.equal(wrap.carryOver[0].projectName, "Pantry Pilot");
  });
});

describe("formatAgenda", () => {
  const now = new Date(2026, 8, 29, 7, 30);
  const at = (hour: number, minute = 0) => new Date(2026, 8, 29, hour, minute).toISOString();

  it("lists the day's events for Hermes, with tomorrow's start", () => {
    const text = formatAgenda(
      {
        status: "ready",
        today: [
          { id: "a", title: "Client call", start: at(9), end: at(9, 30), allDay: false, meetingUrl: "https://meet.google.com/x" },
          { id: "b", title: "Public holiday", start: "2026-09-29", allDay: true },
        ],
        tomorrowFirst: { id: "c", title: "Standup", start: new Date(2026, 8, 30, 8).toISOString(), allDay: false },
      },
      now,
    );
    assert.match(text, /^Calendar for Tuesday, 29 September 2026/);
    assert.match(text, /- 09:00 to 09:30: Client call \(video call\)/);
    assert.match(text, /- All day: Public holiday/);
    assert.match(text, /1 timed event today\./);
    assert.match(text, /Tomorrow starts with: 08:00: Standup/);
  });

  it("says the day is free when it is", () => {
    assert.match(formatAgenda({ status: "ready", today: [] }, now), /No events today/);
  });

  it("is never empty, and tells Hermes to plan without it when the calendar is missing", () => {
    const text = formatAgenda({ status: "needs-connect", detail: "Reconnect Google", today: [] }, now);
    assert.match(text, /unavailable today: Reconnect Google\. Plan the day without calendar context/);
  });
});
