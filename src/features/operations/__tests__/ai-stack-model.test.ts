import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiStackEntry } from "@shared/ai-stack-types";
import type { Subscription } from "@shared/usage-types";
import { monthlyPrice, subscriptionsFor, summarise } from "../ai-stack-model";

function entry(overrides: Partial<AiStackEntry> = {}): AiStackEntry {
  return {
    id: "claude",
    name: "Claude",
    vendor: "Anthropic",
    kind: "worker",
    toggleable: true,
    enabled: true,
    status: "live",
    detected: true,
    evidence: [],
    provider: "anthropic",
    ...overrides,
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "s1",
    name: "Claude Pro Max",
    type: "subscription",
    price: 200,
    currency: "USD",
    billingCycle: "monthly",
    active: true,
    ...overrides,
  };
}

describe("monthlyPrice", () => {
  it("spreads an annual plan across twelve months", () => {
    assert.equal(monthlyPrice(subscription({ price: 240, billingCycle: "annual" })), 20);
  });

  it("says nothing for a plan with no price", () => {
    assert.equal(monthlyPrice(subscription({ price: undefined })), undefined);
  });
});

describe("subscriptionsFor", () => {
  it("matches on the recorded provider", () => {
    const plans = subscriptionsFor(entry(), [subscription({ name: "Team plan", provider: "anthropic" })]);
    assert.equal(plans.length, 1);
  });

  it("matches on the AI's name in the plan name when no provider was recorded", () => {
    assert.equal(subscriptionsFor(entry(), [subscription({ name: "Claude Pro Max" })]).length, 1);
  });

  it("does not match another vendor's plan", () => {
    assert.equal(subscriptionsFor(entry(), [subscription({ name: "ChatGPT Plus", provider: "openai" })]).length, 0);
  });

  it("ignores inactive plans", () => {
    assert.equal(subscriptionsFor(entry(), [subscription({ active: false })]).length, 0);
  });
});

describe("summarise", () => {
  it("counts each status, and everything found on the machine", () => {
    const counts = summarise([
      entry({ status: "live" }),
      entry({ id: "grok", status: "off" }),
      entry({ id: "jev", status: "unavailable", detected: false }),
      entry({ id: "cursor", status: "not-integrated", toggleable: false }),
    ]);

    assert.deepEqual(counts, { live: 1, off: 1, unavailable: 1, notConnected: 1, detected: 3 });
  });
});
