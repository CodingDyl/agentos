import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { forgetInvestecToken, InvestecError, isInvestecConfigured, missingInvestecVariables, readInvestec } from "../investec";

const realFetch = globalThis.fetch;

const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

beforeEach(() => {
  forgetInvestecToken();
  process.env.INVESTEC_CLIENT_ID = "client-abc";
  process.env.INVESTEC_SECRET = "super-secret-value";
  process.env.INVESTEC_API_KEY = "key-xyz";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.INVESTEC_CLIENT_ID;
  delete process.env.INVESTEC_SECRET;
  delete process.env.INVESTEC_API_KEY;
});

describe("configuration", () => {
  it("names the missing variables, never their values", () => {
    delete process.env.INVESTEC_API_KEY;
    assert.deepEqual(missingInvestecVariables(), ["INVESTEC_API_KEY"]);
    assert.equal(isInvestecConfigured(), false);
  });
});

describe("failures say why", () => {
  it("reports the bank's reason for a rejected sign-in, with our secrets blanked", async () => {
    globalThis.fetch = async () => reply(401, { error: "invalid_client for super-secret-value" });
    await assert.rejects(
      () => readInvestec("2026-01-01", "2026-09-01"),
      (error: Error) => {
        assert.ok(error instanceof InvestecError);
        assert.match(error.message, /signing in \(401\)/);
        assert.match(error.message, /invalid_client/);
        assert.equal(error.message.includes("super-secret-value"), false);
        return true;
      },
    );
  });

  it("only ever asks the bank with GET after the token request", async () => {
    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      methods.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      if (url.includes("oauth2/token")) return reply(200, { access_token: "tok", expires_in: 1800 });
      if (url.endsWith("/accounts")) return reply(200, { data: { accounts: [{ accountId: "a1", productName: "Private Bank Account" }] } });
      if (url.includes("/balance")) return reply(200, { data: { currentBalance: 100, currency: "ZAR" } });
      return reply(200, { data: { transactions: [] } });
    };
    await readInvestec("2026-01-01", "2026-09-01");
    assert.deepEqual(methods.filter((entry) => !entry.startsWith("GET")), ["POST /identity/v2/oauth2/token"]);
  });

  it("keeps the accounts it could read and names the one it could not", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("oauth2/token")) return reply(200, { access_token: "tok", expires_in: 1800 });
      if (url.endsWith("/accounts")) {
        return reply(200, { data: { accounts: [{ accountId: "good", productName: "Private Bank Account" }, { accountId: "bad", referenceName: "Old card" }] } });
      }
      if (url.includes("/bad/")) return reply(500, "boom");
      if (url.includes("/balance")) return reply(200, { data: { currentBalance: 50, currency: "ZAR" } });
      return reply(200, { data: { transactions: [] } });
    };
    const snapshot = await readInvestec("2026-01-01", "2026-09-01");
    assert.equal(snapshot.accounts.length, 1);
    assert.deepEqual(snapshot.skipped, ["Old card"]);
  });

  it("fails loudly when no account could be read, and when there are none", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("oauth2/token")) return reply(200, { access_token: "tok", expires_in: 1800 });
      return reply(200, { data: { accounts: [] } });
    };
    await assert.rejects(() => readInvestec("2026-01-01", "2026-09-01"), /lists no accounts/);
  });
});
