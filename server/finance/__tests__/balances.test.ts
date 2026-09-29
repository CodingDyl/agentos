import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { investecCashOf, netCashOf, type FinancialAccount } from "../../../shared/finance-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-balances-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");
const { getFinance, refreshBalances } = await import("../finance");
const { forgetInvestecToken } = await import("../investec");

const realFetch = globalThis.fetch;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const account = (over: Partial<FinancialAccount>): FinancialAccount => ({ id: "a", provider: "investec", name: "Acc", type: "current", currency: "ZAR", balance: 0, ...over });

describe("investecCashOf and netCashOf", () => {
  const accounts = [
    account({ id: "cur", balance: 10_000 }),
    account({ id: "sav", type: "savings", balance: 5_000 }),
    account({ id: "inv", type: "investment", balance: 70_000 }),
    account({ id: "card", provider: "manual", type: "credit", balance: -31_400 }),
    account({ id: "mine", provider: "manual", balance: 2_000 }),
  ];

  it("counts only current and savings accounts Investec reports, and not cards, investments or accounts you added", () => {
    assert.equal(investecCashOf(accounts), 15_000);
  });

  it("has no answer, rather than zero, when Investec reports nothing", () => {
    assert.equal(investecCashOf([account({ provider: "manual" }), account({ provider: "sample" })]), undefined);
  });

  it("nets cash across every account, less what is owed, and leaves investments out", () => {
    assert.equal(netCashOf(accounts), 10_000 + 5_000 + 2_000 - 31_400);
  });
});

describe("refreshing balances", () => {
  let calls: string[] = [];
  let balance = 1_000;

  beforeEach(() => {
    forgetInvestecToken();
    calls = [];
    process.env.INVESTEC_CLIENT_ID = "id";
    process.env.INVESTEC_SECRET = "secret";
    process.env.INVESTEC_API_KEY = "key";
    // A sync a moment ago, so reading the page does not start a background one that outlives the fake bank.
    store.writeMeta("lastSyncAt", new Date().toISOString());
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.includes("oauth2/token")) return reply(200, { access_token: "t", expires_in: 1800 });
      if (url.pathname.endsWith("/accounts")) return reply(200, { data: { accounts: [{ accountId: "inv-1", productName: "Private Bank Account", accountNumber: "10012345678" }] } });
      if (url.pathname.endsWith("/balance")) return reply(200, { data: { currentBalance: balance, currency: "ZAR" } });
      return reply(500, {});
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.INVESTEC_CLIENT_ID;
    delete process.env.INVESTEC_SECRET;
    delete process.env.INVESTEC_API_KEY;
  });

  it("reads balances only, never transactions, and only with GET after the token request", async () => {
    balance = 4_321;
    assert.equal(await refreshBalances(), true);
    assert.equal(calls.some((call) => call.includes("/transactions")), false);
    assert.deepEqual(calls.filter((call) => !call.startsWith("GET")), ["POST /identity/v2/oauth2/token"]);
    assert.equal(store.readAccount("inv-1").balance, 4_321);
  });

  it("puts the live balance at the front of the page and stamps when it was read", () => {
    const data = getFinance();
    assert.equal(investecCashOf(data.accounts), 4_321);
    assert.ok(data.source.balancesUpdatedAt);
  });

  it("does not read again within the minimum gap, however many times it is asked", async () => {
    calls = [];
    balance = 9_999;
    assert.equal(await refreshBalances(), false);
    assert.equal(calls.length, 0);
    assert.equal(store.readAccount("inv-1").balance, 4_321);
  });

  it("keeps the rate you set on an account when its balance is refreshed", async () => {
    store.updateAccount("inv-1", { interestRate: 0.11 });
    store.writeMeta("balancesAt", new Date(Date.now() - 60_000).toISOString());
    balance = 7_000;
    assert.equal(await refreshBalances(), true);
    const refreshed = store.readAccount("inv-1");
    assert.equal(refreshed.balance, 7_000);
    assert.equal(refreshed.interestRate, 0.11);
  });

  it("keeps the last balance and says why when the bank cannot be reached", async () => {
    store.writeMeta("balancesAt", new Date(Date.now() - 60_000).toISOString());
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    forgetInvestecToken();
    await assert.rejects(() => refreshBalances());
    assert.equal(store.readAccount("inv-1").balance, 7_000);
  });
});
