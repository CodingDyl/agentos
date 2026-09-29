import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeTimings, VoiceTimings } from "../voice-timings";

function clockAt(times: number[]) {
  let index = 0;
  return () => times[Math.min(index++, times.length - 1)];
}

describe("VoiceTimings", () => {
  it("measures each step of one exchange", () => {
    const timings = new VoiceTimings(clockAt([1000, 2200, 2400, 5400, 6200]));
    timings.mark("stopped");
    timings.mark("transcribed");
    timings.mark("sent");
    timings.mark("firstText");
    timings.mark("firstAudio");

    assert.deepEqual(timings.summary(), { transcribeMs: 1200, hermesFirstTextMs: 3000, voiceStartMs: 800, totalMs: 5200 });
  });

  it("ignores a repeated mark, so the first word of a stream is what counts", () => {
    const timings = new VoiceTimings(clockAt([0, 100, 999]));
    timings.mark("sent");
    timings.mark("firstText");
    timings.mark("firstText");
    assert.equal(timings.summary().hermesFirstTextMs, 100);
  });

  it("reports only what has happened yet, and forgets on reset", () => {
    const timings = new VoiceTimings(clockAt([10, 60]));
    timings.mark("sent");
    assert.deepEqual(timings.summary(), {});
    timings.mark("firstText");
    assert.equal(timings.summary().hermesFirstTextMs, 50);
    timings.reset();
    assert.deepEqual(timings.summary(), {});
  });

  it("falls back to send-to-voice when the exchange was typed", () => {
    const timings = new VoiceTimings(clockAt([0, 4000]));
    timings.mark("sent");
    timings.mark("firstAudio");
    assert.equal(timings.summary().totalMs, 4000);
  });
});

describe("describeTimings", () => {
  it("writes a readable line", () => {
    const line = describeTimings({ transcribeMs: 1200, hermesFirstTextMs: 3000, voiceStartMs: 800, totalMs: 5200 });
    assert.equal(line, "heard you in 1.2s, Hermes' first words after 3.0s, voice started 0.8s later, 5.2s in all");
  });
  it("is empty before anything has happened", () => {
    assert.equal(describeTimings({}), "");
  });
});
