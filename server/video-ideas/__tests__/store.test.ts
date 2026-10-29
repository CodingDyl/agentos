import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { closeLearningDatabase } from "../../learning/db";
import { createIdea, getIdea, ideaForSource, listIdeas, pastDecisions, updateIdea } from "../store";

after(() => closeLearningDatabase());

const source = (id: string) => ({ id, externalId: "dQw4w9WgXcQ", title: `Video ${id}` });

describe("video idea store", () => {
  it("keeps one idea per source, and upgrades learn to assess", () => {
    const first = createIdea(source("ls-a"), "learn");
    assert.equal(first.stage, "transcribing");
    assert.equal(first.mode, "learn");
    const again = createIdea(source("ls-a"), "assess");
    assert.equal(again.id, first.id);
    assert.equal(again.mode, "assess");
    assert.equal(again.stage, "transcribing");
    assert.equal(ideaForSource("ls-a")?.id, first.id);
  });

  it("keeps a noted idea noted when it is upgraded", () => {
    const idea = createIdea(source("ls-b"), "learn");
    updateIdea(idea.id, { stage: "noted" });
    const upgraded = createIdea(source("ls-b"), "assess");
    assert.equal(upgraded.stage, "noted");
    assert.equal(upgraded.mode, "assess");
  });

  it("never downgrades assess to learn", () => {
    const idea = createIdea(source("ls-c"), "assess");
    assert.equal(createIdea(source("ls-c"), "learn").mode, "assess");
    assert.equal(getIdea(idea.id)?.mode, "assess");
  });

  it("round-trips the plan and task ids", () => {
    const idea = createIdea(source("ls-d"), "assess");
    updateIdea(idea.id, {
      plan: [{ title: "Add X", objective: "Do X in server/x.ts", acceptanceCriteria: ["X works"] }],
      taskIds: ["FEATURE-9"],
      currentTask: 0,
    });
    const read = getIdea(idea.id)!;
    assert.equal(read.plan?.[0].title, "Add X");
    assert.deepEqual(read.taskIds, ["FEATURE-9"]);
    assert.equal(read.currentTask, 0);
    assert.ok(listIdeas().some((entry) => entry.id === idea.id));
  });

  it("lists past decisions with their reasons", () => {
    const idea = createIdea(source("ls-e"), "assess");
    updateIdea(idea.id, { stage: "declined", verdict: "adopt", declineReason: "We already have this" });
    const decisions = pastDecisions();
    const found = decisions.find((entry) => entry.title === "Video ls-e");
    assert.deepEqual(found, { title: "Video ls-e", verdict: "adopt", decision: "declined", reason: "We already have this" });
  });
});
