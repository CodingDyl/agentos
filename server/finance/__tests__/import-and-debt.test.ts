import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthsToClear, paymentToClear, payoffOptions, totalInterest } from "../../../shared/finance-debt";
import { CsvImportError, parseAmount, parseCsv, parseDate, readStatement } from "../csv-import";

describe("parseDate", () => {
  it("reads the formats banks use, day first when ambiguous", () => {
    assert.equal(parseDate("2026-09-03"), "2026-09-03");
    assert.equal(parseDate("03/09/2026"), "2026-09-03");
    assert.equal(parseDate("03-09-2026"), "2026-09-03");
    assert.equal(parseDate("3 Sep 2026"), "2026-09-03");
    assert.equal(parseDate("25/12/2026"), "2026-12-25");
    assert.equal(parseDate("12/25/2026"), "2026-12-25");
  });
  it("rejects what is not a date", () => {
    assert.equal(parseDate("31/02/2026"), undefined);
    assert.equal(parseDate("Total"), undefined);
    assert.equal(parseDate(""), undefined);
  });
});

describe("parseAmount", () => {
  it("handles the ways South African statements write money", () => {
    assert.equal(parseAmount("R 1 234,50"), 1234.5);
    assert.equal(parseAmount("1,234.50"), 1234.5);
    assert.equal(parseAmount("(500.00)"), -500);
    assert.equal(parseAmount("-500"), -500);
    assert.equal(parseAmount("500-"), -500);
    assert.equal(parseAmount("1.234,50"), 1234.5);
  });
  it("returns nothing for text", () => {
    assert.equal(parseAmount("n/a"), undefined);
    assert.equal(parseAmount(""), undefined);
  });
});

describe("parseCsv", () => {
  it("honours quotes, embedded commas and semicolon delimiters", () => {
    assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [["a", "b"], ["x, y", "2"]]);
    assert.deepEqual(parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]]);
  });
});

describe("readStatement", () => {
  const card = { id: "card", type: "credit" as const };
  const current = { id: "cur", type: "current" as const };

  it("reads debit and credit columns, which say the direction themselves", () => {
    const csv = "Date,Description,Debit,Credit\n03/09/2026,FLYSAFAIR TICKET,2450.00,\n05/09/2026,PAYMENT RECEIVED,,3000.00\n";
    const result = readStatement(csv, card);
    assert.deepEqual(result.transactions.map((t) => t.amount), [-2450, 3000]);
    assert.equal(result.positiveMeansOut, false);
  });

  it("reads a card's positive purchases as money out, and says so", () => {
    const csv = "Transaction Date,Description,Amount\n2026-09-03,WOOLWORTHS,300.00\n2026-09-04,UBER EATS,150.00\n2026-09-05,PAYMENT,-500.00\n";
    const result = readStatement(csv, card);
    assert.deepEqual(result.transactions.map((t) => t.amount), [-300, -150, 500]);
    assert.equal(result.positiveMeansOut, true);
    assert.match(result.signNote ?? "", /purchases/);
  });

  it("leaves a current account's signs alone, and obeys an explicit rule", () => {
    const csv = "Date,Description,Amount\n2026-09-03,SALARY,10000\n2026-09-04,RENT,-5000\n";
    assert.deepEqual(readStatement(csv, current).transactions.map((t) => t.amount), [10000, -5000]);
    assert.deepEqual(readStatement(csv, current, "positive-is-out").transactions.map((t) => t.amount), [-10000, 5000]);
  });

  it("skips title lines, finds the header lower down, and counts rows it cannot read", () => {
    const csv = "Discovery Bank statement\nAccount holder\n\nDate,Description,Amount\n2026-09-03,SHOP,-10\nnot a date,BAD,-5\n2026-09-04,,-5\n";
    const result = readStatement(csv, current);
    assert.equal(result.transactions.length, 1);
    assert.equal(result.skipped, 2);
  });

  it("gives the same ids when the same statement is read twice, and keeps genuine repeats", () => {
    const csv = "Date,Description,Amount\n2026-09-03,COFFEE,-40\n2026-09-03,COFFEE,-40\n";
    const a = readStatement(csv, current).transactions.map((t) => t.id);
    const b = readStatement(csv, current).transactions.map((t) => t.id);
    assert.deepEqual(a, b);
    assert.notEqual(a[0], a[1]);
  });

  it("refuses a file it cannot make sense of, rather than guessing", () => {
    assert.throws(() => readStatement("foo,bar\n1,2\n", current), CsvImportError);
    assert.throws(() => readStatement("Date,Description,Amount\n", current), CsvImportError);
  });
});

describe("debt maths", () => {
  it("clears a balance with no interest by simple division", () => {
    assert.equal(monthsToClear(12_000, 0, 1_000), 12);
    assert.equal(paymentToClear(12_000, 0, 12), 1_000);
  });

  it("says a payment that does not cover the interest never clears it", () => {
    // 24% a year on R10,000 is R200 a month of interest.
    assert.equal(monthsToClear(10_000, 0.24, 200), undefined);
    assert.ok((monthsToClear(10_000, 0.24, 500) ?? 0) > 0);
  });

  it("agrees with itself: paying what clears it in N months takes N months, and interest is positive", () => {
    const payment = paymentToClear(20_000, 0.22, 12);
    assert.equal(monthsToClear(20_000, 0.22, payment), 12);
    assert.ok((totalInterest(20_000, 0.22, payment) ?? 0) > 0);
    assert.ok(payment > 20_000 / 12);
  });

  it("shows shorter plans costing more each month and less in interest", () => {
    const [six, twelve, twentyFour] = payoffOptions(30_000, 0.2);
    assert.ok(six.monthly > twelve.monthly && twelve.monthly > twentyFour.monthly);
    assert.ok(six.interest < twelve.interest && twelve.interest < twentyFour.interest);
  });
});
