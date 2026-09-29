import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMessage, isPlainAddress, MimeError, toRaw } from "../mime";

/** Splits a built message into its headers and decoded body. */
function parse(message: string) {
  const [head, ...rest] = message.split("\r\n\r\n");
  const headers = Object.fromEntries(
    head
      .split("\r\n")
      .map((line) => [
        line.slice(0, line.indexOf(":")),
        line.slice(line.indexOf(":") + 2),
      ]),
  );
  return {
    headers,
    body: Buffer.from(
      rest.join("\r\n\r\n").replace(/\r\n/g, ""),
      "base64",
    ).toString("utf8"),
    head,
  };
}

describe("addresses", () => {
  it("accepts one plain address and nothing that could start a header or add a recipient", () => {
    for (const good of [
      "jane@firm.co.za",
      "o'brien+x@firm.ie",
      "zoë@bücher.de",
    ])
      assert.equal(isPlainAddress(good), true, good);
    for (const bad of [
      "jane@firm.co.za\r\nBcc: x@evil.co",
      "a@b.co, c@d.co",
      "Jane <jane@firm.co.za>",
      "jane?bcc=x@evil.co",
      "a b@c.co",
      "a@b",
      "",
      "jane@firm.co.za;x@evil.co",
    ]) {
      assert.equal(isPlainAddress(bad), false, JSON.stringify(bad));
    }
  });
});

describe("building a message", () => {
  it("makes a plain UTF-8 message with the right headers and no From", () => {
    const { headers, body, head } = parse(
      buildMessage({
        to: "jane@firm.co.za",
        subject: "Your listing pages",
        body: "Hi Jane,\n\nOne thing I noticed.\n\nDylan",
      }),
    );
    assert.equal(headers.To, "jane@firm.co.za");
    assert.equal(headers.Subject, "Your listing pages");
    assert.equal(headers["MIME-Version"], "1.0");
    assert.match(headers["Content-Type"], /text\/plain; charset="UTF-8"/);
    assert.equal(
      /^From:/im.test(head),
      false,
      "Gmail fills in the mailbox itself",
    );
    assert.equal(body, "Hi Jane,\r\n\r\nOne thing I noticed.\r\n\r\nDylan");
  });

  it("encodes a non-ASCII subject and keeps the body exact", () => {
    const { headers, body } = parse(
      buildMessage({
        to: "jane@firm.co.za",
        subject: "Café menu – idea",
        body: "Héllo — “quoted”",
      }),
    );
    assert.match(headers.Subject, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.equal(
      Buffer.from(headers.Subject.slice(10, -2), "base64").toString("utf8"),
      "Café menu – idea",
    );
    assert.equal(body, "Héllo — “quoted”");
  });

  it("refuses a newline in the subject rather than letting it become a header", () => {
    for (const subject of [
      "Hi\r\nBcc: x@evil.co",
      "Hi\nBcc: x@evil.co",
      "Hi\rX: y",
      "Hi\u0000",
    ]) {
      assert.throws(
        () => buildMessage({ to: "jane@firm.co.za", subject, body: "b" }),
        MimeError,
        JSON.stringify(subject),
      );
    }
    assert.throws(
      () => buildMessage({ to: "jane@firm.co.za", subject: "   ", body: "b" }),
      /subject is empty/,
    );
  });

  it("refuses a recipient that is not one plain address", () => {
    assert.throws(
      () =>
        buildMessage({
          to: "jane@firm.co.za\r\nBcc: x@evil.co",
          subject: "s",
          body: "b",
        }),
      /plain email address/,
    );
    assert.throws(
      () => buildMessage({ to: "a@b.co, c@d.co", subject: "s", body: "b" }),
      MimeError,
    );
  });

  it("keeps a body that looks like headers as body text", () => {
    const { headers, body } = parse(
      buildMessage({
        to: "jane@firm.co.za",
        subject: "s",
        body: "Bcc: x@evil.co\nSubject: gotcha",
      }),
    );
    assert.equal(headers.Bcc, undefined);
    assert.equal(body, "Bcc: x@evil.co\r\nSubject: gotcha");
  });

  it("threads a reply only with a well-formed Message-ID", () => {
    const { headers } = parse(
      buildMessage({
        to: "jane@firm.co.za",
        subject: "Re: x",
        body: "b",
        inReplyTo: "<abc.123@mail.example>",
      }),
    );
    assert.equal(headers["In-Reply-To"], "<abc.123@mail.example>");
    assert.equal(headers.References, "<abc.123@mail.example>");
    for (const bad of ["abc", "<a b>", "<a>\r\nBcc: x@evil.co", "<>"]) {
      assert.throws(
        () =>
          buildMessage({
            to: "jane@firm.co.za",
            subject: "s",
            body: "b",
            inReplyTo: bad,
          }),
        MimeError,
        bad,
      );
    }
  });

  it("wraps long bodies at 76 columns and encodes for Gmail as base64url", () => {
    const message = buildMessage({
      to: "jane@firm.co.za",
      subject: "s",
      body: "x".repeat(500),
    });
    const bodyLines = message.split("\r\n\r\n")[1].trim().split("\r\n");
    assert.ok(bodyLines.every((line) => line.length <= 76));
    const raw = toRaw(message);
    assert.match(raw, /^[A-Za-z0-9_-]+$/, "no +, / or padding");
    assert.equal(Buffer.from(raw, "base64url").toString("utf8"), message);
  });
});
