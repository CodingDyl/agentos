import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const {
  existingThreadIds,
  insertThreadIfNew,
  listUnclassifiedThreadIds,
  readMailData,
  readThreadSummary,
  storeClassification,
  threadCount,
} = await import("../store");

before(() => {
  mailDatabase();
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("insertThreadIfNew", () => {
  it("stores a new thread as unclassified", () => {
    insertThreadIfNew({
      threadId: "t1",
      fromName: "Gavin",
      fromEmail: "gavin@example.com",
      subject: "Vaja configurator",
      snippet: "Can we push pricing live?",
      messageDate: "2026-09-23T09:42:00.000Z",
    });

    assert.equal(threadCount(), 1);
    assert.deepEqual(listUnclassifiedThreadIds(), ["t1"]);
  });

  it("never overwrites a thread that is already stored", () => {
    insertThreadIfNew({
      threadId: "t1",
      subject: "A different subject entirely",
      snippet: "Should not land",
      messageDate: "2026-09-24T09:42:00.000Z",
    });

    const summary = readThreadSummary("t1");
    assert.equal(summary?.subject, "Vaja configurator");
  });

  it("is included in existingThreadIds", () => {
    assert.ok(existingThreadIds().has("t1"));
    assert.equal(existingThreadIds().has("unknown"), false);
  });
});

describe("storeClassification", () => {
  it("marks the thread classified and removes it from the unclassified list", () => {
    storeClassification("t1", {
      category: "client",
      needsReply: 0.9,
      urgency: 3.2,
      business: "Vaja",
      financial: 0.1,
      actionRequired: 0.2,
    });

    assert.deepEqual(listUnclassifiedThreadIds(), []);
  });

  it("is reflected in readMailData's needs_you bucket", () => {
    const data = readMailData();
    assert.equal(data.needsYou.length, 1);
    assert.equal(data.needsYou[0].threadId, "t1");
    assert.equal(data.needsYou[0].category, "client");
    assert.equal(data.needsYou[0].urgency, 3.2);
  });
});

describe("readMailData", () => {
  it("puts a never-classified thread in fyi, unclassified", () => {
    insertThreadIfNew({
      threadId: "t2",
      subject: "Pending",
      snippet: "Not classified yet",
      messageDate: "2026-09-23T10:00:00.000Z",
    });

    const data = readMailData();
    const pending = data.fyi.find((thread) => thread.threadId === "t2");

    assert.ok(pending);
    assert.equal(pending?.classified, false);
  });
});
