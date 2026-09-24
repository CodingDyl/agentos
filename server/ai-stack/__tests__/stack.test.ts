import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveStatus, isToggleable, monthStart } from "../stack";

describe("deriveStatus", () => {
  it("is not integrated when AgentOS has no integration", () => {
    assert.deepEqual(deriveStatus({ integrated: false, enabled: false, name: "Cursor" }), { status: "not-integrated" });
  });

  it("is off when switched off, even if it would be unavailable anyway", () => {
    const result = deriveStatus({
      integrated: true,
      enabled: false,
      name: "Grok",
      health: { available: false, reason: "No key." },
    });

    assert.equal(result.status, "off");
    assert.match(result.reason ?? "", /switched off/);
  });

  it("is unavailable when on but unhealthy, carrying the reason", () => {
    assert.deepEqual(
      deriveStatus({ integrated: true, enabled: true, name: "Claude", health: { available: false, reason: "No key." } }),
      { status: "unavailable", reason: "No key." },
    );
  });

  it("is live when on and healthy", () => {
    assert.deepEqual(
      deriveStatus({ integrated: true, enabled: true, name: "Claude", health: { available: true, reason: "Model: sonnet" } }),
      { status: "live", reason: "Model: sonnet" },
    );
  });
});

describe("isToggleable", () => {
  it("allows a switch only for AIs AgentOS integrates", () => {
    assert.equal(isToggleable("claude"), true);
    assert.equal(isToggleable("grok"), true);
    assert.equal(isToggleable("hermes"), true);
    assert.equal(isToggleable("jev"), true);
    assert.equal(isToggleable("cursor"), false);
    assert.equal(isToggleable("openai"), false);
    assert.equal(isToggleable("nonsense"), false);
  });
});

describe("monthStart", () => {
  it("is the first of the current month", () => {
    const start = monthStart(new Date(2026, 8, 24, 15, 30));
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 8);
    assert.equal(start.getDate(), 1);
    assert.equal(start.getHours(), 0);
  });
});
