import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CalendarEventInputSchema, TaskScheduleSchema } from "../../../shared/calendar-types";
import { calendarRequest, googleEventBody, listCalendarRange } from "../google-calendar";
import { preparationSuggestions } from "../tasks";
import { parseTaskDocument, serializeTaskDocument, findTask, updateTask, moveTask } from "../../agentos/mutations/task-document";
import { parseProjectTasks } from "../../agentos/projects";

const input = { title: "Client review", description: "Slides", location: "Office", start: "2026-10-05T09:00:00+02:00", end: "2026-10-05T10:00:00+02:00", timeZone: "Africa/Johannesburg", allDay: false, allowTasks: true, preparation: "Prepare slides" };
describe("calendar requests", () => {
  it("validates ranges, timezone, real dates and UTF-8 preparation limits", () => {
    assert.equal(CalendarEventInputSchema.safeParse(input).success, true);
    for (const patch of [{ end: input.start }, { end: "garbage" }, { timeZone: "Mars/Olympus" }, { preparation: "🦄".repeat(300) }]) assert.equal(CalendarEventInputSchema.safeParse({ ...input, ...patch }).success, false);
    assert.equal(CalendarEventInputSchema.safeParse({ ...input, start: "2026-10-05T09:00:00+02:00", end: "2026-10-05T08:30:00Z" }).success, true);
    assert.equal(TaskScheduleSchema.safeParse({ date: "2026-02-30" }).success, false);
    assert.equal(TaskScheduleSchema.safeParse({ date: "2026-10-05", time: "24:00" }).success, false);
  });
  it("uses exclusive all-day boundaries and private opt-in metadata", () => {
    const body = googleEventBody({ ...input, allDay: true, start: "2026-10-05", end: "2026-10-06" });
    assert.deepEqual(body.start, { date: "2026-10-05" });
    assert.deepEqual(body.end, { date: "2026-10-06" });
    assert.equal(body.extendedProperties.private.agentosAllowTasks, "true");
    assert.equal("attendees" in body, false);
  });
  it("follows pagination and preserves recurring-instance identity", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      urls.push(String(url));
      return Response.json(urls.length === 1 ? { items: [{ id: "a", start: { date: "2026-10-05" } }], nextPageToken: "next" } : { items: [{ id: "b_20261006", recurringEventId: "b", etag: '"v1"', start: { date: "2026-10-06" }, extendedProperties: { private: { agentosAllowTasks: "true" } } }] });
    };
    const result = await listCalendarRange("fake", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", fetcher);
    assert.equal(result.length, 2);
    assert.match(urls[1], /pageToken=next/);
    assert.equal(result[1].recurringEventId, "b");
    assert.equal(result[1].allowTasks, true);
  });
  it("returns actionable conflicts and permission failures without leaking Google payloads", async () => {
    await assert.rejects(calendarRequest("https://example.test", {}, async () => new Response("secret", { status: 412 })), /changed in Google Calendar/);
    await assert.rejects(calendarRequest("https://example.test", {}, async () => new Response("secret", { status: 403 })), /Reconnect Google/);
  });
});
describe("scheduled tasks", () => {
  it("keeps scheduling and event links through rename, completion and section moves", () => {
    const source = "# Tasks\n\n## Next\n\n- [ ] [PP-001] Prepare slides · scheduled 2026-10-05@09:30/45 · event abc_123 · ready\n\n## Rule\nNever delete this prose.\n";
    const document = parseTaskDocument(source);
    assert.deepEqual(findTask(document, "PP-001")?.block.schedule, { date: "2026-10-05", time: "09:30", durationMinutes: 45 });
    updateTask(document, "PP-001", { title: "Review slides", completed: true });
    moveTask(document, "PP-001", "done");
    const saved = serializeTaskDocument(document);
    assert.match(saved, /Never delete this prose/);
    const task = findTask(parseTaskDocument(saved), "PP-001")!.block;
    assert.equal(task.calendarEventId, "abc_123");
    assert.equal(task.schedule?.date, "2026-10-05");
    assert.equal(task.completed, true);
    updateTask(document, "PP-001", { schedule: null });
    assert.equal(findTask(parseTaskDocument(serializeTaskDocument(document)), "PP-001")?.block.schedule, undefined);
    assert.equal(parseProjectTasks(source).next[0].schedule?.time, "09:30");
    assert.equal(parseProjectTasks(source).next[0].title, "Prepare slides");
  });
  it("preserves invalid scheduling prose instead of swallowing it", () => {
    const task = findTask(parseTaskDocument("## Now\n- [ ] [PP-001] Do this · scheduled 2026-02-30/60\n"), "PP-001")!.block;
    assert.equal(task.schedule, undefined);
    assert.match(task.title, /scheduled 2026-02-30/);
  });
  it("suggests only the user's own preparation lines and removes repeated lines", () => {
    assert.deepEqual(preparationSuggestions("- Prepare slides\n2. Review agenda\nPrepare slides\n"), ["Prepare slides", "Review agenda"]);
    assert.deepEqual(preparationSuggestions(""), []);
  });
});
