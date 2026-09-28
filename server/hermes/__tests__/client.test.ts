import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NO_EM_DASH_RULE } from "../../../shared/plain-text";
import { getHermesStatus, HermesError, sendToHermes } from "../client";

/**
 * The key must never escape the server, and every failure must be classified
 * so the console can say what actually went wrong instead of guessing.
 */

const KEY = "secret-key-value";
const originalFetch = globalThis.fetch;

function stubFetch(handler: () => Promise<Response> | Response) {
  globalThis.fetch = mock.fn(handler) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.HERMES_API_KEY = KEY;
  process.env.HERMES_BASE_URL = "http://127.0.0.1:8642/v1";
  process.env.HERMES_MODEL = "hermes";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.HERMES_API_KEY;
  delete process.env.HERMES_BASE_URL;
  delete process.env.HERMES_MODEL;
});

describe("status", () => {
  it("reports configured without contacting Hermes", () => {
    stubFetch(() => {
      throw new Error("Hermes must not be contacted for status");
    });

    assert.deepEqual(getHermesStatus(), {
      configured: true,
      baseUrl: "http://127.0.0.1:8642/v1",
      model: "hermes",
    });
  });

  it("never includes the key", () => {
    assert.ok(!JSON.stringify(getHermesStatus()).includes(KEY));
  });

  it("reports unconfigured when the key is blank", () => {
    process.env.HERMES_API_KEY = "   ";

    assert.deepEqual(getHermesStatus(), { configured: false });
  });
});

describe("sending", () => {
  it("returns the reply text on success", async () => {
    stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "AGENTOS CONNECTED" } }] }),
    );

    assert.equal(await sendToHermes("ping"), "AGENTOS CONNECTED");
  });

  it("sends the prompt with the house-style rule and the configured model", async () => {
    let body: string | undefined;
    globalThis.fetch = mock.fn((_url: string, init: RequestInit) => {
      body = init.body as string;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as unknown as typeof fetch;

    await sendToHermes("hello");

    assert.deepEqual(JSON.parse(body ?? "{}"), {
      model: "hermes",
      messages: [
        { role: "system", content: NO_EM_DASH_RULE },
        { role: "user", content: "hello" },
      ],
    });
  });

  it("returns the reply without em dashes, whatever Hermes wrote", async () => {
    globalThis.fetch = mock.fn(() =>
      jsonResponse({ choices: [{ message: { content: "Fast — and it converts. Code: `a — b`" } }] }),
    ) as unknown as typeof fetch;

    assert.equal(await sendToHermes("hello"), "Fast, and it converts. Code: `a — b`");
  });
});

describe("failure classification", () => {
  async function reasonFor(handler: () => Promise<Response> | Response) {
    stubFetch(handler);
    try {
      await sendToHermes("ping");
      return "no-error";
    } catch (error) {
      return error instanceof HermesError ? error.reason : "wrong-error-type";
    }
  }

  it("reports a missing key as not-configured", async () => {
    delete process.env.HERMES_API_KEY;

    assert.equal(
      await reasonFor(() => {
        throw new Error("must not be called without a key");
      }),
      "not-configured",
    );
  });

  it("reports a slow Hermes as timed out, not as unreachable", async () => {
    // The timeout signal is created inside `hermesFetch`, so the abort guard
    // never saw it and every slow review was reported as "could not reach
    // Hermes" — while Hermes was up and simply thinking. The two need
    // different responses, so they get different reasons.
    stubFetch(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    });

    await assert.rejects(
      sendToHermes("hello", { operation: "other" }),
      (error: HermesError) => error.reason === "timed-out",
    );
  });

  it("reports an unreachable host as offline", async () => {
    assert.equal(
      await reasonFor(() => {
        throw new TypeError("fetch failed");
      }),
      "offline",
    );
  });

  it("reports 401 and 403 as unauthorized", async () => {
    assert.equal(await reasonFor(() => jsonResponse({}, 401)), "unauthorized");
    assert.equal(await reasonFor(() => jsonResponse({}, 403)), "unauthorized");
  });

  it("reports other error statuses as failed", async () => {
    assert.equal(await reasonFor(() => jsonResponse({}, 500)), "failed");
  });

  it("reports an empty completion as failed rather than an empty reply", async () => {
    assert.equal(
      await reasonFor(() => jsonResponse({ choices: [{ message: { content: "" } }] })),
      "failed",
    );
    assert.equal(await reasonFor(() => jsonResponse({ choices: [] })), "failed");
  });

  it("never puts the key in an error message", async () => {
    const cases = [
      () => jsonResponse({}, 401),
      () => jsonResponse({}, 500),
      () => {
        throw new TypeError("fetch failed");
      },
    ];

    for (const handler of cases) {
      stubFetch(handler);
      await assert.rejects(
        () => sendToHermes("ping"),
        (error: Error) => !error.message.includes(KEY),
      );
    }
  });
});

describe("instructions that must outrank the persona", () => {
  /**
   * Hermes' `SOUL.md` tells it to answer briefly and to report finished work
   * as "what changed, what's verified, what's left". That beat the review
   * skill's output contract while the contract travelled inside the prompt,
   * and reviews came back as prose with no JSON block. A system message is
   * where a caller's schema wins, so the client has to actually send one.
   */
  it("sends a system message ahead of the prompt when the caller supplies one", async () => {
    let sent: { role: string; content: string }[] = [];

    stubFetch(async (...args: unknown[]) => {
      const init = args[1] as RequestInit;
      sent = JSON.parse(String(init.body)).messages;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });

    await sendToHermes("the packet", { operation: "code-review", system: "the schema" });

    assert.deepEqual(sent, [
      { role: "system", content: `the schema\n\n${NO_EM_DASH_RULE}` },
      { role: "user", content: "the packet" },
    ]);
  });

  it("sends only the house-style rule as system when there is nothing else to override", async () => {
    let sent: { role: string; content: string }[] = [];

    stubFetch(async (...args: unknown[]) => {
      const init = args[1] as RequestInit;
      sent = JSON.parse(String(init.body)).messages;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });

    await sendToHermes("just asking", { operation: "other" });

    assert.deepEqual(sent, [
      { role: "system", content: NO_EM_DASH_RULE },
      { role: "user", content: "just asking" },
    ]);
  });
});
