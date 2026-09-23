import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "@shared/mail-types";
import { threadInitial, threadSender, threadTags } from "../mail-model";

function thread(overrides: Partial<MailThread>): MailThread {
  return {
    threadId: "t1",
    subject: "Subject",
    snippet: "Snippet",
    messageDate: "2026-09-23T09:00:00.000Z",
    classified: true,
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
