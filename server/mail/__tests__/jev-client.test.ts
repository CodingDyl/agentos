import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

// An empty, isolated vault: `classifyThread` reads live projects for its
// `business` question, and this test must never touch the real ~/AgentOS.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-jev-root-"));
process.env.AGENTOS_ROOT = root;

const { classifyThread, isJevConfigured, JevError } = await import("../jev-client");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fullAnswerSet() {
  return {
    model: "jev-1.0.0",
    answers: {
      category: { type: "choice", choice: "client", probabilities: { client: 0.9 }, confidence: 0.9 },
      needs_reply: { type: "noul", noul: 0.85 },
      urgency: { type: "score", score: 3.4, legend: {}, probabilities: {}, confidence: 0.7 },
      business: { type: "choice", choice: "none", probabilities: { none: 1 }, confidence: 0.6 },
      financial: { type: "noul", noul: 0.1 },
      action_required: { type: "noul", noul: 0.2 },
      automated: { type: "noul", noul: 0.05 },
    },
  };
}

beforeEach(() => {
  process.env.JEV_API_KEY = "jev-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.JEV_API_KEY;
});

describe("isJevConfigured", () => {
  it("is false without an API key", () => {
    delete process.env.JEV_API_KEY;
    assert.equal(isJevConfigured(), false);
  });

  it("is true with one", () => {
    assert.equal(isJevConfigured(), true);
  });
});

describe("classifyThread", () => {
  it("sends only sender, subject, snippet and date as state — never a body", async () => {
    let sentBody: string | undefined;
    globalThis.fetch = mock.fn((_url: string, init: RequestInit) => {
      sentBody = init.body as string;
      return jsonResponse(fullAnswerSet());
    }) as unknown as typeof fetch;

    await classifyThread({
      from: "gavin@example.com",
      subject: "Vaja configurator",
      snippet: "Can we push pricing live?",
      date: "2026-09-23T09:42:00.000Z",
    });

    const parsed = JSON.parse(sentBody ?? "{}");
    assert.deepEqual(parsed.state.email, {
      from: "gavin@example.com",
      subject: "Vaja configurator",
      snippet: "Can we push pricing live?",
      date: "2026-09-23T09:42:00.000Z",
    });
    assert.deepEqual(Object.keys(parsed.state).sort(), ["email", "recipient"]);
    assert.deepEqual(Object.keys(parsed.questions).sort(), [
      "action_required",
      "automated",
      "business",
      "category",
      "financial",
      "needs_reply",
      "urgency",
    ]);
  });

  it("sends the recipient's corrections as worked examples and points the questions at them", async () => {
    let sentBody: string | undefined;
    globalThis.fetch = mock.fn((_url: string, init: RequestInit) => {
      sentBody = init.body as string;
      return jsonResponse(fullAnswerSet());
    }) as unknown as typeof fetch;

    await classifyThread({
      from: "alerts@sentry.io",
      subject: "Watchdog termination",
      snippet: "Your app was terminated",
      date: "2026-09-23T09:42:00.000Z",
      corrections: [
        {
          from: "alerts@sentry.io",
          subject: "New issue",
          snippet: "TypeError in checkout",
          bucket: "fyi",
          category: "notification",
        },
      ],
    });

    const parsed = JSON.parse(sentBody ?? "{}");
    assert.deepEqual(parsed.state.recipient_corrections, [
      {
        email: { from: "alerts@sentry.io", subject: "New issue", snippet: "TypeError in checkout" },
        recipient_said: "FYI: worth knowing, no reply or action needed",
        correct_category: "notification",
      },
    ]);
    assert.match(parsed.questions.needs_reply.instructions.guidance, /recipient_corrections/);
  });

  it("posts to the Jev endpoint with a bearer token", async () => {
    let calledUrl: string | undefined;
    let authHeader: string | undefined;
    globalThis.fetch = mock.fn((url: string, init: RequestInit) => {
      calledUrl = url;
      authHeader = (init.headers as Record<string, string>).Authorization;
      return jsonResponse(fullAnswerSet());
    }) as unknown as typeof fetch;

    await classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" });

    assert.equal(calledUrl, "https://api.typesafe.ai/v1/systemone");
    assert.equal(authHeader, "Bearer jev-secret");
  });

  it("maps a full answer set onto the classification result", async () => {
    globalThis.fetch = mock.fn(() => jsonResponse(fullAnswerSet())) as unknown as typeof fetch;

    const result = await classifyThread({
      from: "a@b.com",
      subject: "s",
      snippet: "sn",
      date: "2026-09-23T00:00:00.000Z",
    });

    assert.deepEqual(result, {
      category: "client",
      needsReply: 0.85,
      urgency: 3.4,
      business: "none",
      financial: 0.1,
      actionRequired: 0.2,
      automated: 0.05,
    });
  });

  it("throws not-configured without an API key", async () => {
    delete process.env.JEV_API_KEY;

    await assert.rejects(
      () => classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" }),
      (error: unknown) => {
        assert.ok(error instanceof JevError);
        assert.equal(error.reason, "not-configured");
        return true;
      },
    );
  });

  it("classifies a 401 as unauthorized", async () => {
    globalThis.fetch = mock.fn(() => jsonResponse({}, 401)) as unknown as typeof fetch;

    await assert.rejects(
      () => classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" }),
      (error: unknown) => {
        assert.ok(error instanceof JevError);
        assert.equal(error.reason, "unauthorized");
        return true;
      },
    );
  });

  it("throws failed when an answer is missing", async () => {
    globalThis.fetch = mock.fn(() => jsonResponse({ model: "jev", answers: {} })) as unknown as typeof fetch;

    await assert.rejects(
      () => classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" }),
      (error: unknown) => {
        assert.ok(error instanceof JevError);
        assert.equal(error.reason, "failed");
        return true;
      },
    );
  });
});
