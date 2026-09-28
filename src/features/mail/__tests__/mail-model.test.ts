import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "@shared/mail-types";
import { lowPriorityCountdown, threadInitial, threadSender, threadTags } from "../mail-model";

function thread(overrides: Partial<MailThread>): MailThread {
  return {
    threadId: "t1",
    subject: "Subject",
    snippet: "Snippet",
    messageDate: "2026-09-23T09:00:00.000Z",
    classified: true,
    unread: false,
    ...overrides,
  };
}

describe("threadSender", () => {
  it("prefers the display name", () => {
    assert.equal(threadSender(thread({ fromName: "Gavin", fromEmail: "gavin@example.com" })), "Gavin");
  });

  it("falls back to the address", () => {
    assert.equal(threadSender(thread({ fromEmail: "gavin@example.com" })), "gavin@example.com");
  });

  it("falls back to a label when neither is known", () => {
    assert.equal(threadSender(thread({})), "Unknown sender");
  });
});

describe("threadInitial", () => {
  it("takes the first letter of the sender's name", () => {
    assert.equal(threadInitial(thread({ fromName: "gavin" })), "G");
  });
});

describe("threadTags", () => {
  it("shows a single tag for an unclassified thread", () => {
    assert.deepEqual(threadTags(thread({ classified: false })), [
      { label: "NOT YET CLASSIFIED", tone: "muted" },
    ]);
  });

  it("shows the category and reply-needed tags together", () => {
    assert.deepEqual(threadTags(thread({ category: "client", needsReply: 0.9 })), [
      { label: "CLIENT", tone: "client" },
      { label: "REPLY NEEDED", tone: "reply" },
    ]);
  });

  it("shows no-reply for a financial thread with no reply needed", () => {
    assert.deepEqual(
      threadTags(thread({ category: "finance", needsReply: 0.1, financial: 0.9 })),
      [
        { label: "FINANCE", tone: "finance" },
        { label: "NO REPLY", tone: "noreply" },
      ],
    );
  });

  it("shows only the category for a low-priority thread", () => {
    assert.deepEqual(threadTags(thread({ category: "newsletter", needsReply: 0, financial: 0 })), [
      { label: "NEWSLETTER", tone: "muted" },
    ]);
  });
});

describe("threadTags with corrections and automated mail", () => {
  it("does not ask for a reply to an automated alert, but flags an action", () => {
    assert.deepEqual(
      threadTags(thread({ category: "notification", needsReply: 0.9, automated: 0.9, actionRequired: 0.7 })).map(
        (tag) => tag.label,
      ),
      ["NOTIFICATION", "ACTION NEEDED"],
    );
  });

  it("shows the corrected category and marks it as set by you", () => {
    assert.deepEqual(
      threadTags(thread({ category: "admin", userCategory: "finance", userBucket: "fyi", needsReply: 0.9 })).map(
        (tag) => tag.label,
      ),
      ["FINANCE", "SET BY YOU"],
    );
  });

  it("shows a correction even before Jev has classified the thread", () => {
    assert.deepEqual(
      threadTags(thread({ classified: false, userBucket: "needs_you" })).map((tag) => tag.label),
      ["SET BY YOU"],
    );
  });
});

describe("lowPriorityCountdown", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("is absent for a thread that isn't on the Low priority clock", () => {
    assert.equal(lowPriorityCountdown(thread({}), now), undefined);
  });

  it("counts down the 24 hours from when it became Low priority, rounded up", () => {
    assert.equal(lowPriorityCountdown(thread({ lowPrioritySince: "2026-09-28T06:30:00.000Z" }), now), "TRASH IN 19H");
  });

  it("says within the hour at the end, including when a clean-up run is due", () => {
    assert.equal(lowPriorityCountdown(thread({ lowPrioritySince: "2026-09-27T12:30:00.000Z" }), now), "TRASH WITHIN THE HOUR");
    assert.equal(lowPriorityCountdown(thread({ lowPrioritySince: "2026-09-26T12:00:00.000Z" }), now), "TRASH WITHIN THE HOUR");
  });
});
