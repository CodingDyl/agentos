import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PushToTalk } from "../push-to-talk";

function rig() {
  const calls: string[] = [];
  let clock = 0;
  let pending: (() => void) | undefined;
  const ptt = new PushToTalk({
    holdMs: 250,
    minRecordingMs: 400,
    start: () => calls.push("start"),
    finish: () => calls.push("finish"),
    cancel: () => calls.push("cancel"),
    now: () => clock,
    setTimer: (callback) => {
      pending = callback;
      return 1;
    },
    clearTimer: () => {
      pending = undefined;
    },
  });
  return {
    ptt,
    calls,
    /** Moves the clock, firing the hold timer if it is due. */
    wait(ms: number) {
      clock += ms;
      if (pending && ms > 0) {
        const fire = pending;
        pending = undefined;
        fire();
      }
    },
  };
}

describe("hold Control to talk", () => {
  it("listens while held alone and sends on release", () => {
    const { ptt, calls, wait } = rig();
    ptt.keyDown({ key: "Control" });
    assert.deepEqual(calls, []);
    wait(250);
    assert.equal(ptt.state, "recording");
    wait(1_500);
    ptt.keyUp({ key: "Control" });
    assert.deepEqual(calls, ["start", "finish"]);
    assert.equal(ptt.state, "idle");
  });

  it("never touches the microphone for a quick shortcut", () => {
    const { ptt, calls } = rig();
    ptt.keyDown({ key: "Control" });
    ptt.keyDown({ key: "c" });
    ptt.keyUp({ key: "c" });
    ptt.keyUp({ key: "Control" });
    assert.deepEqual(calls, []);
  });

  it("throws the recording away when a shortcut follows a long hold", () => {
    const { ptt, calls, wait } = rig();
    ptt.keyDown({ key: "Control" });
    wait(300);
    ptt.keyDown({ key: "k" });
    ptt.keyUp({ key: "Control" });
    assert.deepEqual(calls, ["start", "cancel"]);
  });

  it("drops a slip too short to be speech", () => {
    const { ptt, calls, wait } = rig();
    ptt.keyDown({ key: "Control" });
    wait(250);
    wait(100);
    ptt.keyUp({ key: "Control" });
    assert.deepEqual(calls, ["start", "cancel"]);
  });

  it("ignores key repeat and Control with other modifiers", () => {
    const { ptt, calls, wait } = rig();
    ptt.keyDown({ key: "Control", shiftKey: true });
    assert.equal(ptt.state, "idle");
    ptt.keyDown({ key: "Control" });
    ptt.keyDown({ key: "Control", repeat: true });
    wait(250);
    assert.deepEqual(calls, ["start"]);
  });

  it("closes the microphone when the window loses focus mid-hold", () => {
    const { ptt, calls, wait } = rig();
    ptt.keyDown({ key: "Control" });
    wait(250);
    ptt.blur();
    ptt.keyUp({ key: "Control" });
    assert.deepEqual(calls, ["start", "cancel"]);
  });
});
