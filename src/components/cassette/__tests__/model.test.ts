import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogueCode, isoDuration, tapeScales } from "../model";

describe("cassette model", () => {
  it("winds tape from the left reel onto the right", () => {
    const start = tapeScales(0);
    const end = tapeScales(1);
    assert.ok(start.left > end.left);
    assert.ok(start.right < end.right);
    assert.equal(tapeScales(0).left, 1);
    assert.equal(tapeScales(1).right, 1);
    assert.deepEqual(tapeScales(Number.NaN), tapeScales(0));
    assert.deepEqual(tapeScales(4), tapeScales(1));
  });

  it("prints a six-character catalogue code", () => {
    assert.equal(catalogueCode("Abbey Road"), "ABBEYR");
    assert.equal(catalogueCode("A"), "A00000");
    assert.equal(catalogueCode(undefined), "000000");
    assert.equal(catalogueCode("ok computer"), "OKCOMP");
  });

  it("writes an ISO duration", () => {
    assert.equal(isoDuration(0), "PT0S");
    assert.equal(isoDuration(65), "PT1M5S");
    assert.equal(isoDuration(3723), "PT1H2M3S");
    assert.equal(isoDuration(3603), "PT1H0M3S");
    assert.equal(isoDuration(Number.NaN), "PT0S");
  });
});
