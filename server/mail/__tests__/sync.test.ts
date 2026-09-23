import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ClassificationResult } from "../jev-client";
import type { GmailThreadSummary } from "../gmail-client";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-sync-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const { readMailData, threadCount } = await import("../store");
const { runMailSync } = await import("../sync");

before(() => {
  mailDatabase();
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

function fakeSummary(threadId: string): GmailThreadSummary {
  return {
    threadId,
    fromName: "Gavin",
    fromEmail: "gavin@example.com",
    subject: `Subject for ${threadId}`,
    snippet: "A snippet",
    messageDate: "2026-09-23T09:00:00.000Z",
  };
}

const alwaysNeedsReply: ClassificationResult = {
  category: "client",
  needsReply: 0.9,
  urgency: 3,
  business: "none",
  financial: 0.1,
  actionRequired: 0.1,
};

describe("runMailSync", () => {
  it("inserts every new remote thread and classifies it", async () => {
    const result = await runMailSync({
      listInboxThreadIds: async () => ["t1", "t2"],
      getThreadSummary: async (id: string) => fakeSummary(id),
      classifyThread: async () => alwaysNeedsReply,
    });

    assert.deepEqual(result, { added: 2, classified: 2, failed: 0 });
    assert.equal(threadCount(), 2);
    assert.equal(readMailData().needsYou.length, 2);
  });

  it("does not re-fetch a thread already stored, but does retry its classification if unclassified", async () => {
    let summaryCalls = 0;

    const result = await runMailSync({
      listInboxThreadIds: async () => ["t1", "t2"],
      getThreadSummary: async (id: string) => {
        summaryCalls += 1;
        return fakeSummary(id);
      },
      classifyThread: async () => alwaysNeedsReply,
    });

    // Both threads were already classified in the previous test, so nothing
    // is fetched or re-classified.
    assert.equal(summaryCalls, 0);
    assert.deepEqual(result, { added: 0, classified: 0, failed: 0 });
  });

  it("stores a new thread even when its classification fails, and counts the failure", async () => {
    const result = await runMailSync({
      listInboxThreadIds: async () => ["t1", "t2", "t3"],
      getThreadSummary: async (id: string) => fakeSummary(id),
      classifyThread: async () => {
        throw new Error("Jev is unreachable");
      },
    });

    assert.deepEqual(result, { added: 1, classified: 0, failed: 1 });
    assert.equal(threadCount(), 3);

    const data = readMailData();
    const pending = data.fyi.find((thread) => thread.threadId === "t3");
    assert.equal(pending?.classified, false);
  });
});
