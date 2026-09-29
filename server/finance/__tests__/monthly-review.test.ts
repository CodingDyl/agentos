import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-monthly-"));
process.env.AGENTOS_UI_DIR = directory;
process.env.HERMES_API_KEY = "test-key";
process.env.HERMES_BASE_URL = "http://hermes.test/v1";
delete process.env.INVESTEC_CLIENT_ID;
delete process.env.INVESTEC_SECRET;
delete process.env.INVESTEC_API_KEY;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");
const { getFinance } = await import("../finance");
const { ensureMonthlyReview, markReviewSeen, previousMonth } = await import("../monthly-review");
const { readNarrative } = await import("../review");

const realFetch = globalThis.fetch;
const SAMPLE_REPLY = "What changed\nDining rose.\n\nGoing well\nSavings rate held.\n\nWorth a look\nNothing urgent.\n\nNext month\nKeep putting R5,000 aside.";

let requests: string[] = [];
let mode: "ok" | "down" = "ok";

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("http://hermes.test")) throw new Error(`unexpected request to ${String(input)}`);
    requests.push(String(init?.body ?? ""));
    if (mode === "down") throw new Error("offline");
    return new Response(JSON.stringify({ choices: [{ message: { content: SAMPLE_REPLY } }] }), { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("the monthly review writes itself", () => {
  it("does nothing on sample data, because that is nobody's month", async () => {
    assert.equal(await ensureMonthlyReview(), "skipped");
    assert.equal(requests.length, 0);
    assert.equal(getFinance().previousReview, undefined);
  });

  it("does nothing for a month with nothing in it", async () => {
    store.createManualAccount({ name: "Everyday account", type: "current", balance: 1_000 });
    assert.equal(await ensureMonthlyReview(), "skipped");
    assert.equal(requests.length, 0);
  });

  const month = previousMonth();
  const account = () => store.readAccounts()[0];

  it("writes last month's review once it has a month to review, from totals alone", async () => {
    store.insertTransactions([
      { id: "m1", accountId: account().id, date: `${month}-01`, description: "SALARY ACME", amount: 40_000, merchant: "Salary" },
      { id: "m2", accountId: account().id, date: `${month}-02`, description: "RENT CAPE TOWN", amount: -14_000, merchant: "Rent" },
      { id: "m3", accountId: account().id, date: `${month}-05`, description: "WOOLWORTHS 0329", amount: -6_000, merchant: "Woolworths" },
    ]);

    assert.equal(await ensureMonthlyReview(), "written");
    assert.equal(requests.length, 1);
    assert.ok(readNarrative(month)?.text.includes("Next month"));

    // What Hermes saw: totals, not merchants, account names or the payments themselves.
    const sent = requests[0];
    assert.match(sent, /Income R 40,000/);
    for (const forbidden of ["WOOLWORTHS", "Woolworths", "RENT CAPE", "Everyday", "SALARY ACME"]) {
      assert.equal(sent.includes(forbidden), false, `${forbidden} reached Hermes`);
    }
  });

  it("puts last month's review in the page, unread, with an attention item", () => {
    const { previousReview, attention } = getFinance();
    assert.equal(previousReview?.review.month, month);
    assert.equal(previousReview?.review.income, 40_000);
    assert.equal(previousReview?.seen, false);
    assert.ok(previousReview?.review.narrative);
    assert.ok(attention.some((item) => item.id === "review" && item.tab === "insights"));
  });

  it("does not get stuck on an answer: a later call is a fresh check, not the last one replayed", async () => {
    const first = ensureMonthlyReview();
    // While one is running, another caller shares it rather than starting a second.
    assert.equal(ensureMonthlyReview(), first);
    await first;
    // Once it has settled it is gone. (A path that needs no work once left its promise in place forever.)
    const later = ensureMonthlyReview();
    assert.notEqual(later, first);
    await later;
  });

  it("never writes it twice", async () => {
    assert.equal(await ensureMonthlyReview(), "exists");
    assert.equal(requests.length, 0);
  });

  it("clears from attention once you mark it read, and stays on the page", () => {
    markReviewSeen(month);
    const data = getFinance();
    assert.equal(data.previousReview?.seen, true);
    assert.equal(data.attention.some((item) => item.id === "review"), false);
  });

  it("records why Hermes failed, does not hammer it, and lets you ask again", async () => {
    store.writeMeta(`review:${month}`, "");
    store.writeMeta(`review-attempt:${month}`, "");
    mode = "down";

    assert.equal(await ensureMonthlyReview(), "failed");
    assert.equal(requests.length, 1);
    assert.match(getFinance().previousReview?.error ?? "", /Hermes/);
    assert.equal(getFinance().previousReview?.review.narrative, undefined);

    // Straight away again: too soon, so it leaves Hermes alone.
    assert.equal(await ensureMonthlyReview(), "waiting");
    assert.equal(requests.length, 1);

    // You asking is different: it goes ahead, and a success clears the error.
    mode = "ok";
    assert.equal(await ensureMonthlyReview({ force: true }), "written");
    assert.equal(getFinance().previousReview?.error, undefined);
    assert.ok(getFinance().previousReview?.review.narrative);
  });

  it("retries on its own once the wait is over", async () => {
    store.writeMeta(`review:${month}`, "");
    store.writeMeta(`review-attempt:${month}`, new Date(Date.now() - 7 * 3_600_000).toISOString());
    assert.equal(await ensureMonthlyReview(), "written");
  });
});
