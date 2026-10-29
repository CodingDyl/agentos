import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { screenTitle } from "../chat-panel-model";

describe("the screen a ⌘J message was sent from", () => {
  it("is named by the navigation entry its address sits under", () => {
    assert.equal(screenTitle("/"), "Dashboard");
    assert.equal(screenTitle("/inbox"), "Inbox");
    assert.equal(screenTitle("/workspaces/pantry-pilot"), "Workspaces");
    assert.equal(screenTitle("/designs/motion/abc"), "Creative");
  });

  it("falls back to AgentOS for an address with no entry", () => {
    assert.equal(screenTitle("/design-system"), "AgentOS");
    assert.equal(screenTitle("/inboxes"), "AgentOS", "a prefix of a word is not the same screen");
  });
});
