import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { calendarRouter } from "../routes";
import { canReadCalendar, canWriteCalendar, resetAccessTokenCache } from "../../mail/gmail-auth";
import { resetConnectorStateCache } from "../../connectors/store";
import { readTasks } from "../../agentos/mutations/tasks";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-calendar-test-"));
const previous = { ...process.env };
const originalFetch = globalThis.fetch;
const app = express();
app.use(express.json()); app.use("/api/calendar", calendarRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/calendar`;
let optIn = false;
let conflict = false;
const writes: { method: string; headers: Headers; body: Record<string, unknown> }[] = [];
async function grant(scope: string) { await fs.writeFile(path.join(directory, "ui/mail-auth.json"), JSON.stringify({ refreshToken: "fake", scope })); }
const request = (route: string, body: unknown, method = "POST", headers?: Record<string, string>) => originalFetch(base + route, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const eventInput = { title: "Review", start: "2026-10-05T09:00:00Z", end: "2026-10-05T10:00:00Z", allDay: false, timeZone: "Africa/Johannesburg", allowTasks: true, preparation: "Prepare slides" };
before(async () => {
  process.env.AGENTOS_ROOT = path.join(directory, "vault"); process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
  process.env.GOOGLE_CLIENT_ID = "fake"; process.env.GOOGLE_CLIENT_SECRET = "fake";
  resetConnectorStateCache(); resetAccessTokenCache();
  await fs.mkdir(path.join(directory, "ui"), { recursive: true });
  await fs.mkdir(path.join(directory, "vault/projects/demo"), { recursive: true });
  await fs.writeFile(path.join(directory, "vault/projects/PORTFOLIO.md"), "# Portfolio\n## Projects\n### Demo\nType: Product\nState: Active\nPriority: High\n");
  await fs.writeFile(path.join(directory, "vault/projects/demo/PROJECT.md"), "# Demo\n");
  await fs.writeFile(path.join(directory, "vault/projects/demo/TASKS.md"), "# Tasks\n\n## Now\n\n- [ ] [DE-001] Existing task\n");
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fake-access", expires_in: 3600 });
    if (!String(url).startsWith("https://www.googleapis.com/calendar/")) throw new Error("Unexpected remote request in calendar test");
    if (init?.method === "POST" || init?.method === "PATCH") {
      writes.push({ method: init.method, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      if (conflict) return new Response("", { status: 412 });
    }
    return Response.json({ id: "event_1", etag: '"v2"', summary: "Review", start: { dateTime: eventInput.start }, end: { dateTime: eventInput.end }, extendedProperties: { private: { agentosAllowTasks: String(optIn), agentosPreparation: "Prepare slides\nReview agenda" } } });
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(directory, { recursive: true, force: true });
  for (const key of ["AGENTOS_ROOT", "AGENTOS_UI_DIR", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  resetConnectorStateCache(); resetAccessTokenCache();
});
describe("calendar HTTP boundaries", () => {
  it("retains legacy read access but rejects writes until Google grants event editing", async () => {
    await grant("https://www.googleapis.com/auth/calendar.readonly");
    assert.equal(await canReadCalendar(), true); assert.equal(await canWriteCalendar(), false);
    const response = await request("/events", eventInput);
    assert.equal(response.status, 403); assert.equal(writes.length, 0);
    await grant("https://www.googleapis.com/auth/calendar.events");
  });
  it("creates and updates Google events, sending the last-read etag", async () => {
    assert.equal((await request("/events", eventInput)).status, 201);
    assert.equal((await request("/events/event_1", { ...eventInput, etag: '"v1"' }, "PATCH")).status, 200);
    assert.equal(writes.at(-1)?.headers.get("If-Match"), '"v1"');
    assert.equal(writes.at(-1)?.method, "PATCH");
    conflict = true;
    assert.equal((await request("/events/event_1", { ...eventInput, etag: '"v1"' }, "PATCH")).status, 409);
    conflict = false;
  });
  it("rejects untagged event tasks and suggestions, then creates only the approved task", async () => {
    const task = { projectSlug: "demo", title: "Prepare slides", calendarEventId: "event_1", schedule: { date: "2026-10-05", durationMinutes: 45 } };
    assert.equal((await request("/tasks", task)).status, 409);
    assert.equal((await originalFetch(base + "/events/event_1/suggestions")).status, 409);
    assert.equal((await readTasks("demo")).tasks.length, 1);
    optIn = true;
    const suggestions = await originalFetch(base + "/events/event_1/suggestions");
    assert.deepEqual(await suggestions.json(), { suggestions: ["Prepare slides", "Review agenda"] });
    assert.equal((await readTasks("demo")).tasks.length, 1);
    assert.equal((await request("/tasks", task)).status, 200);
    const saved = (await readTasks("demo")).tasks.find((entry) => entry.title === "Prepare slides")!;
    assert.equal(saved.schedule?.date, "2026-10-05"); assert.equal(saved.calendarEventId, "event_1");
  });
  it("reschedules the same task and rejects stale revisions", async () => {
    const document = await readTasks("demo");
    const task = document.tasks[0];
    const patch = { projectSlug: "demo", taskId: task.id, title: task.title, expectedRevision: document.revision, schedule: { date: "2026-10-06" } };
    assert.equal((await request("/tasks", patch)).status, 200);
    assert.equal((await request("/tasks", { ...patch, schedule: { date: "2026-10-07" } })).status, 409);
    assert.equal((await readTasks("demo")).tasks[0].schedule?.date, "2026-10-06");
  });
  it("rejects hostile origins, path traversal, and invalid ranges", async () => {
    assert.equal((await request("/events", eventInput, "POST", { Origin: "https://evil.example" })).status, 403);
    assert.equal((await request("/tasks", { projectSlug: "../demo", title: "Bad", schedule: null })).status, 400);
    assert.equal((await originalFetch(base + "/events?from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z")).status, 400);
  });
});
