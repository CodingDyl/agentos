import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarDays, calendarDate, eventOnDate, layoutEntries } from "../calendar-model";

describe("calendar dates", () => {
  it("starts weeks on Monday across month and year boundaries", () => {
    const days = calendarDays(new Date(2027, 0, 3), "week");
    assert.equal(calendarDate(days[0]), "2026-12-28");
    assert.equal(calendarDate(days[6]), "2027-01-03");
    assert.equal(calendarDays(new Date(2026, 9, 31), "month").length, 42);
  });
  it("uses exclusive all-day ends and spans multi-day events", () => {
    const event = { id: "1", title: "Away", allDay: true, start: "2026-10-04", end: "2026-10-07" };
    assert.equal(eventOnDate(event, "2026-10-03"), false);
    assert.equal(eventOnDate(event, "2026-10-06"), true);
    assert.equal(eventOnDate(event, "2026-10-07"), false);
  });
  it("gives overlapping appointments separate lanes", () => {
    const entries = [9, 9, 11].map((hour, i) => ({ key: String(i), title: "Meeting", time: "09:00", event: { id: String(i), title: "Meeting", allDay: false, start: new Date(2026, 9, 5, hour).toISOString(), end: new Date(2026, 9, 5, hour + 1).toISOString() } }));
    const layout = layoutEntries(entries, "2026-10-05");
    assert.deepEqual(layout.map(({ lane, lanes }) => [lane, lanes]), [[0, 2], [1, 2], [0, 1]]);
  });
});
