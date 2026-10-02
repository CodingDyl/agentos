import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApolloError, revealEmail, searchPeopleAtDomain } from "../apollo";
import { siteDomain } from "../email-finder";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.APOLLO_API_KEY;
});

function reply(status: number, body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("apollo", () => {
  it("refuses without a key, before any request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    await assert.rejects(searchPeopleAtDomain("shop.co.za"), (e: unknown) => e instanceof ApolloError && e.reason === "not-configured");
    assert.equal(called, false);
  });

  it("lists people best title first", async () => {
    process.env.APOLLO_API_KEY = "k";
    reply(200, {
      people: [
        { id: "2", first_name: "Lee", last_name_obfuscated: "Sm***", title: "Manager" },
        { id: "1", first_name: "Sam", last_name_obfuscated: "Ko***", title: "Owner" },
      ],
    });
    const people = await searchPeopleAtDomain("shop.co.za");
    assert.deepEqual(people.map((p) => p.id), ["1", "2"]);
  });

  it("returns an email, and nothing when Apollo has none", async () => {
    process.env.APOLLO_API_KEY = "k";
    reply(200, { person: { email: "Sam@Shop.co.za", email_status: "verified" } });
    assert.deepEqual(await revealEmail("1", "shop.co.za"), { address: "sam@shop.co.za", verified: true });
    reply(200, { person: { email: "email_not_unlocked@domain.com" } });
    assert.equal(await revealEmail("1", "shop.co.za"), undefined);
  });

  it("explains a refused key and used-up credits", async () => {
    process.env.APOLLO_API_KEY = "k";
    reply(403, {});
    await assert.rejects(searchPeopleAtDomain("a.com"), (e: unknown) => e instanceof ApolloError && e.reason === "unauthorized");
    reply(403, { error_code: "API_INACCESSIBLE" });
    await assert.rejects(searchPeopleAtDomain("a.com"), (e: unknown) => e instanceof ApolloError && e.reason === "plan");
    reply(429, {});
    await assert.rejects(searchPeopleAtDomain("a.com"), (e: unknown) => e instanceof ApolloError && e.reason === "no-credits");
  });

  it("looks up a business domain, not a social page", () => {
    assert.equal(siteDomain("https://www.thewhippet.co.za/menu"), "thewhippet.co.za");
    assert.equal(siteDomain("https://www.facebook.com/Secure-Plumbing"), undefined);
    assert.equal(siteDomain(undefined), undefined);
  });
});
