import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientMailMatcher } from "../../../shared/business-mail";

describe("clientMailMatcher", () => {
  const match = clientMailMatcher([
    { id: "ada", email: "Ada@AdaLaw.co.za" },
    { id: "bo", email: "bo@gmail.com" },
    { id: "x1", email: "one@shared.com" },
    { id: "x2", email: "two@shared.com" },
    { id: "none" },
  ]);

  it("matches an exact address, ignoring case", () => {
    assert.equal(match("ada@adalaw.co.za")?.id, "ada");
    assert.equal(match("bo@gmail.com")?.id, "bo");
  });

  it("matches a colleague on the client's company domain", () => {
    assert.equal(match("accounts@adalaw.co.za")?.id, "ada");
  });

  it("never matches strangers on a personal-mail domain", () => {
    assert.equal(match("someone@gmail.com"), undefined);
  });

  it("refuses a domain two clients share, but still matches their exact addresses", () => {
    assert.equal(match("three@shared.com"), undefined);
    assert.equal(match("two@shared.com")?.id, "x2");
  });

  it("ignores missing or malformed senders", () => {
    assert.equal(match(undefined), undefined);
    assert.equal(match("not-an-email"), undefined);
    assert.equal(match("@adalaw.co.za"), undefined);
  });
});
