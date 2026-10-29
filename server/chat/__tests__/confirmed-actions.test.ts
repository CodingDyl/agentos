import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { ChatMessage } from "../../../shared/chat-types";
import type { ApprovalRequest, RunTurnInput } from "../chat-turn";
import { startTurn, toolGate } from "../claude-chat-adapter";
import { decideToolUse, summariseToolInput } from "../chat-permission-policy";
import { clearGrants, consumeGrant, describeGatedAction, GRANT_TTL_MS, grantAction, isGatedTool } from "../confirmed-actions";

/**
 * Sending and spending from a chat: the operator's OK is checked on the
 * server, for exactly what they were shown, once, and not for long.
 */

const SEND = "mcp__agentos__send_email";
const JOB = "mcp__agentos__start_job";
const email = { to: ["sam@example.com"], subject: "Quote", body: "Hi Sam, the quote is attached." };
const context = { projectRoot: "/vault/assistant", mode: "assistant" as const };

beforeEach(() => clearGrants());

describe("the confirmation gate", () => {
  it("knows which tools send or spend", () => {
    assert.equal(isGatedTool(SEND), true);
    assert.equal(isGatedTool(JOB), true);
    assert.equal(isGatedTool("send_email"), true);
    assert.equal(isGatedTool("mcp__agentos__draft_email"), false);
    assert.equal(isGatedTool("mcp__agentos__overdue_invoices"), false);
    assert.equal(isGatedTool("mcp__agentos__toString"), false);
  });

  it("refuses without a confirmation", () => {
    const check = consumeGrant(SEND, email);
    assert.equal(check.ok, false);
  });

  it("allows exactly the confirmed action, once", () => {
    assert.equal(grantAction(SEND, email), true);
    assert.deepEqual(consumeGrant(SEND, email), { ok: true });
    assert.equal(consumeGrant(SEND, email).ok, false, "a confirmation is spent by the send");
  });

  it("rejects a confirmation for a different recipient, subject or body", () => {
    grantAction(SEND, email);
    assert.equal(consumeGrant(SEND, { ...email, to: ["attacker@evil.example"] }).ok, false);
    grantAction(SEND, email);
    assert.equal(consumeGrant(SEND, { ...email, subject: "Invoice" }).ok, false);
    grantAction(SEND, email);
    assert.equal(consumeGrant(SEND, { ...email, body: "Different words" }).ok, false);
    grantAction(SEND, email);
    assert.equal(consumeGrant(JOB, email).ok, false, "an email's OK doesn't start a job");
  });

  it("rejects a stale confirmation", () => {
    const now = 1_000_000;
    grantAction(SEND, email, now);
    const check = consumeGrant(SEND, email, now + GRANT_TTL_MS + 1);
    assert.equal(check.ok, false);
    assert.match(check.ok ? "" : check.reason, /expired/);
  });

  it("treats two spellings of one email as the same action", () => {
    grantAction(SEND, { ...email, to: [" sam@example.com "], cc: undefined });
    assert.equal(consumeGrant(SEND, email).ok, true);
  });

  it("never grants an invalid request", () => {
    assert.equal(grantAction(SEND, { to: ["not an address"], subject: "x", body: "y" }), false);
    assert.equal(grantAction(SEND, { to: [], subject: "x", body: "y" }), false);
    assert.equal(grantAction(JOB, { project: "", objective: "x" }), false);
    assert.equal(consumeGrant(SEND, { to: "sam@example.com" }).ok, false);
  });

  it("shows the recipient, subject and whole body before asking", () => {
    const shown = describeGatedAction(SEND, { ...email, cc: ["pa@example.com"] });
    assert.ok(shown);
    assert.match(shown.summary, /sam@example\.com/);
    assert.match(shown.summary, /"Quote"/);
    assert.equal(shown.detail, "To: sam@example.com\nCc: pa@example.com\nSubject: Quote\n\nHi Sam, the quote is attached.");
    assert.match(describeGatedAction(JOB, { project: "virtara", objective: "Fix the booking form" })?.detail ?? "", /Fix the booking form/);
  });
});

describe("the chat policy for tools that send or spend", () => {
  it("always asks, whatever else is allowed", () => {
    assert.equal(decideToolUse(SEND, email, context).decision, "ask");
    assert.equal(decideToolUse(JOB, { project: "virtara", objective: "x" }, context).decision, "ask");
    assert.equal(decideToolUse("mcp__agentos__overdue_invoices", {}, context).decision, "allow");
    assert.equal(decideToolUse("mcp__agentos__list_specialists", {}, context).decision, "allow");
  });

  it("summarises an email by who it goes to and its subject", () => {
    assert.equal(summariseToolInput(SEND, email), 'email to sam@example.com, subject "Quote"');
  });
});

describe("the approval records the confirmation", () => {
  function gate(answer: boolean, asked: ApprovalRequest[]) {
    const message: ChatMessage = { id: "msg_1", role: "assistant", parts: [], createdAt: "2026-10-29T10:00:00.000Z" };
    const input = {
      policy: context,
      onChange: () => undefined,
      requestApproval: async (request: ApprovalRequest) => {
        asked.push(request);
        return answer;
      },
    } as unknown as RunTurnInput;
    return toolGate(() => ({ input, state: startTurn(message) }));
  }
  const options = () => ({ signal: new AbortController().signal, suggestions: [], toolUseID: "t1" }) as never;

  it("grants the exact call the operator allowed, with the email shown in full", async () => {
    const asked: ApprovalRequest[] = [];
    const verdict = await gate(true, asked)(SEND, email, options());
    assert.equal(verdict?.behavior, "allow");
    assert.match(asked[0].detail ?? "", /Hi Sam, the quote is attached\./);
    assert.equal(consumeGrant(SEND, email).ok, true);
  });

  it("records nothing when the operator declines", async () => {
    const verdict = await gate(false, [])(SEND, email, options());
    assert.equal(verdict?.behavior, "deny");
    assert.equal(consumeGrant(SEND, email).ok, false);
  });

  it("records nothing for a tool that needs no confirmation", async () => {
    const asked: ApprovalRequest[] = [];
    await gate(true, asked)("mcp__agentos__add_task", { project: "virtara", title: "x" }, options());
    assert.equal(asked.length, 0, "not asked about");
  });
});
