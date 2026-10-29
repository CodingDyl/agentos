import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VideoIdea } from "../../../../shared/video-ideas-types";
import { elapsed, ideaHeadline, ideaSteps, isFinishedForTray } from "../idea-model";

const base: VideoIdea = {
  id: "vi-1",
  sourceId: "ls-1",
  videoId: "dQw4w9WgXcQ",
  title: "A video",
  mode: "learn",
  stage: "transcribing",
  taskIds: [],
  runs: [],
  createdAt: "2026-10-29T10:00:00.000Z",
  updatedAt: "2026-10-29T10:00:00.000Z",
};

const states = (idea: VideoIdea) => ideaSteps(idea).map((step) => `${step.id}:${step.state}`);

describe("video idea progress", () => {
  it("shows two steps for a note and three more for a check", () => {
    assert.deepEqual(states(base), ["transcript:active", "note:waiting"]);
    assert.deepEqual(states({ ...base, mode: "assess" }), ["transcript:active", "note:waiting", "assess:waiting", "decide:waiting", "build:waiting"]);
  });

  it("walks through the stages", () => {
    assert.deepEqual(states({ ...base, stage: "noting" }), ["transcript:done", "note:active"]);
    assert.deepEqual(states({ ...base, stage: "noted" }), ["transcript:done", "note:done"]);
    assert.deepEqual(states({ ...base, mode: "assess", stage: "noted" }), ["transcript:done", "note:done", "assess:active", "decide:waiting", "build:waiting"]);
    assert.deepEqual(states({ ...base, mode: "assess", stage: "awaiting_decision" }), ["transcript:done", "note:done", "assess:done", "decide:needs_you", "build:waiting"]);
    assert.deepEqual(states({ ...base, mode: "assess", stage: "building", taskIds: ["A", "B"], currentTask: 1 }), [
      "transcript:done",
      "note:done",
      "assess:done",
      "decide:done",
      "build:active",
    ]);
    assert.deepEqual(states({ ...base, mode: "assess", stage: "declined" }), ["transcript:done", "note:done", "assess:done", "decide:done"]);
  });

  it("marks the step that stopped, or that needs Dylan", () => {
    assert.deepEqual(states({ ...base, stage: "needs_transcript" }), ["transcript:needs_you", "note:waiting"]);
    assert.deepEqual(states({ ...base, stage: "failed", failedAt: "noting" }), ["transcript:done", "note:failed"]);
    assert.deepEqual(states({ ...base, mode: "assess", stage: "failed", failedAt: "assessing" }), [
      "transcript:done",
      "note:done",
      "assess:failed",
      "decide:waiting",
      "build:waiting",
    ]);
  });

  it("says who is doing what, and when it is done", () => {
    assert.equal(ideaHeadline({ ...base, stage: "noting" }), "Claude is writing your brief");
    assert.equal(ideaHeadline({ ...base, stage: "noted" }), "Your note is ready");
    assert.equal(ideaHeadline({ ...base, mode: "assess", stage: "awaiting_decision" }), "Ready for your decision");
    assert.equal(ideaHeadline({ ...base, mode: "assess", stage: "building", taskIds: ["A", "B"], currentTask: 1 }), "Claude Code is building task 2 of 2");
  });

  it("counts time like a stopwatch", () => {
    const start = "2026-10-29T10:00:00.000Z";
    assert.equal(elapsed(start, Date.parse(start) + 65_000), "1:05");
    assert.equal(elapsed(start, Date.parse(start) + 3_725_000), "1:02:05");
  });

  it("keeps finished ideas in the tray for a day", () => {
    const now = Date.parse("2026-10-29T12:00:00.000Z");
    assert.equal(isFinishedForTray({ ...base, stage: "noted", updatedAt: "2026-10-29T11:00:00.000Z" }, now), true);
    assert.equal(isFinishedForTray({ ...base, stage: "noted", updatedAt: "2026-10-27T11:00:00.000Z" }, now), false);
    assert.equal(isFinishedForTray({ ...base, stage: "noting" }, now), false);
  });
});
