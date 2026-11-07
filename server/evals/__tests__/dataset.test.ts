import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The repo is public. Everything committed under evals/ must be invented: only
 * reserved example domains, and every case says what it expects.
 */

const DATASET = path.resolve("evals/datasets/mail-synthetic.json");
const SAFE_DOMAIN = /@[a-z0-9.-]*example\.(com|org|net)\b/i;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

interface Case {
  description?: string;
  vars: Record<string, unknown>;
}

describe("mail-synthetic.json", async () => {
  const cases = JSON.parse(await fs.readFile(DATASET, "utf8")) as Case[];

  it("has about a dozen cases covering every bucket", () => {
    assert.ok(cases.length >= 10);
    assert.deepEqual([...new Set(cases.map((entry) => entry.vars.expectedBucket))].sort(), ["fyi", "low_priority", "needs_you"]);
  });

  it("only ever uses example.com, example.org or example.net addresses", async () => {
    const raw = await fs.readFile(DATASET, "utf8");
    const addresses = raw.match(ADDRESS) ?? [];
    assert.ok(addresses.length > 0);
    for (const address of addresses) assert.match(address, SAFE_DOMAIN, address);
  });

  it("gives every case an expected category or bucket, and the thread to classify", () => {
    for (const entry of cases) {
      assert.ok(entry.vars.expectedBucket || entry.vars.expectedCategory, String(entry.description));
      for (const key of ["from", "subject", "snippet", "date"]) assert.equal(typeof entry.vars[key], "string", `${String(entry.description)}: ${key}`);
    }
  });
});
