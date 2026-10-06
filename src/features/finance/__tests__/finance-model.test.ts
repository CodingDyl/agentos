import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { debtPayState, excerpt, formatChange, narrativeSection, splitNarrative, goalStatusLabel, subscriptionPayState, upcomingPayments, utilisationTone } from "../finance-model";
import { pageWindow, sliceForPage, clampPage, pageCountFor } from "../../../lib/pagination-model";

describe("formatChange", () => {
  it("signs a change and admits when there is nothing to compare", () => {
    assert.equal(formatChange(0.63), "+63%");
    assert.equal(formatChange(-0.12), "-12%");
    assert.equal(formatChange(undefined), "-");
  });
});

describe("upcomingPayments", () => {
  const sub = (merchant: string, lastPaid: string, frequency: "monthly" | "annual" = "monthly") =>
    ({ merchant, lastPaid, frequency, monthly: 100, annual: 1200, payments: 3, kind: "other", tier: "unassessed" }) as never;

  it("expects a monthly charge one month after it last cleared, inside the window", () => {
    const result = upcomingPayments({ today: "2026-09-29", subscriptions: [sub("Netflix", "2026-09-05"), sub("Adobe", "2026-09-20"), sub("Annual", "2026-03-01", "annual")] }, 14);
    assert.deepEqual(
      result.map((payment) => [payment.merchant, payment.date]),
      [["Netflix", "2026-10-05"]],
    );
  });

  it("clamps to the end of a short month", () => {
    const result = upcomingPayments({ today: "2026-02-20", subscriptions: [sub("Gym", "2026-01-31")] }, 14);
    assert.equal(result[0]?.date, "2026-02-28");
  });
});

describe("upcomingPayments with bills", () => {
  const bills = (items: object[]) => ({ items, committedMonthly: 0, paidThisMonth: 0, remaining: 0, suggestions: [] }) as never;

  it("lists a bill by its due date when unpaid and inside the window, not when paid or long overdue", () => {
    const result = upcomingPayments(
      {
        today: "2026-09-29",
        subscriptions: [],
        bills: bills([
          { name: "Rent", dueDate: "2026-10-02", amount: 9_500, status: "upcoming" },
          { name: "Wifi", dueDate: "2026-10-03", amount: 899, status: "paid" },
          { name: "Old", dueDate: "2026-10-04", amount: 100, status: "missing" },
          { name: "Later", dueDate: "2026-11-20", amount: 100, status: "upcoming" },
        ]),
      },
      14,
    );
    assert.deepEqual(result.map((payment) => [payment.merchant, payment.date]), [["Rent", "2026-10-02"]]);
  });
});

describe("goalStatusLabel", () => {
  it("names the shortfall when behind", () => {
    assert.equal(goalStatusLabel({ status: "behind", shortfall: 3_800 } as never), "Behind by R 3,800");
  });
});

describe("subscriptionPayState", () => {
  const sub = (lastPaid: string, frequency: "monthly" | "annual" = "monthly") => ({ lastPaid, frequency });

  it("is paid when a monthly payment cleared this month", () => {
    assert.equal(subscriptionPayState(sub("2026-09-05"), "2026-09-29").state, "paid");
  });

  it("is due when this month's payment has not cleared yet, and gives it grace before saying not seen", () => {
    assert.equal(subscriptionPayState(sub("2026-08-05"), "2026-09-03").state, "due");
    assert.equal(subscriptionPayState(sub("2026-08-28"), "2026-09-29").state, "due");
    assert.equal(subscriptionPayState(sub("2026-08-05"), "2026-09-29").state, "late");
  });

  it("treats a yearly one as paid until its anniversary is close, then due, then not seen", () => {
    assert.equal(subscriptionPayState(sub("2026-03-01", "annual"), "2026-09-29").state, "paid");
    assert.equal(subscriptionPayState(sub("2025-10-15", "annual"), "2026-09-29").state, "due");
    assert.equal(subscriptionPayState(sub("2025-08-01", "annual"), "2026-09-29").state, "late");
  });
});

describe("debtPayState", () => {
  it("says a payment was made, none was, or that it cannot know without a statement", () => {
    assert.equal(debtPayState({ paidThisMonth: 3_000, hasStatement: true }).state, "paid");
    assert.equal(debtPayState({ paidThisMonth: 0, hasStatement: true }).state, "late");
    assert.equal(debtPayState({ paidThisMonth: 0, hasStatement: false }).state, "unknown");
  });
});

describe("utilisationTone", () => {
  it("is comfortable under 30%, worrying from 75%", () => {
    assert.equal(utilisationTone(0.2), "good");
    assert.equal(utilisationTone(0.5), "watch");
    assert.equal(utilisationTone(0.79), "act");
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 53 }, (_, index) => index + 1);

  it("slices pages and never runs past the end", () => {
    assert.deepEqual(sliceForPage(items, 1, 25).length, 25);
    assert.deepEqual(sliceForPage(items, 3, 25), [51, 52, 53]);
    assert.deepEqual(sliceForPage(items, 99, 25), [51, 52, 53]);
    assert.equal(pageCountFor(0, 25), 1);
    assert.equal(pageCountFor(53, 25), 3);
    assert.equal(clampPage(0, 53, 25), 1);
  });

  it("shows every page when there are few, and a window with gaps when there are many", () => {
    assert.deepEqual(pageWindow(2, 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 4, "gap", 20]);
    assert.deepEqual(pageWindow(10, 20), [1, "gap", 9, 10, 11, "gap", 20]);
    assert.deepEqual(pageWindow(20, 20), [1, "gap", 17, 18, 19, 20]);
  });
});

describe("narrativeSection", () => {
  const text = "What changed\nDining rose.\n\nGoing well\nSavings held.\n\nWorth a look\nNothing urgent.\n\nNext month\nKeep putting R5,000 aside.\nReview the card.";

  it("finds a section by its heading and stops at the next one", () => {
    assert.equal(narrativeSection(text, "Going well"), "Savings held.");
    assert.equal(narrativeSection(text, "Next month"), "Keep putting R5,000 aside.\nReview the card.");
  });

  it("copes with a trailing colon and different case, and says so when a heading is missing", () => {
    assert.equal(narrativeSection("NEXT MONTH:\nSave.", "Next month"), "Save.");
    assert.equal(narrativeSection("Just a paragraph.", "Next month"), undefined);
    assert.equal(narrativeSection("Next month\n", "Next month"), undefined);
  });
});

describe("excerpt", () => {
  it("leaves short text alone and cuts long text at a word", () => {
    assert.equal(excerpt("Short."), "Short.");
    const cut = excerpt("word ".repeat(100), 20);
    assert.ok(cut.endsWith("…") && cut.length <= 21 && !cut.includes("  "));
  });
});

describe("splitNarrative", () => {
  it("makes a block per heading, in order", () => {
    const blocks = splitNarrative("What changed\nDining rose.\n\nNext month\nSave.\nReview the card.");
    assert.deepEqual(blocks, [
      { heading: "What changed", text: "Dining rose." },
      { heading: "Next month", text: "Save.\nReview the card." },
    ]);
  });

  it("keeps a reply with no headings, and text before the first heading", () => {
    assert.deepEqual(splitNarrative("Just a paragraph."), [{ heading: undefined, text: "Just a paragraph." }]);
    assert.deepEqual(splitNarrative("Intro.\nGoing well:\nFine."), [
      { heading: undefined, text: "Intro." },
      { heading: "Going well", text: "Fine." },
    ]);
  });
});
