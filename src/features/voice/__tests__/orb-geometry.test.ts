import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { energyFor, haloPoint, hash01, segmentHeight } from "../orb-geometry";

describe("orb geometry", () => {
  it("is deterministic and bounded", () => {
    assert.equal(hash01(7), hash01(7));
    for (let i = 0; i < 200; i++) assert.ok(hash01(i) >= 0 && hash01(i) < 1);
  });

  it("follows the microphone while listening and settles when idle", () => {
    assert.ok(energyFor("listening", 1, 0) > energyFor("listening", 0, 0));
    assert.ok(energyFor("listening", 0, 0) > energyFor("idle", 0, 0));
    assert.ok(energyFor("listening", 5, 0) <= 1);
  });

  it("keeps every segment inside the ring", () => {
    for (let i = 0; i < 48; i++) {
      for (const energy of [0, 0.5, 1]) {
        const height = segmentHeight(i, energy, 3.3);
        assert.ok(height >= 0.08 && height <= 1);
      }
    }
  });

  it("puts halo particles near the requested radius", () => {
    const { x, y } = haloPoint(10, 120, 1, 2, 100);
    const distance = Math.hypot(x, y);
    assert.ok(distance > 85 && distance < 115);
  });
});
