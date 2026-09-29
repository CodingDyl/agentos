import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-outreach-"));
process.env.AGENTOS_UI_DIR = directory;
process.env.GOOGLE_CLIENT_ID = "client-id";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";

const auth = await import("../auth");
const mailAuth = await import("../../mail/gmail-auth");

const OUTREACH_FILE = path.join(directory, "outreach-auth.json");
const MAIN_FILE = path.join(directory, "mail-auth.json");
const realFetch = globalThis.fetch;

/** Google, faked: which account a token belongs to, what a code grants, and whether refresh works. */
let grant = { scope: `${auth.COMPOSE_SCOPE} ${auth.READ_SCOPE}`, address: "outreach@virtara-mail.co.za" };
let refreshWorks = true;

function google(url: string, init?: RequestInit): Response {
  const body = new URLSearchParams(String(init?.body ?? ""));
  if (url.includes("oauth2.googleapis.com/token")) {
    if (body.get("grant_type") === "refresh_token") {
      if (!refreshWorks) return new Response("{}", { status: 400 });
      const token = body.get("refresh_token") === "main-refresh" ? "main-token" : "outreach-token";
      return Response.json({ access_token: token, expires_in: 3600 });
    }
    return Response.json({ access_token: "outreach-token", expires_in: 3600, refresh_token: "outreach-refresh", scope: grant.scope });
  }
  if (url.includes("/users/me/profile")) {
    const bearer = new Headers(init?.headers).get("Authorization");
    return Response.json({ emailAddress: bearer === "Bearer main-token" ? "dylan@main.co.za" : grant.address });
  }
  return new Response("unexpected", { status: 500 });
}

beforeEach(() => {
  fs.rmSync(OUTREACH_FILE, { force: true });
  fs.rmSync(MAIN_FILE, { force: true });
  grant = { scope: `${auth.COMPOSE_SCOPE} ${auth.READ_SCOPE}`, address: "outreach@virtara-mail.co.za" };
  refreshWorks = true;
  auth.resetOutreachTokenCache();
  mailAuth.resetAccessTokenCache();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => google(String(url), init)) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("the consent", () => {
  it("asks for drafts, sending and reading, and for nothing that could delete or reach the calendar", () => {
    const url = new URL(auth.buildOutreachConsentUrl("http://localhost:5173/traction"));
    const scopes = url.searchParams.get("scope")?.split(" ");
    assert.deepEqual(scopes, [auth.COMPOSE_SCOPE, auth.READ_SCOPE]);
    assert.equal(scopes?.some((scope) => scope.endsWith("gmail.modify") || scope.includes("calendar")), false);
    assert.match(url.searchParams.get("prompt") ?? "", /select_account/, "the account chooser, so the main account is not picked silently");
    assert.equal(url.searchParams.get("state"), "outreach|http://localhost:5173");
    assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8787/api/mail/oauth/callback", "the one redirect already registered with Google");
  });

  it("only returns to a loopback address", () => {
    assert.deepEqual(auth.parseOutreachState("outreach|http://localhost:5173"), { origin: "http://localhost:5173" });
    assert.deepEqual(auth.parseOutreachState("outreach|https://evil.example"), { origin: undefined });
    assert.equal(auth.parseOutreachState("http://localhost:5173"), undefined, "the inbox consent is not an outreach one");
    assert.equal(auth.parseOutreachState(undefined), undefined);
  });
});

describe("connecting", () => {
  it("stores the mailbox and its own token, readable by the owner only", async () => {
    assert.deepEqual(await auth.completeOutreachConnection("code"), { address: "outreach@virtara-mail.co.za" });
    assert.equal(await auth.outreachAddress(), "outreach@virtara-mail.co.za");
    assert.equal(fs.statSync(OUTREACH_FILE).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(MAIN_FILE), false, "the inbox connection is untouched");
    assert.equal(await auth.getOutreachAccessToken(), "outreach-token");
  });

  it("refuses your main inbox and stores nothing", async () => {
    fs.writeFileSync(MAIN_FILE, JSON.stringify({ refreshToken: "main-refresh", obtainedAt: "2026-10-01T00:00:00Z" }));
    grant.address = "Dylan@Main.co.za";
    await assert.rejects(auth.completeOutreachConnection("code"), (error: unknown) => {
      assert.ok(error instanceof auth.OutreachAuthError);
      assert.equal(error.reason, "same-account");
      assert.match(error.message, /your main inbox/);
      return true;
    });
    assert.equal(fs.existsSync(OUTREACH_FILE), false);
    assert.equal(await auth.isOutreachConnected(), false);
  });

  it("accepts a different account even when the inbox is connected", async () => {
    fs.writeFileSync(MAIN_FILE, JSON.stringify({ refreshToken: "main-refresh", obtainedAt: "2026-10-01T00:00:00Z" }));
    await auth.completeOutreachConnection("code");
    assert.equal(await auth.outreachAddress(), "outreach@virtara-mail.co.za");
    assert.ok(fs.existsSync(MAIN_FILE), "and the inbox connection is still there");
  });

  it("refuses a grant that left out a permission, and stores nothing", async () => {
    grant.scope = auth.COMPOSE_SCOPE;
    await assert.rejects(auth.completeOutreachConnection("code"), /Both permissions are needed/);
    assert.equal(fs.existsSync(OUTREACH_FILE), false);
    assert.equal(auth.grantsOutreachScopes(`${auth.COMPOSE_SCOPE} ${auth.READ_SCOPE}`), true);
    assert.equal(auth.grantsOutreachScopes(auth.READ_SCOPE), false);
    assert.equal(auth.grantsOutreachScopes(undefined), false);
  });

  it("treats a revoked connection as disconnected, not as a crash", async () => {
    await auth.completeOutreachConnection("code");
    auth.resetOutreachTokenCache();
    refreshWorks = false;
    await assert.rejects(auth.getOutreachAccessToken(), /expired or was revoked/);
    assert.equal(await auth.isOutreachConnected(), false);
  });

  it("disconnects without touching the inbox", async () => {
    fs.writeFileSync(MAIN_FILE, JSON.stringify({ refreshToken: "main-refresh", obtainedAt: "2026-10-01T00:00:00Z" }));
    await auth.completeOutreachConnection("code");
    await auth.disconnectOutreach();
    assert.equal(await auth.isOutreachConnected(), false);
    assert.ok(fs.existsSync(MAIN_FILE));
  });
});
