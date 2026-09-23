import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { readDecision, respondToApproval } from "../approvals";
import { HermesError } from "../client";

/**
 * The approval endpoint is the only write path in the system, so it has to be
 * exact: the decision reaches Hermes as sent, the key never leaves the server,
 * and a refused decision is reported rather than treated as an approval.
 */

const KEY = "secret-key-value";
const originalFetch = globalThis.fetch;

interface Captured {
  url: string;
  init: RequestInit;
}

function captureFetch(status = 200, body: unknown = {}): Captured[] {
  const calls: Captured[] = [];

  globalThis.fetch = mock.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;

  return calls;
}

beforeEach(() => {
  process.env.HERMES_API_KEY = KEY;
  process.env.HERMES_BASE_URL = "http://127.0.0.1:8642/v1";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.HERMES_API_KEY;
  delete process.env.HERMES_BASE_URL;
});

describe("reading a decision", () => {
  it("accepts Hermes' vocabulary", () => {
    for (const decision of ["once", "session", "always", "deny"]) {
      assert.equal(readDecision(decision), decision);
    }
  });

  it("refuses anything else", () => {
    assert.equal(readDecision("approve"), undefined);
    assert.equal(readDecision("ONCE"), undefined);
    assert.equal(readDecision(true), undefined);
    assert.equal(readDecision(undefined), undefined);
  });
});

describe("recording a decision", () => {
  it("posts to the run's approval endpoint", async () => {
    const calls = captureFetch();

    await respondToApproval("run-1", "req-9", "once");

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://127.0.0.1:8642/v1/runs/run-1/approval",
    );
    assert.equal(calls[0].init.method, "POST");
  });

  it("echoes back the request id Hermes published, with the decision", async () => {
    const calls = captureFetch();

    await respondToApproval("run-1", "req-9", "session");

    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      request_id: "req-9",
      decision: "session",
    });
  });

  it("sends no file content — only a decision", async () => {
    const calls = captureFetch();

    await respondToApproval("run-1", "req-9", "once");

    assert.deepEqual(Object.keys(JSON.parse(String(calls[0].init.body))).sort(), [
      "decision",
      "request_id",
    ]);
  });

  it("escapes ids in the path", async () => {
    const calls = captureFetch();

    await respondToApproval("run/../other", "req-9", "deny");

    assert.ok(!calls[0].url.includes("/../"), calls[0].url);
  });

  it("authenticates without exposing the key in the body", async () => {
    const calls = captureFetch();

    await respondToApproval("run-1", "req-9", "once");

    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${KEY}`);
    assert.ok(!String(calls[0].init.body).includes(KEY));
  });

  it("reports a request Hermes no longer has", async () => {
    captureFetch(404);

    await assert.rejects(
      respondToApproval("run-1", "gone", "once"),
      (error: unknown) =>
        error instanceof HermesError &&
        error.message.includes("no longer has that approval"),
    );
  });

  it("reports an already-answered request", async () => {
    captureFetch(409);

    await assert.rejects(respondToApproval("run-1", "req-9", "once"), HermesError);
  });

  it("classifies a rejected key", async () => {
    captureFetch(401);

    await assert.rejects(
      respondToApproval("run-1", "req-9", "once"),
      (error: unknown) =>
        error instanceof HermesError && error.reason === "unauthorized",
    );
  });

  it("refuses to run at all without a key", async () => {
    delete process.env.HERMES_API_KEY;
    captureFetch();

    await assert.rejects(
      respondToApproval("run-1", "req-9", "once"),
      (error: unknown) =>
        error instanceof HermesError && error.reason === "not-configured",
    );
  });
});
