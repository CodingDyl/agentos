import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { requireLoopback } from "../chat-routes";

/**
 * Chat can run commands, so it must only ever answer this machine — including
 * against DNS rebinding, where a hostile site's hostname resolves to 127.0.0.1.
 */

function check(headers: Record<string, string>): number | "next" {
  let status: number | "next" = "next";
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  requireLoopback({ headers } as unknown as Request, response, (() => undefined) as NextFunction);
  return status;
}

describe("chat answers this machine only", () => {
  it("lets the AgentOS app through", () => {
    assert.equal(check({ host: "127.0.0.1:8787" }), "next");
    assert.equal(check({ host: "localhost:1420", origin: "http://localhost:1420" }), "next");
    assert.equal(check({ host: "127.0.0.1:8787", origin: "tauri://localhost" }), "next");
  });

  it("refuses a rebound hostname, even though the connection is local", () => {
    assert.equal(check({ host: "evil.example:8787" }), 403);
  });

  it("refuses another website, even with a loopback Host", () => {
    assert.equal(check({ host: "127.0.0.1:8787", origin: "https://evil.example" }), 403);
    assert.equal(check({ host: "127.0.0.1:8787", origin: "not a url" }), 403);
  });
});
