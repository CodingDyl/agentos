import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_CONFLICT_RULE } from "../../../shared/memory-ownership";
import { assistantSystemPrompt } from "../assistant-home";

describe("assistant system prompt", () => {
  it("tells the assistant which memory wins a disagreement", () => {
    assert.ok(assistantSystemPrompt({ home: "/tmp/home", aboutMe: "" }).includes(MEMORY_CONFLICT_RULE));
  });
});
