import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SpeechQueue } from "../speech-queue";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function harness(options: { synth?: (text: string) => Promise<Blob>; play?: (audio: Blob) => Promise<void> } = {}) {
  const log: string[] = [];
  const state = { speaking: [] as boolean[], drained: 0, errors: [] as unknown[], stopped: 0 };
  const queue = new SpeechQueue({
    synthesise: options.synth ?? (async (text) => new Blob([text])),
    play:
      options.play ??
      (async (audio) => {
        log.push(await audio.text());
      }),
    stopPlayback: () => {
      state.stopped++;
    },
    onSpeaking: (value) => state.speaking.push(value),
    onDrained: () => {
      state.drained++;
    },
    onError: (error) => state.errors.push(error),
    isSkippable: (error) => error instanceof Error && error.message === "empty",
  });
  return { queue, log, state };
}

describe("SpeechQueue", () => {
  it("plays pieces in order and reports when it has run dry", async () => {
    const { queue, log, state } = harness();
    queue.enqueue("one");
    queue.enqueue("two");
    queue.close();
    await tick();
    await tick();
    assert.deepEqual(log, ["one", "two"]);
    assert.equal(state.drained, 1);
    assert.equal(state.speaking.at(-1), false);
  });

  it("keeps order even when a later piece is made first", async () => {
    const { queue, log } = harness({
      synth: (text) => new Promise((resolve) => setTimeout(() => resolve(new Blob([text])), text === "slow" ? 25 : 1)),
    });
    queue.enqueue("slow");
    queue.enqueue("fast");
    queue.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(log, ["slow", "fast"]);
  });

  it("waits for text that has not been written yet", async () => {
    const { queue, log, state } = harness();
    queue.enqueue("first");
    await tick();
    assert.deepEqual(log, ["first"]);
    assert.equal(state.drained, 0);
    queue.enqueue("second");
    queue.close();
    await tick();
    await tick();
    assert.deepEqual(log, ["first", "second"]);
    assert.equal(state.drained, 1);
  });

  it("skips a piece with nothing to say and carries on", async () => {
    let n = 0;
    const { queue, log } = harness({
      synth: async (text) => {
        if (n++ === 0) throw new Error("empty");
        return new Blob([text]);
      },
    });
    queue.enqueue("code only");
    queue.enqueue("real words");
    queue.close();
    await tick();
    await tick();
    assert.deepEqual(log, ["real words"]);
  });

  it("stops everything after one failure and reports it once", async () => {
    let n = 0;
    const { queue, log, state } = harness({
      synth: async (text) => {
        if (n++ === 1) throw new Error("fish is down");
        return new Blob([text]);
      },
    });
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    queue.close();
    await tick();
    await tick();
    assert.deepEqual(log, ["a"]);
    assert.equal(state.errors.length, 1);
    assert.equal(state.drained, 0);
  });

  it("reset stops playback at once and drops what was queued", async () => {
    let release: () => void = () => undefined;
    const { queue, log, state } = harness({
      // Never ends by itself, like real audio; only `release` (a stop) ends it.
      play: (audio) =>
        audio.text().then((text) => {
          log.push(text);
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        }),
    });
    queue.enqueue("talking");
    queue.enqueue("never said");
    await tick();
    queue.reset();
    release();
    await tick();
    assert.deepEqual(log, ["talking"]);
    assert.ok(state.stopped >= 1);
    assert.equal(state.speaking.at(-1), false);
  });

  it("can be used again after a reset", async () => {
    const { queue, log, state } = harness();
    queue.enqueue("old");
    queue.reset();
    queue.enqueue("new");
    queue.close();
    await tick();
    await tick();
    assert.ok(log.includes("new"));
    assert.equal(state.drained, 1);
  });
});
