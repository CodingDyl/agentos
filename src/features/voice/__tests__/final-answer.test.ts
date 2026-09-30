import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastAssistantReply, recoverAnswer } from "../final-answer";

const noSleep = async () => undefined;

describe("lastAssistantReply", () => {
  it("returns the reply that follows this question", () => {
    const reply = lastAssistantReply(
      [
        { role: "user", content: "Give me my morning brief" },
        { role: "assistant", content: "Old brief." },
        { role: "user", content: "Current project: pantry-pilot\n\nWhat should I focus on?" },
        { role: "tool", content: "{...}" },
        { role: "assistant", content: "Focus on the sync bug." },
      ],
      "What should I focus on?",
    );
    assert.equal(reply, "Focus on the sync bug.");
  });

  it("does not speak the previous question's reply when this turn is not written yet", () => {
    const reply = lastAssistantReply(
      [
        { role: "user", content: "Give me my morning brief" },
        { role: "assistant", content: "Old brief." },
      ],
      "What should I focus on?",
    );
    assert.equal(reply, undefined);
  });

  it("takes the final assistant message when there are several, skipping empty ones", () => {
    const reply = lastAssistantReply(
      [
        { role: "user", content: "Plan my day" },
        { role: "assistant", content: "Let me look." },
        { role: "tool", content: "x" },
        { role: "assistant", content: "Here is the plan." },
        { role: "assistant", content: "   " },
      ],
      "Plan my day",
    );
    assert.equal(reply, "Here is the plan.");
  });

  it("ignores line wrapping and spacing differences", () => {
    const reply = lastAssistantReply(
      [
        { role: "user", content: "Create a task\nfor   the Vaja sauna project" },
        { role: "assistant", content: "Done." },
      ],
      "Create a task for the Vaja sauna project",
    );
    assert.equal(reply, "Done.");
  });

  it("finds nothing for an empty question or an empty transcript", () => {
    assert.equal(lastAssistantReply([], "hello"), undefined);
    assert.equal(lastAssistantReply([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }], "  "), undefined);
  });
});

describe("recoverAnswer", () => {
  it("prefers the run's own output", async () => {
    const answer = await recoverAnswer({
      runOutput: async () => "From the run.",
      transcript: async () => {
        throw new Error("should not be needed");
      },
      sent: "hi",
      sleep: noSleep,
    });
    assert.equal(answer, "From the run.");
  });

  it("falls back to the transcript when the run recorded nothing", async () => {
    const answer = await recoverAnswer({
      runOutput: async () => undefined,
      transcript: async () => [
        { role: "user", content: "hi there" },
        { role: "assistant", content: "Hello, sir." },
      ],
      sent: "hi there",
      sleep: noSleep,
    });
    assert.equal(answer, "Hello, sir.");
  });

  it("waits for a turn Hermes is still writing", async () => {
    let calls = 0;
    const answer = await recoverAnswer({
      runOutput: async () => undefined,
      transcript: async () => {
        calls++;
        return calls < 3
          ? [{ role: "user", content: "hi there" }]
          : [
              { role: "user", content: "hi there" },
              { role: "assistant", content: "Now it is written." },
            ];
      },
      sent: "hi there",
      sleep: noSleep,
    });
    assert.equal(answer, "Now it is written.");
    assert.equal(calls, 3);
  });

  it("survives a failing source and gives up cleanly", async () => {
    const answer = await recoverAnswer({
      runOutput: async () => {
        throw new Error("404");
      },
      transcript: async () => {
        throw new Error("offline");
      },
      sent: "hi",
      attempts: 2,
      sleep: noSleep,
    });
    assert.equal(answer, undefined);
  });
});
