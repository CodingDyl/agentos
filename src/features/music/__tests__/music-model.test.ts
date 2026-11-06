import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpolatedProgress, playbackPollMs } from "../music-model";

describe("music model", () => {
  it("polls Spotify gently", () => {
    assert.equal(playbackPollMs({ visible: true, playing: true, inApp: false }), 4_000);
    assert.equal(playbackPollMs({ visible: false, playing: true, inApp: false }), 30_000);
  });

  it("moves progress on while playing, up to the end of the track", () => {
    const playback = { isPlaying: true, progressMs: 10_000, readAt: "2026-10-01T00:00:00.000Z", track: { durationMs: 200_000 } };
    assert.equal(interpolatedProgress(playback, Date.parse("2026-10-01T00:00:02.000Z")), 12_000);
    assert.equal(interpolatedProgress(playback, Date.parse("2026-10-01T01:00:00.000Z")), 200_000);
    assert.equal(interpolatedProgress({ ...playback, isPlaying: false }, Date.parse("2026-10-01T00:00:02.000Z")), 10_000);
  });
});
