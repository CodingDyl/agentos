import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { TitanError } from "../../mail/titan-client";
import { setVirtaraForTests, sendViaVirtara, virtaraSender } from "../virtara";

after(() => setVirtaraForTests(undefined));

const MESSAGE = {
  to: "jane@parkview.example",
  subject: "Your listing pages",
  body: "Hi Jane,\n\nOne thing.",
  from: { address: "dylan@virtara.co.za", name: "Dylan Petzer" },
};

describe("virtaraSender", () => {
  it("returns the linked address and name, and nothing when unlinked", async () => {
    setVirtaraForTests({
      account: async () => ({ address: "dylan@virtara.co.za", senderName: "Dylan Petzer" }),
    });
    assert.deepEqual(await virtaraSender(), { address: "dylan@virtara.co.za", name: "Dylan Petzer" });

    setVirtaraForTests({ account: async () => ({ address: "dylan@virtara.co.za" }) });
    assert.deepEqual(await virtaraSender(), { address: "dylan@virtara.co.za" });

    setVirtaraForTests({ account: async () => undefined });
    assert.equal(await virtaraSender(), undefined);
  });
});

describe("sendViaVirtara", () => {
  it("sends over SMTP, files Sent, and returns the Message-ID on the wire", async () => {
    const sent: { raw: string; from: string; to: readonly string[] }[] = [];
    const appended: string[] = [];
    const result = await sendViaVirtara(MESSAGE, {
      send: async (raw, envelope) => void sent.push({ raw, from: envelope.from, to: envelope.to }),
      appendSent: async (raw) => void appended.push(raw),
      now: () => new Date("2026-11-05T10:00:00Z"),
    });

    assert.match(result.messageId, /^<[0-9a-f-]+@virtara\.co\.za>$/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, "dylan@virtara.co.za");
    assert.deepEqual(sent[0].to, ["jane@parkview.example"]);
    assert.match(sent[0].raw, /^From: "Dylan Petzer" <dylan@virtara\.co\.za>\r\n/);
    assert.match(sent[0].raw, /\r\nMessage-ID: <[0-9a-f-]+@virtara\.co\.za>\r\n/);
    assert.match(sent[0].raw, /\r\nTo: jane@parkview\.example\r\n/);
    assert.equal(appended.length, 1);
    assert.equal(appended[0], sent[0].raw);
  });

  it("threads a reply with In-Reply-To when given one", async () => {
    let raw = "";
    await sendViaVirtara(
      { ...MESSAGE, inReplyTo: "<orig@mail.example>" },
      {
        send: async (value) => void (raw = value),
        appendSent: async () => undefined,
      },
    );
    assert.match(raw, /\r\nIn-Reply-To: <orig@mail\.example>\r\n/);
    assert.match(raw, /\r\nReferences: <orig@mail\.example>\r\n/);
  });

  it("still returns the Message-ID when the Sent copy fails", async () => {
    let sent = false;
    const result = await sendViaVirtara(MESSAGE, {
      send: async () => void (sent = true),
      appendSent: async () => {
        throw new Error("NO [OVERQUOTA]");
      },
    });
    assert.equal(sent, true);
    assert.match(result.messageId, /@virtara\.co\.za>$/);
  });

  it("propagates an SMTP failure and does not file Sent", async () => {
    let appended = false;
    await assert.rejects(
      sendViaVirtara(MESSAGE, {
        send: async () => {
          throw new TitanError("Titan would not send that email (SMTP 550).", "failed");
        },
        appendSent: async () => void (appended = true),
      }),
      (error: unknown) => error instanceof TitanError && error.reason === "failed",
    );
    assert.equal(appended, false);
  });
});
