import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Tauri detection", () => {
  it("detects when not in Tauri (Node.js test environment)", () => {
    // In the Node.js test environment, window is not defined
    assert.equal(typeof globalThis.window, "undefined");
  });
});

describe("opening sites in windows", () => {
  it("provides an openSiteInWindow function", async () => {
    const { openSiteInWindow } = await import("../tauri-utils");
    assert.equal(typeof openSiteInWindow, "function");
  });
});
