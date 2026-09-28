import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-auth-"));
process.env.AGENTOS_UI_DIR = directory;

const {
  buildConsentUrl,
  completeGmailConnection,
  disconnectGmail,
  getAccessToken,
  GmailAuthError,
  isGmailConfigured,
  isGmailConnected,
  resetAccessTokenCache,
} = await import("../gmail-auth");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  resetAccessTokenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("configuration", () => {
  it("is configured once both env vars are set", () => {
    assert.equal(isGmailConfigured(), true);
  });

  it("is not configured when the secret is missing", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.equal(isGmailConfigured(), false);
  });
});

describe("buildConsentUrl", () => {
  it("points at Google's consent screen with the modify scope — never full mail access", () => {
    const url = new URL(buildConsentUrl());

    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "client-id");
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.modify");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  it("carries a loopback return origin through Google in state", () => {
    const url = new URL(buildConsentUrl("http://localhost:1420/inbox"));
    assert.equal(url.searchParams.get("state"), "http://localhost:1420");
  });

  it("never carries a non-loopback origin, so the callback can't be an open redirect", () => {
    assert.equal(new URL(buildConsentUrl("https://evil.example/inbox")).searchParams.get("state"), null);
    assert.equal(new URL(buildConsentUrl("not a url")).searchParams.get("state"), null);
  });

  it("throws not-configured when there is no client id", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    assert.throws(() => buildConsentUrl(), (error: unknown) => {
      assert.ok(error instanceof GmailAuthError);
      assert.equal(error.reason, "not-configured");
      return true;
    });
  });
});

describe("connection lifecycle", () => {
  it("is not connected before completing a connection", async () => {
    assert.equal(await isGmailConnected(), false);
  });

  it("stores a refresh token after completing the connection", async () => {
    globalThis.fetch = mock.fn(() =>
      jsonResponse({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" }),
    ) as unknown as typeof fetch;

    await completeGmailConnection("auth-code");

    assert.equal(await isGmailConnected(), true);
  });

  it("mints an access token from the stored refresh token", async () => {
    globalThis.fetch = mock.fn(() =>
      jsonResponse({ access_token: "at-2", expires_in: 3600 }),
    ) as unknown as typeof fetch;

    assert.equal(await getAccessToken(), "at-2");
  });

  it("caches the access token rather than refreshing on every call", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(() => {
      calls += 1;
      return jsonResponse({ access_token: "at-3", expires_in: 3600 });
    }) as unknown as typeof fetch;

    await getAccessToken();
    await getAccessToken();

    assert.equal(calls, 1);
  });

  it("disconnects and reports unauthorized when the refresh token is revoked", async () => {
    resetAccessTokenCache();
    globalThis.fetch = mock.fn(() => jsonResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;

    await assert.rejects(() => getAccessToken(), (error: unknown) => {
      assert.ok(error instanceof GmailAuthError);
      assert.equal(error.reason, "unauthorized");
      return true;
    });

    assert.equal(await isGmailConnected(), false);
  });

  it("disconnect is safe to call when already disconnected", async () => {
    await disconnectGmail();
    await disconnectGmail();
    assert.equal(await isGmailConnected(), false);
  });
});
