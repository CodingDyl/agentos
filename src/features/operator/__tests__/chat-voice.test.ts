import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatApprovalPart, ChatMessage } from "@shared/chat-types";
import { approvalPrompt, confirmPrompt, parseChatVoiceCommand, pendingApproval, spokenSummary } from "../chat-voice";

const kind = (text: string) => parseChatVoiceCommand(text)?.kind;

describe("what a spoken sentence means in a chat", () => {
  it("short commands, with or without the wake word", () => {
    assert.equal(kind("Stop."), "stop");
    assert.equal(kind("Jarvis, stop it"), "stop");
    assert.equal(kind("allow"), "allow");
    assert.equal(kind("Go ahead"), "allow");
    assert.equal(kind("Confirm."), "confirm");
    assert.equal(kind("New chat"), "new-chat");
    assert.equal(kind("clear the chat"), "new-chat");
  });

  it("saying no, in the ways people say it", () => {
    for (const phrase of ["don't allow", "Don't allow it", "do not run that", "deny", "no", "nope", "reject"]) {
      assert.equal(kind(phrase), "deny", phrase);
    }
  });

  it("a sentence that only starts like a command is a message", () => {
    assert.deepEqual(parseChatVoiceCommand("stop the build failing on CI"), { kind: "message", text: "stop the build failing on CI" });
    assert.deepEqual(parseChatVoiceCommand("Hey Jarvis, allow me to explain the bug"), { kind: "message", text: "allow me to explain the bug" });
    assert.equal(parseChatVoiceCommand("  "), undefined);
  });
});

const approval: ChatApprovalPart = { type: "approval", id: "a1", tool: "Bash", summary: "git push origin main", reason: "Runs git, which isn't on the read-only list.", status: "pending" };

describe("what Jarvis says", () => {
  it("names the action and the reason, then asks", () => {
    assert.equal(approvalPrompt("Codex", approval), "Codex wants to run git push origin main. Runs git, which isn't on the read-only list. Say allow, or don't allow.");
  });

  it("reads back exactly what will run before 'confirm' lets it", () => {
    assert.equal(confirmPrompt(approval), "It will run git push origin main. Say confirm to go ahead.");
    assert.equal(confirmPrompt({ ...approval, tool: "Edit", summary: "/etc/hosts" }), "It will edit /etc/hosts. Say confirm to go ahead.");
  });

  it("finds the approval waiting in a reply", () => {
    const message: ChatMessage = { id: "m", role: "assistant", createdAt: "", parts: [{ type: "text", text: "Hi" }, approval] };
    assert.equal(pendingApproval(message)?.id, "a1");
    assert.equal(pendingApproval({ ...message, parts: [{ ...approval, status: "allowed" }] }), undefined);
  });

  it("speaks the first sentences of a reply, without code or markdown", () => {
    const message: ChatMessage = {
      id: "m",
      role: "assistant",
      createdAt: "",
      parts: [{ type: "text", text: "## Fixed\nThe **lint** errors were in `animate.test.ts`. I typed them properly.\n```ts\nconst x = 1;\n```\nThird sentence here." }],
    };
    assert.equal(spokenSummary(message), "Fixed The lint errors were in animate.test.ts. I typed them properly.");
    assert.equal(spokenSummary({ ...message, error: "Stopped." }), "Stopped.");
    assert.equal(spokenSummary({ ...message, parts: [] }), undefined);
  });
});
