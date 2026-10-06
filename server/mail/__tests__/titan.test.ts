import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { MailActionDeps } from "../actions";
import type { ThreadSummaryInput } from "../store";

// Never a real mailbox: every Titan call here is a fake, and the state directory is a temporary one.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-titan-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const store = await import("../store");
store.mailClock.now = () => new Date("2026-09-28T12:00:00.000Z");
const { readMailData, insertThreadIfNew } = store;
const { runMailSync } = await import("../sync");
const { markThreadsRead } = await import("../actions");
const { cleanExpiredLowPriority } = await import("../auto-clean");
const credentials = await import("../titan-credentials");
const { summaryFromMessage, plainTextOf, describeTitanError, TitanError } = await import("../titan-client");
const { mailAccountOf, parseTitanThreadId, titanThreadId, TitanConnectRequestSchema } = await import("../../../shared/mail-account-types");

before(() => {
  mailDatabase();
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

function summary(threadId: string, date = "2026-09-25T09:00:00.000Z"): ThreadSummaryInput {
  return { threadId, fromEmail: "client@example.com", subject: `About ${threadId}`, snippet: "Hello", messageDate: date, unread: true };
}

function allThreads() {
  const data = readMailData();
  return [...data.needsYou, ...data.fyi, ...data.lowPriority];
}

describe("Titan thread ids", () => {
  it("round-trips and never collides with a Gmail id", () => {
    const id = titanThreadId("1700000000", 42);
    assert.equal(id, "titan:1700000000:42");
    assert.deepEqual(parseTitanThreadId(id), { uidValidity: "1700000000", uid: 42 });
    assert.equal(mailAccountOf(id), "titan");
    assert.equal(mailAccountOf("18c2f0a1b2c3d4e5"), "gmail");
    assert.equal(parseTitanThreadId("titan:abc:1"), undefined);
    assert.equal(parseTitanThreadId("18c2f0a1b2c3d4e5"), undefined);
  });
});

describe("Titan login form", () => {
  it("fills in Titan's TLS servers and lowercases the address", () => {
    const parsed = TitanConnectRequestSchema.parse({ address: " DylanPetzer@Virtara.co.za ", password: "secret" });
    assert.equal(parsed.address, "dylanpetzer@virtara.co.za");
    assert.equal(parsed.imapHost, "imap.titan.email");
    assert.equal(parsed.imapPort, 993);
    assert.equal(parsed.smtpHost, "smtp.titan.email");
    assert.equal(parsed.smtpPort, 465);
  });

  it("refuses a server name that is not a host name", () => {
    assert.equal(TitanConnectRequestSchema.safeParse({ address: "a@b.co", password: "x", imapHost: "evil.com/path" }).success, false);
    assert.equal(TitanConnectRequestSchema.safeParse({ address: "a@b.co", password: "x", imapHost: "-bad.example.com" }).success, false);
  });
});

describe("Titan credentials", () => {
  it("seals and opens a secret, and refuses a tampered one", () => {
    const key = crypto.randomBytes(32);
    const sealed = credentials.sealSecret("p@ss word", key);
    assert.equal(credentials.openSecret(sealed, key), "p@ss word");
    const tampered = { ...sealed, data: Buffer.from("other").toString("base64") };
    assert.throws(() => credentials.openSecret(tampered, key));
    assert.throws(() => credentials.openSecret(sealed, crypto.randomBytes(32)));
  });

  it("stores the password sealed, private to this user, and reads it back", async () => {
    await credentials.saveTitanCredentials(
      TitanConnectRequestSchema.parse({ address: "dylanpetzer@virtara.co.za", password: "very-secret-password" }),
    );
    const file = path.join(directory, "titan-mail.json");
    const raw = fs.readFileSync(file, "utf8");
    assert.equal(raw.includes("very-secret-password"), false, "the password must never be on disk in the clear");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.join(directory, "mail-secret.key")).mode & 0o777, 0o600);
    }
    const visible = await credentials.titanAccount();
    assert.equal(visible?.address, "dylanpetzer@virtara.co.za");
    assert.equal("password" in (visible ?? {}), false);
    assert.equal((await credentials.readTitanCredentials())?.password, "very-secret-password");

    await credentials.forgetTitanCredentials();
    assert.equal(await credentials.titanAccount(), undefined);
  });
});

describe("Titan message parsing", () => {
  it("builds a summary from an IMAP envelope", () => {
    const result = summaryFromMessage(
      "titan:1:7",
      {
        envelope: { date: new Date("2026-09-20T08:00:00Z"), subject: " Quote request ", from: [{ name: "Ana", address: "Ana@Client.com" }] },
        flags: new Set(["\\Seen"]),
      },
      "  Hi Dylan,\n\n  could you   send a quote?  ",
    );
    assert.deepEqual(result, {
      threadId: "titan:1:7",
      fromName: "Ana",
      fromEmail: "ana@client.com",
      subject: "Quote request",
      snippet: "Hi Dylan, could you send a quote?",
      messageDate: "2026-09-20T08:00:00.000Z",
      unread: false,
    });
  });

  it("marks a message without the Seen flag unread and names a missing subject", () => {
    const result = summaryFromMessage("titan:1:8", { envelope: {}, flags: new Set(), internalDate: new Date("2026-09-21T08:00:00Z") }, undefined);
    assert.equal(result.unread, true);
    assert.equal(result.subject, "(no subject)");
    assert.equal(result.messageDate, "2026-09-21T08:00:00.000Z");
  });

  it("falls back to HTML without its tags or scripts", () => {
    assert.equal(plainTextOf({ text: "plain" }), "plain");
    assert.equal(plainTextOf({ html: "<p>Hi &amp; bye</p><script>alert(1)</script>" }), "Hi & bye");
    assert.equal(plainTextOf({ html: false }), undefined);
  });

  it("explains a refused login without echoing anything sensitive", () => {
    const error = describeTitanError(Object.assign(new Error("Command failed"), { authenticationFailed: true }));
    assert.ok(error instanceof TitanError);
    assert.equal(error.reason, "unauthorized");
    assert.equal(describeTitanError(Object.assign(new Error("x"), { code: "ENOTFOUND" })).reason, "offline");
  });
});

describe("syncing Gmail and the Virtara mailbox together", () => {
  it("stores both, labels each thread with its account, and keeps going when one mailbox fails", async () => {
    const titanIds = [titanThreadId("9", 2), titanThreadId("9", 1)];
    const result = await runMailSync({
      sources: [
        { account: "gmail", listInboxThreadIds: async () => { throw new Error("Gmail is offline"); }, getThreadSummary: async (id) => summary(id) },
        { account: "titan", listInboxThreadIds: async () => titanIds, getThreadSummary: async (id) => summary(id), listUnreadInboxThreadIds: async () => new Set([titanIds[0]]) },
      ],
    });
    assert.equal(result.added, 2);
    assert.deepEqual(result.warnings, ["Gmail: Gmail is offline"]);

    const threads = allThreads();
    assert.deepEqual(threads.map((thread) => thread.account).sort(), ["titan", "titan"]);
    assert.equal(threads.find((thread) => thread.threadId === titanIds[1])?.unread, false);

    const again = await runMailSync({
      sources: [
        { account: "gmail", listInboxThreadIds: async () => ["g1"], getThreadSummary: async (id) => summary(id) },
        { account: "titan", listInboxThreadIds: async () => titanIds, getThreadSummary: async () => assert.fail("already cached") },
      ],
    });
    assert.equal(again.added, 1);
    assert.equal(again.warnings, undefined);
    assert.equal(allThreads().find((thread) => thread.threadId === "g1")?.account, "gmail");
  });

  it("fails the Refresh only when every mailbox fails", async () => {
    await assert.rejects(
      runMailSync({ sources: [{ account: "titan", listInboxThreadIds: async () => { throw new Error("nope"); }, getThreadSummary: async (id) => summary(id) }] }),
      /nope/,
    );
  });

  it("gives each account its own window, so a busy Gmail never hides Virtara mail", () => {
    for (let index = 0; index < 160; index += 1) {
      insertThreadIfNew(summary(`busy-${index}`, `2026-09-27T${String(index % 24).padStart(2, "0")}:00:00.000Z`));
    }
    insertThreadIfNew(summary(titanThreadId("9", 50), "2026-09-01T09:00:00.000Z"));
    const threads = allThreads();
    assert.equal(threads.filter((thread) => thread.account !== "titan").length, 150);
    assert.ok(threads.some((thread) => thread.threadId === titanThreadId("9", 50)));
  });
});

describe("actions on Virtara threads", () => {
  it("do not need Gmail's write grant", async () => {
    const id = titanThreadId("9", 2);
    const calls: string[] = [];
    const deps: MailActionDeps = {
      canModify: async () => false,
      setThreadRead: async (threadId, read) => void calls.push(`${threadId}:${read}`),
      trashThread: async () => undefined,
      archiveThread: async () => undefined,
      profileThread: async () => undefined,
    };
    assert.deepEqual(await markThreadsRead([id], true, deps), { succeeded: 1, failed: 0 });
    assert.deepEqual(calls, [`${id}:true`]);
    await assert.rejects(markThreadsRead(["g1"], true, deps), /read-only/);
  });

  it("clean-up still moves expired Virtara mail to Trash under a read-only Gmail grant", async () => {
    const trashed: string[] = [];
    const db = mailDatabase();
    db.prepare("UPDATE mail_threads SET low_priority_since = ?, classified = 1, category = 'newsletter', needs_reply = 0, urgency = 0, action_required = 0, automated = 1 WHERE thread_id IN (?, ?)")
      .run("2026-09-26T00:00:00.000Z", titanThreadId("9", 1), "g1");
    await cleanExpiredLowPriority(new Date("2026-09-28T12:00:00.000Z"), {
      canModify: async () => false,
      trashThread: async (threadId) => void trashed.push(threadId),
    });
    assert.deepEqual(trashed, [titanThreadId("9", 1)]);
  });
});
