import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-compose-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const { buildComposedMessage, normalizeAddress, safeFilename } = await import("../compose-mime");
const { composeMail, discardSavedDraft, listOutbox, replyContextFor, retagOutboxItem, sendSavedDraft } = await import("../compose");
const { MailComposeRequestSchema } = await import("../../../shared/mail-compose-types");
const { MimeError } = await import("../../outreach/mime");
const { GmailError } = await import("../gmail-client");
type ComposeDeps = import("../compose").ComposeDeps;

before(() => {
  mailDatabase();
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  mailDatabase().exec("DELETE FROM mail_outbox");
});

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

interface Recorded {
  sent: { raw: string; threadId?: string }[];
  drafts: { raw: string; threadId?: string }[];
  sentDrafts: string[];
  deleted: string[];
  labels: { messageId: string; add: readonly string[]; remove: readonly string[] }[];
  created: string[];
}

function fakeDeps(overrides: Partial<ComposeDeps> = {}): { deps: ComposeDeps; recorded: Recorded } {
  const recorded: Recorded = { sent: [], drafts: [], sentDrafts: [], deleted: [], labels: [], created: [] };
  const deps: ComposeDeps = {
    sendMessage: async (raw, threadId) => {
      recorded.sent.push({ raw, threadId });
      return { messageId: `msg-${recorded.sent.length}`, threadId: threadId ?? "thread-new" };
    },
    saveDraft: async (raw, threadId) => {
      recorded.drafts.push({ raw, threadId });
      return { draftId: `draft-${recorded.drafts.length}`, messageId: "draft-msg", threadId };
    },
    sendDraft: async (draftId) => {
      recorded.sentDrafts.push(draftId);
      return { messageId: "msg-from-draft", threadId: "thread-draft" };
    },
    deleteDraft: async (draftId) => {
      recorded.deleted.push(draftId);
    },
    ensureLabel: async (name) => {
      recorded.created.push(name);
      return `label-${name.toLowerCase()}`;
    },
    labelMessage: async (messageId, add, remove = []) => {
      recorded.labels.push({ messageId, add, remove });
    },
    replyContext: async () => ({
      messageId: "<original@mail.example.com>",
      subject: "Quote for the website",
      fromEmail: "client@example.com",
      toEmails: ["me@example.com"],
    }),
    mailboxAddress: async () => "me@example.com",
    now: () => new Date("2026-10-05T09:00:00.000Z"),
    ...overrides,
  };
  return { deps, recorded };
}

function request(overrides: Record<string, unknown> = {}) {
  return MailComposeRequestSchema.parse({
    mode: "send",
    to: ["client@example.com"],
    subject: "Your quote",
    body: "Hi,\n\nThe quote is attached.\n\nThanks",
    ...overrides,
  });
}

describe("buildComposedMessage", () => {
  it("builds a plain message with several recipients, Cc and Bcc", () => {
    const message = buildComposedMessage({
      to: ["a@example.com", "Bee <b@example.com>"],
      cc: ["c@example.com"],
      bcc: ["d@example.com"],
      subject: "Hello",
      body: "Line one\nLine two",
    });
    assert.match(message, /^To: a@example\.com, b@example\.com\r\n/);
    assert.match(message, /\r\nCc: c@example\.com\r\n/);
    assert.match(message, /\r\nBcc: d@example\.com\r\n/);
    assert.match(message, /Content-Type: text\/plain; charset="UTF-8"/);
    assert.doesNotMatch(message, /multipart/);
  });

  it("refuses an address that could inject a header", () => {
    assert.throws(
      () => buildComposedMessage({ to: ["a@example.com\r\nBcc: evil@example.com"], subject: "Hi", body: "x" }),
      MimeError,
    );
    assert.throws(() => buildComposedMessage({ to: ["a@example.com"], subject: "Hi\r\nBcc: evil@example.com", body: "x" }), MimeError);
  });

  it("refuses a message with no recipients or no subject", () => {
    assert.throws(() => buildComposedMessage({ to: [], subject: "Hi", body: "x" }), /recipient/);
    assert.throws(() => buildComposedMessage({ to: ["a@example.com"], subject: "  ", body: "x" }), /subject/);
  });

  it("attaches files as multipart/mixed with safe names", () => {
    const data = Buffer.from("%PDF-1.4 fake").toString("base64");
    const message = buildComposedMessage({
      to: ["a@example.com"],
      subject: "Files",
      body: "See attached",
      attachments: [
        { filename: "../../etc/quote\".pdf", mimeType: "application/pdf", data },
        { filename: "notes.txt", mimeType: "text/plain\r\nX-Evil: 1", data },
      ],
    });
    const boundary = message.match(/boundary="([^"]+)"/)?.[1];
    assert.ok(boundary);
    assert.equal(message.split(`--${boundary}\r\n`).length - 1, 3, "one text part and two attachments");
    assert.ok(message.trimEnd().endsWith(`--${boundary}--`));
    assert.match(message, /Content-Disposition: attachment; filename="quote\.pdf"/);
    // A header-injecting MIME type is replaced, never passed through.
    assert.doesNotMatch(message, /X-Evil/);
    assert.match(message, /Content-Type: application\/octet-stream; name="notes\.txt"/);
  });

  it("refuses a file type Gmail blocks", () => {
    assert.throws(
      () => buildComposedMessage({ to: ["a@example.com"], subject: "Hi", body: "x", attachments: [{ filename: "setup.exe", mimeType: "application/octet-stream", data: "AA==" }] }),
      /does not allow/,
    );
  });

  it("threads a reply with In-Reply-To and References", () => {
    const message = buildComposedMessage({ to: ["a@example.com"], subject: "Re: Hi", body: "x", inReplyTo: "<abc@example.com>" });
    assert.match(message, /In-Reply-To: <abc@example\.com>\r\nReferences: <abc@example\.com>/);
  });

  it("normalizes display-name addresses and cleans file names", () => {
    assert.equal(normalizeAddress(' "Gavin" <gavin@example.com> '), "gavin@example.com");
    assert.equal(safeFilename("C:\\Users\\me\\report.pdf"), "report.pdf");
    assert.equal(safeFilename('""'), "attachment");
  });
});

describe("MailComposeRequestSchema", () => {
  it("requires a recipient and limits attachment size", () => {
    assert.equal(MailComposeRequestSchema.safeParse({ mode: "send", subject: "Hi", body: "x" }).success, false);
    const huge = "A".repeat(25 * 1024 * 1024);
    const parsed = MailComposeRequestSchema.safeParse({
      mode: "send",
      to: ["a@example.com"],
      subject: "Hi",
      body: "x",
      attachments: [{ filename: "big.bin", data: huge }],
    });
    assert.equal(parsed.success, false);
  });
});

describe("composeMail", () => {
  it("sends, labels a Business email in Gmail, and records it without the body", async () => {
    const { deps, recorded } = fakeDeps();
    const result = await composeMail(request({ tag: "business" }), deps);

    assert.equal(recorded.sent.length, 1);
    assert.match(decodeRaw(recorded.sent[0].raw), /Subject: Your quote/);
    assert.deepEqual(recorded.labels, [{ messageId: "msg-1", add: ["label-business"], remove: [] }]);
    assert.equal(result.item.kind, "sent");
    assert.equal(result.item.tag, "business");
    assert.equal(result.item.labelApplied, true);
    assert.equal(result.warning, undefined);

    const columns = (mailDatabase().prepare("PRAGMA table_info(mail_outbox)").all() as { name: string }[]).map((column) => column.name);
    assert.ok(!columns.some((name) => /body|content/.test(name)), "the outbox never stores a body");
  });

  it("applies no label to a normal email", async () => {
    const { deps, recorded } = fakeDeps();
    await composeMail(request(), deps);
    assert.equal(recorded.labels.length, 0);
    assert.equal(recorded.created.length, 0);
  });

  it("reports a label failure as a warning, not a failed send", async () => {
    const { deps } = fakeDeps({
      labelMessage: async () => {
        throw new GmailError("Gmail responded with 500.", "failed");
      },
    });
    const result = await composeMail(request({ tag: "virtara" }), deps);
    assert.equal(result.item.kind, "sent");
    assert.equal(result.item.labelApplied, false);
    assert.match(result.warning ?? "", /Sent, but/);
  });

  it("threads a reply into the original conversation", async () => {
    const { deps, recorded } = fakeDeps();
    await composeMail(request({ replyToThreadId: "thread-42", subject: "Re: Quote for the website" }), deps);
    assert.equal(recorded.sent[0].threadId, "thread-42");
    assert.match(decodeRaw(recorded.sent[0].raw), /In-Reply-To: <original@mail\.example\.com>/);
  });

  it("saves a draft and labels it only when it is sent", async () => {
    const { deps, recorded } = fakeDeps();
    const saved = await composeMail(request({ mode: "draft", tag: "business" }), deps);
    assert.equal(saved.item.kind, "draft");
    assert.equal(recorded.labels.length, 0);

    const sent = await sendSavedDraft(saved.item.id, deps);
    assert.deepEqual(recorded.sentDrafts, ["draft-1"]);
    assert.equal(sent.item.kind, "sent");
    assert.equal(sent.item.labelApplied, true);
    assert.deepEqual(recorded.labels, [{ messageId: "msg-from-draft", add: ["label-business"], remove: [] }]);
  });

  it("discards a draft in Gmail and forgets it", async () => {
    const { deps, recorded } = fakeDeps();
    const saved = await composeMail(request({ mode: "draft" }), deps);
    await discardSavedDraft(saved.item.id, deps);
    assert.deepEqual(recorded.deleted, ["draft-1"]);
    assert.equal(listOutbox().length, 0);
  });

  it("retags sent mail, swapping the Gmail label", async () => {
    const { deps, recorded } = fakeDeps();
    const sent = await composeMail(request({ tag: "business" }), deps);
    recorded.labels.length = 0;

    const retagged = await retagOutboxItem(sent.item.id, "virtara", deps);
    assert.equal(retagged.item.tag, "virtara");
    assert.deepEqual(recorded.labels, [{ messageId: "msg-1", add: ["label-virtara"], remove: ["label-business"] }]);

    await retagOutboxItem(sent.item.id, "normal", deps);
    assert.deepEqual(recorded.labels.at(-1), { messageId: "msg-1", add: [], remove: ["label-virtara"] });
  });

  it("filters the outbox by tag", async () => {
    const { deps } = fakeDeps();
    await composeMail(request({ tag: "business" }), deps);
    await composeMail(request({ tag: "virtara" }), deps);
    await composeMail(request(), deps);
    assert.equal(listOutbox().length, 3);
    assert.deepEqual(listOutbox("business").map((item) => item.tag), ["business"]);
    assert.deepEqual(listOutbox("normal").map((item) => item.tag), ["normal"]);
  });
});

describe("replyContextFor", () => {
  it("replies to the sender, or to Reply-To when there is one", async () => {
    const { deps } = fakeDeps();
    assert.deepEqual(await replyContextFor("t", deps), { to: "client@example.com", subject: "Re: Quote for the website" });

    const withReplyTo = fakeDeps({
      replyContext: async () => ({ subject: "Re: Hi", fromEmail: "noreply@example.com", replyToEmail: "help@example.com", toEmails: [] }),
    });
    assert.deepEqual(await replyContextFor("t", withReplyTo.deps), { to: "help@example.com", subject: "Re: Hi" });
  });

  it("continues to the other party when the latest message was mine", async () => {
    const { deps } = fakeDeps({
      replyContext: async () => ({ subject: "Proposal", fromEmail: "me@example.com", toEmails: ["client@example.com"] }),
    });
    assert.equal((await replyContextFor("t", deps)).to, "client@example.com");
  });
});
