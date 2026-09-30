import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-autoclean-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const { insertThreadIfNew, readMailData, refreshLowPriorityClock, storeClassification, storeCorrection } =
  await import("../store");

// The Inbox shows one month of mail; pin "now" so these fixed-date fixtures stay inside it.
(await import("../store")).mailClock.now = () => new Date("2026-09-28T12:00:00.000Z");
const { cleanExpiredLowPriority } = await import("../auto-clean");

const HOUR = 60 * 60 * 1000;
const t0 = new Date("2026-09-28T12:00:00.000Z");
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

function seedLowPriority(threadId: string) {
  insertThreadIfNew({ threadId, subject: threadId, snippet: "s", messageDate: "2026-09-20T09:00:00.000Z" });
  storeClassification(threadId, {
    category: "newsletter",
    needsReply: 0.05,
    urgency: 0,
    business: "none",
    financial: 0,
    actionRequired: 0.05,
    automated: 0.95,
  });
}

function visibleIds(): string[] {
  const data = readMailData();
  return [...data.needsYou, ...data.fyi, ...data.lowPriority].map((thread) => thread.threadId).sort();
}

function fakeGmail(canModify = true, failFor: string[] = []) {
  const trashed: string[] = [];
  return {
    trashed,
    deps: {
      canModify: async () => canModify,
      trashThread: async (id: string) => {
        if (failFor.includes(id)) throw new Error("Gmail said no");
        trashed.push(id);
      },
    },
  };
}

before(() => {
  mailDatabase();
  seedLowPriority("old");
  seedLowPriority("rescued");
  seedLowPriority("stubborn");
  // All three enter Low priority at t0, whatever their arrival date.
  refreshLowPriorityClock(t0);
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("Low priority clean-up", () => {
  it("counts from when a thread became Low priority, not when it arrived", async () => {
    const gmail = fakeGmail();
    const result = await cleanExpiredLowPriority(at(23), gmail.deps);
    assert.deepEqual(result, { succeeded: 0, failed: 0 });
    assert.deepEqual(gmail.trashed, []);
  });

  it("does nothing under a read-only Gmail grant", async () => {
    const gmail = fakeGmail(false);
    await cleanExpiredLowPriority(at(30), gmail.deps);
    assert.deepEqual(gmail.trashed, []);
    assert.equal(visibleIds().length, 3);
  });

  it("stops the clock for a thread moved out of Low priority", async () => {
    storeCorrection("rescued", { bucket: "fyi" });
    refreshLowPriorityClock(at(20));
    const rescued = readMailData().fyi.find((thread) => thread.threadId === "rescued");
    assert.equal(rescued?.lowPrioritySince, undefined);
  });

  it("trashes expired threads in Gmail, keeps the ones Gmail refused, and spares rescued ones", async () => {
    const gmail = fakeGmail(true, ["stubborn"]);
    const result = await cleanExpiredLowPriority(at(24), gmail.deps);

    assert.deepEqual(result, { succeeded: 1, failed: 1 });
    assert.deepEqual(gmail.trashed, ["old"]);
    assert.deepEqual(visibleIds(), ["rescued", "stubborn"]);
  });

  it("gives a thread moved back into Low priority a fresh 24 hours", async () => {
    storeCorrection("rescued", { bucket: "low_priority" });
    refreshLowPriorityClock(at(25));

    const gmail = fakeGmail();
    await cleanExpiredLowPriority(at(48), gmail.deps);
    assert.deepEqual(gmail.trashed, ["stubborn"]);

    await cleanExpiredLowPriority(at(49), gmail.deps);
    assert.deepEqual(gmail.trashed, ["stubborn", "rescued"]);
  });
});
