import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ComposioAccount } from "@shared/composio-types";
import { accountSummary, isAppUsable, needsSignIn, policySummary } from "../composio-model";

const account = (status: ComposioAccount["status"]): ComposioAccount => ({ id: `ca_${status}`, label: status, status });

describe("the Composio section's wording", () => {
  it("says what an agent will do under each policy", () => {
    assert.equal(policySummary({ read: "allowed", change: "approval", delete: "disabled" }), "Reads allowed · changes ask first · deletes off");
  });

  it("counts accounts, and says when one has lapsed", () => {
    assert.equal(accountSummary([account("ACTIVE")]), "1 account");
    assert.equal(accountSummary([account("ACTIVE"), account("ACTIVE")]), "2 accounts");
    assert.equal(accountSummary([account("ACTIVE"), account("EXPIRED")]), "2 accounts, 1 signed out");
  });

  it("never reads an app as usable when it's off or every sign-in has lapsed", () => {
    assert.equal(isAppUsable({ enabled: true, accounts: [account("ACTIVE")] }), true);
    assert.equal(isAppUsable({ enabled: false, accounts: [account("ACTIVE")] }), false);
    assert.equal(isAppUsable({ enabled: true, accounts: [account("EXPIRED")] }), false);
  });

  it("asks for a sign-in only when no account works", () => {
    assert.equal(needsSignIn({ accounts: [account("EXPIRED"), account("INACTIVE")] }), true);
    assert.equal(needsSignIn({ accounts: [account("EXPIRED"), account("ACTIVE")] }), false);
    assert.equal(needsSignIn({ accounts: [] }), false);
  });
});
