import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MissionSources } from "@shared/mission-control-types";
import {
  degradedSources,
  elapsed,
  isLoud,
  statusLabel,
  statusPill,
} from "../mission-control-model";

/**
 * Mission Control has to be readable in ten seconds, and two properties do most
 * of that work: one vocabulary for status across every subsystem, and colour
 * spent only where something is genuinely asking for the operator.
 */

describe("the shared status vocabulary", () => {
  it("never draws an unknown status as healthy", () => {
    // A check that could not be run has not passed, and green would say it did.
    assert.notEqual(statusPill("unknown"), "healthy");
    assert.notEqual(statusPill("offline"), "healthy");
    assert.notEqual(statusPill("failed"), "healthy");
  });

  it("draws the one resting state as healthy", () => {
    assert.equal(statusPill("ready"), "healthy");
  });

  it("says every state in words, because a dot never carries meaning alone", () => {
    const states = [
      "ready",
      "running",
      "waiting",
      "attention",
      "failed",
      "unknown",
      "offline",
    ] as const;

    for (const state of states) {
      assert.ok(statusLabel(state).length > 0, state);
    }
  });

  it("spends colour only on states that are asking for something", () => {
    // Amber is a budget. If `ready` and `running` spent it, the screen would be
    // permanently lit and the one row that mattered would be invisible.
    assert.equal(isLoud("ready"), false);
    assert.equal(isLoud("running"), false);
    assert.equal(isLoud("unknown"), false);

    assert.equal(isLoud("attention"), true);
    assert.equal(isLoud("failed"), true);
    assert.equal(isLoud("offline"), true);
  });
});

describe("how long something has been going", () => {
  const now = new Date("2026-09-10T10:00:00.000Z");

  it("counts seconds under a minute", () => {
    assert.equal(elapsed("2026-09-10T09:59:28.000Z", now), "32s");
  });

  it("pads minutes and seconds so the line does not jitter", () => {
    // A counter that changes width every second is a counter that twitches.
    assert.equal(elapsed("2026-09-10T09:53:28.000Z", now), "06m 32s");
  });

  it("drops to hours and minutes for a long run", () => {
    assert.equal(elapsed("2026-09-10T07:45:00.000Z", now), "2h 15m");
  });

  it("says nothing rather than guessing at an unreadable start", () => {
    assert.equal(elapsed("not a date", now), "");
  });

  it("never counts backwards from a timestamp in the future", () => {
    assert.equal(elapsed("2026-09-10T10:05:00.000Z", now), "0s");
  });
});

describe("naming the sources that did not answer", () => {
  const sources = (overrides: Partial<MissionSources> = {}): MissionSources => ({
    vault: "ready",
    workers: "ready",
    automations: "ready",
    activity: "ready",
    hermes: "ready",
    ...overrides,
  });

  it("says nothing when everything answered", () => {
    assert.deepEqual(degradedSources(sources()), []);
  });

  it("names a source that could not be read", () => {
    // An empty section because its source is down looks exactly like an empty
    // section because there is nothing to show, and only one is good news.
    assert.deepEqual(
      degradedSources(sources({ automations: "unknown", hermes: "offline" })),
      ["Automations", "Hermes"],
    );
  });

  it("does not call a busy source a broken one", () => {
    assert.deepEqual(degradedSources(sources({ workers: "running" })), []);
  });
});
