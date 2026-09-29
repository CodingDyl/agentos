import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyInbound, isStopRequest, ownWords, type InboundMessage } from "../classify";

const context = {
  sentTo: new Set(["jane@parkview.example", "bob@old.example"]),
  prospectAddresses: new Set(["jane@parkview.example", "new@lead.example"]),
  ownAddress: "outreach@virtara-mail.co.za",
};

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { fromEmail: "jane@parkview.example", subject: "Re: your listing pages", text: "Sounds interesting, can you send pricing?", headers: {}, ...overrides };
}

describe("a reply", () => {
  it("is a reply from an address we emailed, or a prospect's address", () => {
    assert.deepEqual(classifyInbound(message(), context), { kind: "reply", address: "jane@parkview.example" });
    assert.deepEqual(classifyInbound(message({ fromEmail: "NEW@lead.example" }), context), { kind: "reply", address: "new@lead.example" });
  });

  it("is ignored from anyone else, and from a colleague at the same domain", () => {
    assert.deepEqual(classifyInbound(message({ fromEmail: "stranger@spam.example" }), context), { kind: "ignore" });
    assert.deepEqual(classifyInbound(message({ fromEmail: "other@parkview.example" }), context), { kind: "ignore" });
  });

  it("is an auto-reply when the headers or subject say so", () => {
    assert.equal(classifyInbound(message({ headers: { "auto-submitted": "auto-replied" } }), context).kind, "auto");
    assert.equal(classifyInbound(message({ headers: { precedence: "bulk" } }), context).kind, "auto");
    assert.equal(classifyInbound(message({ subject: "Automatic reply: your listing pages" }), context).kind, "auto");
    assert.equal(classifyInbound(message({ subject: "Out of office until Monday" }), context).kind, "auto");
    assert.equal(classifyInbound(message({ headers: { "auto-submitted": "no" } }), context).kind, "reply");
  });
});

describe("a forged sender", () => {
  it("is set aside when neither SPF nor DKIM passed, and let through when they did or there is no verdict", () => {
    const failed = { "authentication-results": "mx.google.com; spf=fail smtp.mailfrom=parkview.example; dkim=none; dmarc=fail" };
    assert.deepEqual(classifyInbound(message({ headers: failed }), context), { kind: "unverified", address: "jane@parkview.example" });
    assert.equal(classifyInbound(message({ text: "Stop", headers: failed }), context).kind, "unverified", "a forged stop suppresses nobody");
    assert.equal(classifyInbound(message({ headers: { "authentication-results": "mx.google.com; dkim=pass header.d=parkview.example; spf=neutral" } }), context).kind, "reply");
    assert.equal(classifyInbound(message(), context).kind, "reply");
  });
});

describe("stopping", () => {
  it("catches a plain request at the start of what they wrote", () => {
    for (const text of ["Stop", "stop.", "Please stop emailing me", "Unsubscribe", "Remove me from your list", "No thanks", "No thank you, we are sorted", "Not interested", "Do not contact me again", "don't email me", "Take me off this list"]) {
      assert.equal(isStopRequest(text), true, text);
      assert.equal(classifyInbound(message({ text }), context).kind, "stop", text);
    }
  });

  it("does not take a sentence that only contains those words", () => {
    for (const text of ["Stop by our office on Tuesday?", "Can you send a quote? No rush.", "I would not stop now, tell me more"]) {
      assert.equal(isStopRequest(text), false, text);
    }
  });

  it("reads only their own words, not the quoted email under them", () => {
    const text = "Sounds good, tell me more.\n\nOn Tue, 3 Oct 2026 at 10:00, Dylan <outreach@virtara-mail.co.za> wrote:\n> Reply STOP and I will not email you again.";
    assert.equal(ownWords(text), "Sounds good, tell me more.");
    assert.equal(classifyInbound(message({ text }), context).kind, "reply", "our own opt-out line, quoted back, is not a stop");
    assert.equal(ownWords("> quoted\nhello"), "hello");
  });
});

describe("a bounce", () => {
  const bounce = (text: string, extra: Partial<InboundMessage> = {}) =>
    message({ fromEmail: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", text, ...extra });

  it("suppresses an address we emailed when the failure is permanent", () => {
    const text = "Your message wasn't delivered to jane@parkview.example because the address couldn't be found.\nThe response was: 550 5.1.1 User unknown\nSent from outreach@virtara-mail.co.za";
    assert.deepEqual(classifyInbound(bounce(text), context), { kind: "bounce", address: "jane@parkview.example" });
  });

  it("prefers X-Failed-Recipients", () => {
    assert.deepEqual(classifyInbound(bounce("550 5.1.1 no such user", { headers: { "x-failed-recipients": "Bob@Old.example" } }), context), { kind: "bounce", address: "bob@old.example" });
  });

  it("leaves a temporary failure alone", () => {
    assert.equal(classifyInbound(bounce("Delivery to jane@parkview.example is delayed: mailbox full, 4.2.2"), context).kind, "ignore");
  });

  it("never suppresses our own address or one we did not email", () => {
    assert.equal(classifyInbound(bounce("550 5.1.1 unknown recipient stranger@elsewhere.example outreach@virtara-mail.co.za"), context).kind, "ignore");
  });

  it("is recognised by its report type even from an unusual sender", () => {
    const result = classifyInbound(message({ fromEmail: "noreply@relay.example", text: "550 5.1.1 jane@parkview.example does not exist", headers: { "content-type": 'multipart/report; report-type=delivery-status; boundary="x"' } }), context);
    assert.deepEqual(result, { kind: "bounce", address: "jane@parkview.example" });
  });
});
