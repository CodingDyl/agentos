import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

// Fakes only: no SMTP or IMAP server is ever contacted.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-titan-compose-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const { withoutBccHeader } = await import("../compose-mime");
const { chooseSendAccount, composeMail, discardSavedDraft, replyContextFor, retagOutboxItem, sendSavedDraft, OutboxNotFoundError } = await import("../compose");
const { MailComposeRequestSchema } = await import("../../../shared/mail-compose-types");
const { TitanDraftMissingError, TitanError } = await import("../titan-client");
type ComposeDeps = import("../compose").ComposeDeps;
type TitanComposeDeps = import("../compose").TitanComposeDeps;

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

const ADDRESS = "dylanpetzer@virtara.co.za";

interface TitanRecord {
  sent: { raw: string; from: string; to: readonly string[] }[];
  appended: string[];
  drafts: Map<string, string>;
  deleted: string[];
}

function fakes(options: { linked?: boolean; appendFails?: boolean } = {}) {
  const titanRecord: TitanRecord = { sent: [], appended: [], drafts: new Map(), deleted: [] };
  const gmailSent: string[] = [];
  const titan: TitanComposeDeps = {
    address: async () => (options.linked === false ? undefined : ADDRESS),
    send: async (raw, envelope) => void titanRecord.sent.push({ raw, from: envelope.from, to: envelope.to }),
    appendSent: async (raw) => {
      if (options.appendFails) throw new Error("NO [OVERQUOTA]");
      titanRecord.appended.push(raw);
    },
    saveDraft: async (raw) => {
      const ref = `77:${titanRecord.drafts.size + 1}`;
      titanRecord.drafts.set(ref, raw);
      return ref;
    },
    readDraft: async (ref) => {
      const raw = titanRecord.drafts.get(ref);
      if (!raw) throw new TitanDraftMissingError();
      return raw;
    },
    deleteDraft: async (ref) => {
      titanRecord.deleted.push(ref);
      titanRecord.drafts.delete(ref);
    },
    replyContext: async () => ({ messageId: "<orig@client.com>", subject: "Quote", fromEmail: "ana@client.com", toEmails: [ADDRESS] }),
  };
  const deps: ComposeDeps = {
    sendMessage: async (raw) => {
      gmailSent.push(raw);
      return { messageId: "gmail-1", threadId: "thread-1" };
    },
    saveDraft: async () => ({ draftId: "d1" }),
    sendDraft: async () => ({ messageId: "gmail-2" }),
    deleteDraft: async () => undefined,
    ensureLabel: async (name) => `label-${name}`,
    labelMessage: async () => undefined,
    replyContext: async () => ({ messageId: "<g@mail.gmail.com>", subject: "Hi", fromEmail: "x@y.com", toEmails: [] }),
    mailboxAddress: async () => "me@gmail.com",
    now: () => new Date("2026-10-06T10:00:00Z"),
    titan,
  };
  return { deps, titanRecord, gmailSent };
}

function request(overrides: Record<string, unknown> = {}) {
  return MailComposeRequestSchema.parse({
    mode: "send",
    to: ["ana@client.com"],
    bcc: ["secret@hidden.com"],
    subject: "Proposal",
    body: "Hi Ana,\nAttached.",
    tag: "virtara",
    ...overrides,
  });
}

describe("choosing the sending mailbox", () => {
  it("follows the choice, then the reply's mailbox, then the Virtara tag", () => {
    assert.equal(chooseSendAccount({ from: "gmail", tag: "virtara" }, true), "gmail");
    assert.equal(chooseSendAccount({ replyToThreadId: "titan:1:2", tag: "normal" }, true), "titan");
    assert.equal(chooseSendAccount({ replyToThreadId: "18abc", tag: "virtara" }, true), "gmail");
    assert.equal(chooseSendAccount({ tag: "virtara" }, true), "titan");
    assert.equal(chooseSendAccount({ tag: "virtara" }, false), "gmail");
    assert.equal(chooseSendAccount({ tag: "business" }, true), "gmail");
  });
});

describe("sending from the Virtara mailbox", () => {
  it("sends over SMTP without the Bcc header, delivers to Bcc, and files the full copy in Sent", async () => {
    const { deps, titanRecord, gmailSent } = fakes();
    const result = await composeMail(request(), deps);

    assert.equal(gmailSent.length, 0);
    assert.equal(titanRecord.sent.length, 1);
    const [sent] = titanRecord.sent;
    assert.equal(sent.from, ADDRESS);
    assert.deepEqual(sent.to, ["ana@client.com", "secret@hidden.com"]);
    assert.match(sent.raw, /^From: dylanpetzer@virtara\.co\.za\r\n/);
    assert.match(sent.raw, /\r\nMessage-ID: <[0-9a-f-]+@virtara\.co\.za>\r\n/);
    assert.match(sent.raw, /\r\nDate: Tue, 06 Oct 2026 10:00:00 \+0000\r\n/);
    assert.doesNotMatch(sent.raw, /secret@hidden\.com/);
    assert.equal(titanRecord.appended.length, 1);
    assert.match(titanRecord.appended[0], /\r\nBcc: secret@hidden\.com\r\n/);

    assert.equal(result.item.account, "titan");
    assert.equal(result.item.kind, "sent");
    assert.equal(result.item.labelApplied, true);
    assert.equal(result.warning, undefined);
  });

  it("still records the email, with a warning, when the Sent copy fails", async () => {
    const { deps } = fakes({ appendFails: true });
    const result = await composeMail(request(), deps);
    assert.equal(result.item.kind, "sent");
    assert.match(result.warning ?? "", /Sent folder/);
  });

  it("sends a Virtara-tagged email from Gmail when Gmail is chosen", async () => {
    const { deps, titanRecord, gmailSent } = fakes();
    const result = await composeMail(request({ from: "gmail" }), deps);
    assert.equal(titanRecord.sent.length, 0);
    assert.equal(gmailSent.length, 1);
    assert.equal(result.item.account, "gmail");
  });

  it("refuses to send from Virtara when it is not linked", async () => {
    const { deps } = fakes({ linked: false });
    await assert.rejects(composeMail(request({ from: "titan" }), deps), (error) => error instanceof TitanError);
  });

  it("answers a Virtara thread from Virtara, threaded on its Message-ID", async () => {
    const { deps, titanRecord } = fakes();
    await composeMail(request({ tag: "normal", replyToThreadId: "titan:5:9", subject: "Re: Quote" }), deps);
    assert.match(titanRecord.sent[0].raw, /\r\nIn-Reply-To: <orig@client\.com>\r\n/);
    assert.deepEqual(await replyContextFor("titan:5:9", deps), { to: "ana@client.com", subject: "Re: Quote" });
  });
});

describe("Virtara drafts", () => {
  it("saves to Titan's Drafts, then sends it as it stands there and removes the draft", async () => {
    const { deps, titanRecord } = fakes();
    const saved = await composeMail(request({ mode: "draft" }), deps);
    assert.equal(saved.item.kind, "draft");
    assert.equal(saved.item.account, "titan");
    assert.equal(titanRecord.sent.length, 0);

    const sent = await sendSavedDraft(saved.item.id, deps);
    assert.equal(sent.item.kind, "sent");
    assert.deepEqual(titanRecord.sent[0].to, ["ana@client.com", "secret@hidden.com"]);
    assert.doesNotMatch(titanRecord.sent[0].raw, /secret@hidden\.com/);
    assert.deepEqual(titanRecord.deleted, ["77:1"]);
    assert.equal(titanRecord.appended.length, 1);
  });

  it("forgets a draft that is gone from Titan", async () => {
    const { deps, titanRecord } = fakes();
    const saved = await composeMail(request({ mode: "draft" }), deps);
    titanRecord.drafts.clear();
    await assert.rejects(sendSavedDraft(saved.item.id, deps), (error) => error instanceof OutboxNotFoundError);
    assert.equal(mailDatabase().prepare("SELECT COUNT(*) AS n FROM mail_outbox").get()?.n, 0);
  });

  it("discards a draft in Titan and retags Virtara mail locally", async () => {
    const { deps, titanRecord } = fakes();
    const saved = await composeMail(request({ mode: "draft" }), deps);
    await discardSavedDraft(saved.item.id, deps);
    assert.deepEqual(titanRecord.deleted, ["77:1"]);

    const sent = await composeMail(request(), deps);
    const retagged = await retagOutboxItem(sent.item.id, "business", deps);
    assert.equal(retagged.item.tag, "business");
    assert.equal(retagged.item.labelApplied, true);
  });
});

describe("withoutBccHeader", () => {
  it("drops Bcc and its folded lines, and leaves the body alone", () => {
    const raw = "To: a@b.co\r\nBcc: x@y.co,\r\n z@y.co\r\nSubject: Hi\r\n\r\nBcc: stays in the body\r\n";
    assert.equal(withoutBccHeader(raw), "To: a@b.co\r\nSubject: Hi\r\n\r\nBcc: stays in the body\r\n");
  });
});
