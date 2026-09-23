import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { isReportableType, readStoredEvent } from "../ui-events";

/**
 * The UI event store is the only part of the timeline that writes. It records
 * decisions and outcomes — never interactions — and its wording is fixed by the
 * adapter, so nothing that reports an event can put words into the audit trail.
 */

describe("what may be reported", () => {
  it("accepts outcomes only the browser witnessed", () => {
    assert.equal(isReportableType("run.completed"), true);
    assert.equal(isReportableType("run.failed"), true);
    assert.equal(isReportableType("automation.run"), true);
  });

  it("refuses events the adapter records itself", () => {
    // The adapter knows when a run started and when an approval landed; taking
    // the browser's word for either would let the trail disagree with Hermes.
    assert.equal(isReportableType("run.started"), false);
    assert.equal(isReportableType("approval.accepted"), false);
    assert.equal(isReportableType("session.forked"), false);
  });

  it("refuses anything it does not know", () => {
    assert.equal(isReportableType("user.clicked"), false);
    assert.equal(isReportableType(""), false);
    assert.equal(isReportableType(42), false);
    assert.equal(isReportableType("toString"), false);
  });
});

describe("reading a stored line", () => {
  it("reads an event back as it was written", () => {
    const event = readStoredEvent(
      JSON.stringify({
        id: "ui-1",
        timestamp: "2026-09-07T19:42:00+02:00",
        source: "user",
        level: "success",
        type: "approval.accepted",
        title: "Approved a Hermes action",
        description: "This action only",
        project: "pantry-pilot",
        runId: "run_abc123",
      }),
    );

    assert.equal(event?.title, "Approved a Hermes action");
    assert.equal(event?.project, "pantry-pilot");
    assert.equal(event?.runId, "run_abc123");
  });

  it("skips a line it cannot parse rather than failing the timeline", () => {
    assert.equal(readStoredEvent("{ half a line"), undefined);
    assert.equal(readStoredEvent(""), undefined);
    assert.equal(readStoredEvent("null"), undefined);
  });

  it("skips an event that cannot be placed or named", () => {
    assert.equal(readStoredEvent(JSON.stringify({ id: "1", title: "x" })), undefined);
    assert.equal(
      readStoredEvent(JSON.stringify({ id: "1", timestamp: "2026-09-07T19:42:00Z" })),
      undefined,
    );
  });

  it("falls back rather than trusting an unfamiliar source or level", () => {
    const event = readStoredEvent(
      JSON.stringify({
        id: "ui-1",
        timestamp: "2026-09-07T19:42:00Z",
        title: "Something happened",
        source: "somewhere-else",
        level: "catastrophic",
      }),
    );

    assert.equal(event?.source, "user");
    assert.equal(event?.level, "info");
  });
});

/**
 * The store itself, exercised against a temporary directory — never the
 * operator's own audit trail.
 */
describe("recording", () => {
  let directory: string;
  let previous: string | undefined;
  let store: typeof import("../ui-events");

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-activity-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = directory;
    // Imported after the environment is set: the store resolves its location
    // per call, but this makes the dependency explicit.
    store = await import("../ui-events");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;

    await fs.rm(directory, { recursive: true, force: true });
  });

  it("reports nothing before anything is recorded", async () => {
    assert.deepEqual(await store.readUiEvents(10), []);
  });

  it("words the event itself, from the type alone", async () => {
    const event = await store.recordActivity({
      type: "approval.accepted",
      description: "This action only",
      runId: "run_abc123",
    });

    assert.equal(event?.title, "Approved a Hermes action");
    assert.equal(event?.source, "user");
    assert.equal(event?.level, "success");
    assert.equal(event?.runId, "run_abc123");
  });

  it("appends rather than replaces, and reads back newest first", async () => {
    await store.recordActivity({ type: "session.forked", project: "pantry-pilot" });
    await store.recordActivity({ type: "run.failed", runId: "run_def456" });

    const events = await store.readUiEvents(10);

    assert.deepEqual(
      events.map((entry) => entry.type),
      ["run.failed", "session.forked", "approval.accepted"],
    );
  });

  it("honours the limit", async () => {
    assert.equal((await store.readUiEvents(2)).length, 2);
  });

  it("skips a corrupt line and keeps the rest", async () => {
    await fs.appendFile(
      path.join(directory, "activity.jsonl"),
      "{ this is not json\n",
      "utf8",
    );

    const events = await store.readUiEvents(10);

    assert.equal(events.length, 3);
    assert.equal(events[0].type, "run.failed");
  });
});
