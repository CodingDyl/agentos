import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeMicFailure,
  MIC_DISMISSED_MESSAGE,
  MIC_SYSTEM_BLOCKED_MESSAGE,
  permissionFromState,
  siteBlockedMessage,
} from "../mic-permission";

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
  it("says where to switch the site back on when the browser has blocked it", () => {
    const failure = describeMicFailure({ name: "NotAllowedError", message: "Permission denied" }, "denied");
    assert.equal(failure.kind, "site-blocked");
    assert.equal(failure.blocked, true);
    assert.equal(failure.message, siteBlockedMessage("this site"));
    assert.ok(failure.message.includes("address bar"));
  });

  it("blames the operating system, not the site, when the site already shows allowed", () => {
    const failure = describeMicFailure({ name: "NotAllowedError", message: "Permission denied by system" }, "granted");
    assert.equal(failure.kind, "system-blocked");
    assert.equal(failure.blocked, false);
    assert.equal(failure.message, MIC_SYSTEM_BLOCKED_MESSAGE);
    assert.ok(failure.message.includes("System Settings"));
    assert.equal(failure.detail, "NotAllowedError: Permission denied by system");
  });

  it("recognises a closed prompt as something to retry, not a block", () => {
    const failure = describeMicFailure({ name: "NotAllowedError", message: "Permission dismissed" }, "prompt");
    assert.equal(failure.message, MIC_DISMISSED_MESSAGE);
    assert.equal(failure.blocked, false);
  });

  it("tells a missing microphone from a busy one from an insecure page", () => {
    assert.equal(describeMicFailure({ name: "NotFoundError" }).kind, "no-device");
    assert.equal(describeMicFailure({ name: "NotReadableError" }).kind, "busy");
    assert.equal(describeMicFailure({ name: "InsecureContext" }).kind, "insecure");
    assert.ok(describeMicFailure({ name: "InsecureContext" }).message.includes("localhost"));
  });

  it("keeps the browser's own error for the cases it cannot explain", () => {
    const failure = describeMicFailure({ name: "WeirdError", message: "something odd" });
    assert.equal(failure.kind, "other");
    assert.equal(failure.detail, "WeirdError: something odd");
  });

  it("never throws on odd input", () => {
    assert.equal(describeMicFailure(undefined).kind, "other");
    assert.equal(describeMicFailure("boom").kind, "other");
    assert.ok(describeMicFailure(null).message.length > 0);
  });
});
