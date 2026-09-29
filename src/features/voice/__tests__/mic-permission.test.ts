import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeMicFailure, MIC_BLOCKED_MESSAGE, permissionFromState } from "../mic-permission";

describe("permissionFromState", () => {
  it("passes the three real states and calls the rest unknown", () => {
    assert.equal(permissionFromState("granted"), "granted");
    assert.equal(permissionFromState("prompt"), "prompt");
    assert.equal(permissionFromState("denied"), "denied");
    assert.equal(permissionFromState("something-new"), "unknown");
    assert.equal(permissionFromState(undefined), "unknown");
  });
});

describe("describeMicFailure", () => {
  it("says where to switch access back on when the browser has blocked it", () => {
    const failure = describeMicFailure({ name: "NotAllowedError" });
    assert.equal(failure.blocked, true);
    assert.equal(failure.message, MIC_BLOCKED_MESSAGE);
    assert.ok(failure.message.includes("address bar"));
  });

  it("tells a missing microphone from a busy one from a blocked one", () => {
    assert.equal(describeMicFailure({ name: "NotFoundError" }).blocked, false);
    assert.ok(describeMicFailure({ name: "NotFoundError" }).message.includes("No microphone"));
    assert.ok(describeMicFailure({ name: "NotReadableError" }).message.includes("in use"));
    assert.ok(describeMicFailure({ name: "InsecureContext" }).message.includes("localhost"));
  });

  it("never throws on odd input", () => {
    assert.equal(describeMicFailure(undefined).blocked, false);
    assert.equal(describeMicFailure("boom").blocked, false);
    assert.ok(describeMicFailure(null).message.length > 0);
  });
});
