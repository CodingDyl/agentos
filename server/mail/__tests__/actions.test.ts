import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { MailActionDeps } from "../actions";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-actions-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const { insertThreadIfNew, listCorrectionExamples, readMailData, storeCorrection, clearCorrection } =
  await import("../store");
const { markThreadsRead, runBulkAction, trashThreads } = await import("../actions");

function seed(threadId: string, fromEmail: string, unread = true) {
  insertThreadIfNew({
    threadId,
    fromEmail,
    subject: `Subject ${threadId}`,
    snippet: "Snippet",
    messageDate: `2026-09-2${threadId.length}T09:00:00.000Z`,
    unread,
  });
}

function allThreads() {
  const data = readMailData();
  return [...data.needsYou, ...data.fyi, ...data.lowPriority];
}

function fakeDeps(overrides: Partial<MailActionDeps> = {}): MailActionDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    canModify: async () => true,
    setThreadRead: async (id, read) => {
      calls.push(`${read ? "read" : "unread"}:${id}`);
    },
    trashThread: async (id) => {
      calls.push(`trash:${id}`);
    },
    archiveThread: async (id) => {
      calls.push(`archive:${id}`);
    },
    profileThread: async (id) => {
      calls.push(`profile:${id}`);
    },
    ...overrides,
  };
}

before(() => {
  mailDatabase();
  seed("a1", "alerts@sentry.io");
  seed("a2", "billing@sentry.io");
  seed("b1", "gavin@example.com");
  seed("c1", "news@letter.com");
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("corrections", () => {
  it("moves a thread to the corrected bucket and keeps earlier fields when only one changes", () => {
    storeCorrection("a1", { bucket: "low_priority" });
    storeCorrection("a1", { category: "notification" });

    const thread = allThreads().find((entry) => entry.threadId === "a1");
    assert.equal(thread?.userBucket, "low_priority");
    assert.equal(thread?.userCategory, "notification");
    assert.ok(readMailData().lowPriority.some((entry) => entry.threadId === "a1"));
  });

  it("offers same-sender examples first, then same-domain, and never the thread itself", () => {
    storeCorrection("c1", { bucket: "low_priority" });
    storeCorrection("a2", { bucket: "fyi" });

    const forSentryAlert = listCorrectionExamples("alerts@sentry.io", 5, "zz");
    assert.equal(forSentryAlert[0].fromEmail, "alerts@sentry.io");
    assert.equal(forSentryAlert[1].fromEmail, "billing@sentry.io");

    const excluded = listCorrectionExamples("alerts@sentry.io", 5, "a1");
    assert.ok(excluded.every((example) => example.fromEmail !== "alerts@sentry.io"));
  });

  it("clears a correction back to Jev's judgment", () => {
    clearCorrection("a2");
    assert.equal(allThreads().find((entry) => entry.threadId === "a2")?.userBucket, undefined);
  });
});

describe("markThreadsRead", () => {
  it("marks read in Gmail, then locally", async () => {
    const deps = fakeDeps();
    const result = await markThreadsRead(["b1"], true, deps);

    assert.deepEqual(result, { succeeded: 1, failed: 0 });
    assert.deepEqual(deps.calls, ["read:b1"]);
    assert.equal(allThreads().find((entry) => entry.threadId === "b1")?.unread, false);
  });

  it("refuses under a read-only grant without touching anything", async () => {
    const deps = fakeDeps({ canModify: async () => false });
    await assert.rejects(() => markThreadsRead(["c1"], true, deps), /read-only/);
    assert.deepEqual(deps.calls, []);
    assert.equal(allThreads().find((entry) => entry.threadId === "c1")?.unread, true);
  });

  it("leaves a thread unread locally when Gmail rejects the change", async () => {
    const deps = fakeDeps({
      setThreadRead: async () => {
        throw new Error("Gmail said no");
      },
    });
    const result = await markThreadsRead(["c1"], true, deps);

    assert.deepEqual(result, { succeeded: 0, failed: 1 });
    assert.equal(allThreads().find((entry) => entry.threadId === "c1")?.unread, true);
  });
});

describe("trashThreads", () => {
  it("trashes in Gmail and drops the thread from the Inbox; unknown ids are ignored", async () => {
    const deps = fakeDeps();
    const result = await trashThreads(["c1", "not-a-thread"], deps);

    assert.deepEqual(result, { succeeded: 1, failed: 0 });
    assert.deepEqual(deps.calls, ["trash:c1"]);
    assert.equal(allThreads().some((entry) => entry.threadId === "c1"), false);
  });
});

describe("archive (Done)", () => {
  it("archives in Gmail and drops the thread from AgentOS", async () => {
    const deps = fakeDeps();
    const result = await runBulkAction("archive", ["b1"], deps);

    assert.deepEqual(result, { succeeded: 1, failed: 0 });
    assert.deepEqual(deps.calls, ["archive:b1"]);
    assert.equal(allThreads().some((entry) => entry.threadId === "b1"), false);
  });
});

describe("runBulkAction", () => {
  it("re-profiles only visible threads", async () => {
    const deps = fakeDeps();
    await runBulkAction("reprofile", ["a1", "c1"], deps);
    assert.deepEqual(deps.calls, ["profile:a1"]);
  });
});
