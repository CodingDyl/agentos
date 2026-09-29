import { createHash } from "node:crypto";
import type { FinancialAccount, Transaction } from "../../shared/finance-types";
import { cleanMerchant } from "./categorise";

/**
 * Statement import: a CSV you download from a bank that has no API (Discovery,
 * in your case), read into the same shape as everything else.
 *
 * Bank CSVs disagree about almost everything, so this reads what it can and is
 * honest about what it could not:
 *
 * - The header row names the columns, in whatever order. A date, a description
 *   and either one amount column or a debit and a credit column are required.
 * - Delimiters `,` `;` and tab are all tried.
 * - Dates may be `2026-09-03`, `03/09/2026`, `03-09-2026` or `3 Sep 2026`.
 *   Day comes first when it is ambiguous, as it does in South Africa.
 * - With a single amount column, which way is "money out" varies by bank. For
 *   a card most rows are purchases, so if most amounts are positive they are
 *   read as purchases. The result says when it flipped the sign, and the
 *   caller can override.
 * - A row it cannot read is counted and skipped, never guessed at.
 *
 * Nothing is stored here: this returns transactions, and the caller saves them.
 */

export class CsvImportError extends Error {}

const MAX_ROWS = 20_000;

/** Splits CSV text into rows of cells, honouring quotes and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((candidate) => ({ candidate, count: firstLine.split(candidate).length })).sort((a, b) => b.count - a.count)[0].candidate;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row.map((value) => value.trim()));
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row.map((value) => value.trim()));

  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date as `YYYY-MM-DD`, or undefined when it is not one. */
export function parseDate(raw: string): string | undefined {
  const value = raw.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
  };

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(value);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const a = Number(match[1]);
    const b = Number(match[2]);
    // Day first, unless that is impossible and month first is not.
    return b > 12 && a <= 12 ? valid(year, a, b) : valid(year, b, a);
  }

  match = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})/.exec(value);
  if (match) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    return month > 0 ? valid(Number(match[3]), month, Number(match[1])) : undefined;
  }

  return undefined;
}

/** A money amount, or undefined. Handles `R 1 234,50`, `1,234.50`, `(500.00)` and `-500`. */
export function parseAmount(raw: string): number | undefined {
  let value = raw.replace(/[Rr]\s?|ZAR|\u00a0|\u202f/g, "").trim();
  if (value === "" || value === "-") return undefined;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (/-$/.test(value)) {
    negative = true;
    value = value.slice(0, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  }
  if (value.startsWith("+")) value = value.slice(1);

  value = value.replace(/\s/g, "");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > lastDot) {
    // `1.234,50` or `1234,50`: the comma is the decimal mark.
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(value)) return undefined;
  const amount = Number(value);
  return negative ? -amount : amount;
}

interface Columns {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
}

function findColumns(header: string[]): Columns | undefined {
  const at = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));

  const date = at(/^(transaction |posting |posted |value )?date|^posted/i);
  const description = at(/description|details|narrative|merchant|payee|reference|memo|particulars/i);
  const debit = at(/debit|money out|withdrawal|paid out|payments?$/i);
  const credit = at(/credit|money in|deposit|paid in|receipts?$/i);
  const amount = at(/^(transaction )?amount|^value$|^amt/i);

  if (date < 0 || description < 0) return undefined;
  if (amount >= 0) return { date, description, amount };
  if (debit >= 0 && credit >= 0 && debit !== credit) return { date, description, debit, credit };
  return undefined;
}

export interface ImportResult {
  transactions: Transaction[];
  /** Rows that were not a payment: no date, no amount, or not readable. */
  skipped: number;
  from?: string;
  to?: string;
  /** True when positive amounts were read as purchases (money out). */
  positiveMeansOut: boolean;
  /** Why it read the signs the way it did, in a sentence. */
  signNote?: string;
}

export type SignRule = "auto" | "positive-is-out" | "positive-is-in";

export function readStatement(text: string, account: Pick<FinancialAccount, "id" | "type">, sign: SignRule = "auto"): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvImportError("That file has no rows to import.");
  if (rows.length > MAX_ROWS) throw new CsvImportError(`That file has more than ${MAX_ROWS} rows. Import it in parts.`);

  // The header is the first row that names the columns: statements often open with a title or account lines.
  let headerIndex = -1;
  let columns: Columns | undefined;
  for (let index = 0; index < Math.min(rows.length, 15); index += 1) {
    columns = findColumns(rows[index]);
    if (columns) {
      headerIndex = index;
      break;
    }
  }
  if (!columns || headerIndex < 0) {
    throw new CsvImportError("Could not find the columns. The first rows need headings including a date, a description, and either an amount or debit and credit columns.");
  }

  let skipped = 0;
  const parsed: { date: string; description: string; amount: number }[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDate(row[columns.date] ?? "");
    const description = (row[columns.description] ?? "").trim();

    let amount: number | undefined;
    if (columns.amount !== undefined) {
      amount = parseAmount(row[columns.amount] ?? "");
    } else {
      const out = parseAmount(row[columns.debit ?? -1] ?? "");
      const into = parseAmount(row[columns.credit ?? -1] ?? "");
      if (out !== undefined && out !== 0) amount = -Math.abs(out);
      else if (into !== undefined && into !== 0) amount = Math.abs(into);
    }

    if (!date || amount === undefined || amount === 0 || description === "") {
      skipped += 1;
      continue;
    }
    parsed.push({ date, description, amount });
  }

  if (parsed.length === 0) throw new CsvImportError("No rows could be read as payments. Check the file is a statement with dates and amounts.");

  // Debit/credit columns already say which way it went. A single column does not.
  let flip = false;
  let signNote: string | undefined;
  if (columns.amount !== undefined) {
    const positives = parsed.filter((row) => row.amount > 0).length;
    if (sign === "positive-is-out") {
      flip = true;
      signNote = "Positive amounts were read as money out, as you chose.";
    } else if (sign === "positive-is-in") {
      signNote = "Positive amounts were read as money in, as you chose.";
    } else if (account.type === "credit" && positives > parsed.length / 2) {
      flip = true;
      signNote = "Most amounts were positive, so they were read as purchases (money out). If that is wrong, import again with the sign switched.";
    }
  }

  // Identical rows on one day are real (two coffees). Number them so re-importing gives the same ids.
  const seen = new Map<string, number>();
  const transactions = parsed.map((row): Transaction => {
    const amount = Math.round((flip ? -row.amount : row.amount) * 100) / 100;
    const key = [account.id, row.date, row.description, amount].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      id: createHash("sha256").update(`${key}|${occurrence}`).digest("hex").slice(0, 24),
      accountId: account.id,
      date: row.date,
      description: row.description,
      amount,
      merchant: cleanMerchant(row.description),
    };
  });

  const dates = transactions.map((t) => t.date).sort();
  return { transactions, skipped, from: dates[0], to: dates[dates.length - 1], positiveMeansOut: flip, signNote };
}
