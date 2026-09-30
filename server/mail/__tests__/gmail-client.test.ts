import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-gmail-"));
process.env.AGENTOS_UI_DIR = directory;
process.env.GOOGLE_CLIENT_ID = "client-id";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";

fs.writeFileSync(
  path.join(directory, "mail-auth.json"),
  JSON.stringify({ refreshToken: "stored-refresh-token", obtainedAt: new Date().toISOString() }),
);

const { resetAccessTokenCache } = await import("../gmail-auth");
const { getThreadBody, getThreadSummary, listInboxThreadIds, parseFromHeader } = await import("../gmail-client");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Every gmail-client call refreshes a token first; this answers both legs by URL. */
function stubGoogle(gmailHandler: (url: URL) => Response) {
  globalThis.fetch = mock.fn((input: string | URL) => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") {
      return jsonResponse({ access_token: "at-1", expires_in: 3600 });
    }
    return gmailHandler(url);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetAccessTokenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseFromHeader", () => {
  it("splits a display name and address", () => {
    assert.deepEqual(parseFromHeader("Gavin Smith <gavin@example.com>"), {
      name: "Gavin Smith",
      email: "gavin@example.com",
    });
  });

  it("falls back to the bare address when there is no display name", () => {
    assert.deepEqual(parseFromHeader("gavin@example.com"), { email: "gavin@example.com" });
  });

  it("returns an empty object for an absent header", () => {
    assert.deepEqual(parseFromHeader(undefined), {});
  });
});

describe("listInboxThreadIds", () => {
  it("returns the thread ids from Gmail's list response", async () => {
    stubGoogle(() => jsonResponse({ threads: [{ id: "t1" }, { id: "t2" }] }));

    assert.deepEqual(await listInboxThreadIds(), ["t1", "t2"]);
  });

  it("asks Gmail only for the last month of inbox mail", async () => {
    let requested: URL | undefined;
    stubGoogle((url) => {
      requested = url;
      return jsonResponse({ threads: [] });
    });

    await listInboxThreadIds();
    assert.equal(requested?.searchParams.get("q"), "newer_than:30d");
    assert.deepEqual(requested?.searchParams.getAll("labelIds"), ["INBOX"]);
  });

  it("returns an empty list when the inbox has nothing", async () => {
    stubGoogle(() => jsonResponse({}));

    assert.deepEqual(await listInboxThreadIds(), []);
  });
});

describe("getThreadSummary", () => {
  it("reads the latest message's sender, subject, snippet and date", async () => {
    stubGoogle(() =>
      jsonResponse({
        messages: [
          {
            snippet: "First message",
            payload: { headers: [{ name: "From", value: "old@example.com" }] },
          },
          {
            snippet: "Can we push pricing live?",
            payload: {
              headers: [
                { name: "From", value: "Gavin Smith <gavin@example.com>" },
                { name: "Subject", value: "Vaja configurator" },
                { name: "Date", value: "Wed, 23 Sep 2026 09:42:00 +0000" },
              ],
            },
          },
        ],
      }),
    );

    const summary = await getThreadSummary("t1");

    assert.equal(summary.fromName, "Gavin Smith");
    assert.equal(summary.fromEmail, "gavin@example.com");
    assert.equal(summary.subject, "Vaja configurator");
    assert.equal(summary.snippet, "Can we push pricing live?");
    assert.equal(summary.messageDate, "2026-09-23T09:42:00.000Z");
  });
});

describe("getThreadBody", () => {
  it("decodes the latest message's plain-text body", async () => {
    const encoded = Buffer.from("Hello — the tiers are ready.", "utf8").toString("base64url");

    stubGoogle(() =>
      jsonResponse({
        messages: [
          { payload: { mimeType: "text/plain", body: { data: encoded } } },
        ],
      }),
    );

    assert.equal(await getThreadBody("t1"), "Hello — the tiers are ready.");
  });

  it("finds a plain-text part nested inside a multipart message", async () => {
    const encoded = Buffer.from("Nested body text.", "utf8").toString("base64url");

    stubGoogle(() =>
      jsonResponse({
        messages: [
          {
            payload: {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/html", body: { data: "aWdub3JlZA" } },
                { mimeType: "text/plain", body: { data: encoded } },
              ],
            },
          },
        ],
      }),
    );

    assert.equal(await getThreadBody("t1"), "Nested body text.");
  });

  it("reports a placeholder when no plain-text part exists", async () => {
    stubGoogle(() => jsonResponse({ messages: [{ payload: { mimeType: "text/html", body: {} } }] }));

    assert.match(await getThreadBody("t1"), /no plain-text body/i);
  });
});
