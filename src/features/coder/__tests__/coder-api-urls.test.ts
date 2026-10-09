import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CODER_API_BASE, coderWebSocketUrl, withTimeout } from "../../../lib/agentos/coder-api";

describe("Coder API URLs", () => {
  it("uses the same-origin /api/coder helper the rest of AgentOS relies on, not localhost:3500", () => {
    assert.equal(CODER_API_BASE, "/api/coder");
    assert.equal(CODER_API_BASE.includes("3500"), false);
  });

  it("opens terminal websockets on the page host so Vite can proxy them", () => {
    const url = coderWebSocketUrl("abc-token");
    assert.match(url, /^wss?:\/\//);
    assert.match(url, /\/api\/coder\/terminal\/ws\/abc-token$/);
    assert.equal(url.includes("localhost:3500"), false);
  });
});

describe("withTimeout", () => {
  it("rejects when the operation does not finish in time", async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => undefined), 20, "Timed out loading workspace details"),
      /Timed out loading workspace details/,
    );
  });

  it("resolves when the operation finishes first", async () => {
    assert.equal(await withTimeout(Promise.resolve("ok"), 200, "timed out"), "ok");
  });
});
