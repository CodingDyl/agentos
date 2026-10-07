import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnimateDecisionSchema, AnimateRequestSchema } from "../../../shared/animate-types";
import { animateClaudeArgs, checkpointImagePath, isAnimateId } from "../animate";

const base = { prompt: "FIRST", model: "opus", attempts: 0, stage: "story" as const };

describe("Claude Motion intake", () => {
  it("needs a topic and defaults the length and format", () => {
    assert.equal(AnimateRequestSchema.safeParse({ topic: "  " }).success, false);
    const parsed = AnimateRequestSchema.parse({ topic: "How a bill becomes law" });
    assert.equal(parsed.durationSec, 20);
    assert.deepEqual(parsed.formats, ["9:16"]);
  });

  it("asks what to change when changes are requested without a note", () => {
    assert.equal(AnimateDecisionSchema.safeParse({ decision: "changes" }).success, false);
    assert.equal(AnimateDecisionSchema.safeParse({ decision: "approve" }).success, true);
  });
});

describe("running a stage", () => {
  it("starts with the full prompt, then resumes the session with only what the operator decided", () => {
    const first = animateClaudeArgs(base);
    assert.equal(first.includes("--resume"), false);
    assert.equal(first[first.indexOf("-p") + 1], "FIRST");

    const next = animateClaudeArgs({ ...base, attempts: 1, sessionId: "s1", pendingPrompt: "The operator approved the story." });
    assert.equal(next[next.indexOf("--resume") + 1], "s1");
    assert.equal(next[next.indexOf("-p") + 1], "The operator approved the story.");
  });

  it("builds at max effort and checks gates at high", () => {
    const effort = (stage: "story" | "build") => {
      const args = animateClaudeArgs({ ...base, stage });
      return args[args.indexOf("--effort") + 1];
    };
    assert.equal(effort("story"), "high");
    assert.equal(effort("build"), "max");
  });

  it("allows web search for fact checks but never pushing code", () => {
    const args = animateClaudeArgs(base);
    assert.ok(args.slice(args.indexOf("--allowedTools"), args.indexOf("--disallowedTools")).includes("WebSearch"));
    assert.ok(args.includes("Bash(git push:*)"));
  });
});

describe("serving checkpoint frames", () => {
  const id = "anm_0123456789abcdef";
  it("serves a named frame of a known stage", () => {
    assert.ok(isAnimateId(id));
    assert.match(checkpointImagePath(id, "look", "look-1.png") ?? "", /checkpoints\/look\/look-1\.png$/);
    assert.match(checkpointImagePath(id, "build", "contact.png") ?? "", /checkpoints\/delivery\/contact\.png$/);
  });

  it("refuses paths, other stages and non-images", () => {
    assert.equal(checkpointImagePath(id, "look", "../../../etc/passwd"), undefined);
    assert.equal(checkpointImagePath(id, "look", "notes.md"), undefined);
    assert.equal(checkpointImagePath(id, "../x", "a.png"), undefined);
    assert.equal(checkpointImagePath("anm_x", "look", "a.png"), undefined);
  });
});
