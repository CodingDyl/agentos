import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "../../../shared/mail-types";
import { bucketFor, buildMailBuckets } from "../bucketing";

function thread(overrides: Partial<MailThread>): MailThread {
  return {
    threadId: "t1",
    subject: "Subject",
    snippet: "Snippet",
    messageDate: "2026-09-20T09:00:00.000Z",
    classified: true,
    unread: false,
    ...overrides,
  };
}

describe("bucketFor", () => {
  it("lets a person's correction win over everything Jev said", () => {
    assert.equal(bucketFor(thread({ needsReply: 0.95, actionRequired: 0.9, userBucket: "low_priority" })), "low_priority");
    assert.equal(bucketFor(thread({ classified: false, userBucket: "needs_you" })), "needs_you");
  });

  it("does not treat an automated alert's 'reply' as needing you", () => {
    assert.equal(bucketFor(thread({ needsReply: 0.9, actionRequired: 0.1, automated: 0.95, category: "notification" })), "low_priority");
  });

  it("still surfaces an automated message that needs an action", () => {
    assert.equal(bucketFor(thread({ needsReply: 0.1, actionRequired: 0.8, automated: 0.95 })), "needs_you");
  });

  it("uses the corrected category when deciding FYI", () => {
    assert.equal(bucketFor(thread({ category: "newsletter", userCategory: "finance" })), "fyi");
  });

  it("puts an unclassified thread in fyi", () => {
    assert.equal(bucketFor(thread({ classified: false })), "fyi");
  });

  it("puts a thread that needs a reply in needs_you", () => {
    assert.equal(bucketFor(thread({ needsReply: 0.8 })), "needs_you");
  });

  it("puts a thread that requires action in needs_you, even with a low reply score", () => {
    assert.equal(
      bucketFor(thread({ needsReply: 0.1, actionRequired: 0.9 })),
      "needs_you",
    );
  });

  it("puts a financial thread with no reply needed in fyi", () => {
    assert.equal(
      bucketFor(thread({ needsReply: 0.1, financial: 0.9 })),
      "fyi",
    );
  });

  it("puts a client-category thread with no reply needed in fyi", () => {
    assert.equal(
      bucketFor(thread({ needsReply: 0.0, category: "client" })),
      "fyi",
    );
  });

  it("puts a plain newsletter in low_priority", () => {
    assert.equal(
      bucketFor(
        thread({ needsReply: 0.0, financial: 0.0, category: "newsletter" }),
      ),
      "low_priority",
    );
  });
});

describe("buildMailBuckets", () => {
  it("sorts needs_you by urgency descending, then by date descending", () => {
    const low = thread({ threadId: "low", needsReply: 0.9, urgency: 1, messageDate: "2026-09-20T09:00:00.000Z" });
    const high = thread({ threadId: "high", needsReply: 0.9, urgency: 4, messageDate: "2026-09-19T09:00:00.000Z" });
    const tieNewer = thread({ threadId: "tie-newer", needsReply: 0.9, urgency: 4, messageDate: "2026-09-21T09:00:00.000Z" });

    const { needsYou } = buildMailBuckets([low, high, tieNewer]);

    assert.deepEqual(
      needsYou.map((t) => t.threadId),
      ["tie-newer", "high", "low"],
    );
  });

  it("pins unclassified threads to the top of fyi, newest first among the rest", () => {
    const older = thread({ threadId: "older", category: "client", messageDate: "2026-09-18T09:00:00.000Z" });
    const newer = thread({ threadId: "newer", category: "finance", messageDate: "2026-09-19T09:00:00.000Z" });
    const unclassified = thread({ threadId: "unclassified", classified: false, messageDate: "2026-09-01T09:00:00.000Z" });

    const { fyi } = buildMailBuckets([older, newer, unclassified]);

    assert.deepEqual(
      fyi.map((t) => t.threadId),
      ["unclassified", "newer", "older"],
    );
  });

  it("sorts low_priority by date descending", () => {
    const older = thread({ threadId: "older", category: "newsletter", messageDate: "2026-09-18T09:00:00.000Z" });
    const newer = thread({ threadId: "newer", category: "spam", messageDate: "2026-09-19T09:00:00.000Z" });

    const { lowPriority } = buildMailBuckets([older, newer]);

    assert.deepEqual(
      lowPriority.map((t) => t.threadId),
      ["newer", "older"],
    );
  });
});
