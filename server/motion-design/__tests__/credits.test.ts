import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeHiggsfieldSpend,
  budgetBreakdown,
  creditToolsAllowed,
  parseCreditLedger,
  youDecideAuthorizesSpend,
  type CreditApproval,
  type MotionConcept,
} from "../../../shared/motion-design-types";

const conceptA: MotionConcept = {
  id: "a",
  title: "Dusk counter",
  summary: "Overhead kitchen film, then a close plate.",
  plannedCredits: 280,
  itemized: [
    { label: "6 key images", credits: 12 },
    { label: "5 clips at 1080p", credits: 225 },
    { label: "2 loops at 720p", credits: 45 },
  ],
};

const approval: CreditApproval = {
  conceptId: "a",
  ceiling: 330,
  plannedCredits: 280,
  approvedAt: "2026-10-12T09:00:00.000Z",
};

describe("motion design credit approval gate", () => {
  it("splits planned spend, the 15% reserve, and the max ceiling", () => {
    const split = budgetBreakdown(330, 280);
    assert.equal(split.planned, 280);
    assert.equal(split.reserve, 49.5);
    assert.equal(split.ceiling, 330);
    assert.ok(split.planned + split.reserve <= split.ceiling + 0.001);
  });

  it("refuses any Higgsfield spend before a concept and ceiling are approved", () => {
    const denied = authorizeHiggsfieldSpend({
      approval: undefined,
      conceptId: "a",
      requestedCredits: 2,
      spent: 0,
      pending: 0,
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason, /approved/);
    assert.deepEqual(creditToolsAllowed(undefined), []);
    assert.equal(youDecideAuthorizesSpend(true), false);
    assert.equal(youDecideAuthorizesSpend(false), false);
  });

  it("one approval authorizes that concept plus the ceiling, and nothing else", () => {
    const allowed = authorizeHiggsfieldSpend({
      approval,
      conceptId: "a",
      requestedCredits: 45,
      spent: 12,
      pending: 0,
    });
    assert.equal(allowed.ok, true);
    assert.deepEqual(creditToolsAllowed(approval), ["Bash(higgsfield:*)"]);

    const otherConcept = authorizeHiggsfieldSpend({
      approval,
      conceptId: "b",
      requestedCredits: 2,
      spent: 0,
      pending: 0,
    });
    assert.equal(otherConcept.ok, false);
    assert.match(otherConcept.reason, /concept/);
  });

  it("blocks a request that would go over the ceiling, including pending charges, until a new approval", () => {
    const over = authorizeHiggsfieldSpend({
      approval,
      conceptId: "a",
      requestedCredits: 50,
      spent: 280,
      pending: 10,
    });
    assert.equal(over.ok, false);
    assert.match(over.reason, /ceiling/);
    assert.match(over.reason, /new approval/);

    const within = authorizeHiggsfieldSpend({
      approval,
      conceptId: "a",
      requestedCredits: 10,
      spent: 280,
      pending: 10,
    });
    assert.equal(within.ok, true);
  });

  it("reads the skill's credit ledger, including pending charges", () => {
    const csv = [
      "timestamp,job_id,purpose,model,settings,quoted,actual,status,output,cumulative,remaining",
      "2026-10-12T09:01:00Z,hf_1,hero key,nano-banana-pro,2k,2,2,success,motion-studio/images/hero.png,2,328",
      "2026-10-12T09:02:00Z,hf_2,clip 1,seedance-2.0,5s-1080p,45,,pending,motion-studio/clips/01.mp4,47,283",
    ].join("\n");

    const ledger = parseCreditLedger(csv);
    assert.equal(ledger.rows.length, 2);
    assert.equal(ledger.spent, 2);
    assert.equal(ledger.pending, 45);
    assert.equal(ledger.committed, 47);
    assert.equal(ledger.rows[1]?.status, "pending");
    assert.equal(ledger.rows[1]?.quotedCredits, 45);
  });

  it("a concept without an approved ceiling cannot spend even if its itemized cost is filled in", () => {
    const denied = authorizeHiggsfieldSpend({
      approval: undefined,
      conceptId: conceptA.id,
      requestedCredits: conceptA.plannedCredits,
      spent: 0,
      pending: 0,
    });
    assert.equal(denied.ok, false);
  });
});
