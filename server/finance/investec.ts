import { createHash } from "node:crypto";
import type { FinancialAccount, Transaction } from "../../shared/finance-types";
import { cleanMerchant } from "./categorise";

/**
 * Investec Programmable Banking, read-only.
 *
 * Credentials come from the server's environment and stop here:
 *
 *   INVESTEC_CLIENT_ID, INVESTEC_SECRET, INVESTEC_API_KEY
 *
 * Never `VITE_`-prefixed. Vite inlines anything with that prefix into the
 * browser bundle, and a banking secret in a JavaScript file is a banking secret
 * on the internet. The browser talks to `/api/finance`; only this file talks to
 * the bank.
 *
 * Read-only is enforced by construction, not by care: `investecGet` is the only
 * way to reach the API after authentication and it can only issue GETs. There
 * is no function in this module that can pay, transfer or beneficiary-add, so a
 * caller (including an agent) cannot be talked into one.
 *
 * The access token is held in memory and never written to disk. Full account
 * numbers are dropped on the way in: an account keeps its bank-issued opaque id
 * and the last four digits.
 */

const DEFAULT_BASE_URL = "https://openapi.investec.com";
const REQUEST_TIMEOUT_MS = 30_000;

export class InvestecError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "unauthorized" | "offline" | "failed",
  ) {
    super(message);
    this.name = "InvestecError";
  }
}

const REQUIRED_VARIABLES = ["INVESTEC_CLIENT_ID", "INVESTEC_SECRET", "INVESTEC_API_KEY"] as const;

/** The names (never the values) of the variables that are not set. */
export function missingInvestecVariables(): string[] {
  return REQUIRED_VARIABLES.filter((name) => !process.env[name]?.trim());
}

export function isInvestecConfigured(): boolean {
  return missingInvestecVariables().length === 0;
}

/**
 * What the bank said about a failure, short and safe to show. Investec's error
 * bodies explain themselves ("invalid_client", "Invalid API key"), which is the
 * difference between "it does not work" and knowing which of three values is
 * wrong. Anything that looks like one of our own secrets is blanked first.
 */
async function bankReason(response: Response): Promise<string> {
  const secrets = REQUIRED_VARIABLES.map((name) => process.env[name]?.trim()).filter((value): value is string => Boolean(value));
  let text = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 240);
  for (const secret of secrets) text = text.split(secret).join("[hidden]");
  if (cachedToken) text = text.split(cachedToken.value).join("[hidden]");
  return text ? `: ${text}` : "";
}

function baseUrl(): string {
  const configured = process.env.INVESTEC_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const url = new URL(configured);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new InvestecError("INVESTEC_BASE_URL must be https.", "failed");
  return url.origin;
}

let cachedToken: { value: string; expiresAt: number } | undefined;

/** Clears the in-memory token. Tests, and a rejected token, both need this. */
export function forgetInvestecToken(): void {
  cachedToken = undefined;
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const clientId = process.env.INVESTEC_CLIENT_ID?.trim();
  const secret = process.env.INVESTEC_SECRET?.trim();
  const apiKey = process.env.INVESTEC_API_KEY?.trim();
  if (!clientId || !secret || !apiKey) {
    throw new InvestecError("Investec is not configured. Set INVESTEC_CLIENT_ID, INVESTEC_SECRET and INVESTEC_API_KEY in .env.", "not-configured");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/identity/v2/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "x-api-key": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=accounts",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof InvestecError) throw error;
    throw new InvestecError("Could not reach Investec.", "offline");
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new InvestecError(`Investec rejected the credentials when signing in (${response.status})${await bankReason(response)}. Check the client id, secret and API key belong together.`, "unauthorized");
  }
  if (!response.ok) throw new InvestecError(`Investec sign-in failed (${response.status})${await bankReason(response)}.`, "failed");

  const payload = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!payload || typeof payload.access_token !== "string") throw new InvestecError("Investec returned an unreadable token.", "failed");

  const seconds = typeof payload.expires_in === "number" ? payload.expires_in : 1_800;
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + seconds * 1000 };
  return cachedToken.value;
}

/** The only door to the bank after authentication, and it only opens for GET. */
export async function investecGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await accessToken();
  const url = new URL(`${baseUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new InvestecError("Could not reach Investec.", "offline");
  }

  if (response.status === 401 || response.status === 403) {
    forgetInvestecToken();
    throw new InvestecError(`Investec refused ${path} (${response.status})${await bankReason(response)}.`, "unauthorized");
  }
  if (!response.ok) throw new InvestecError(`Investec failed on ${path} (${response.status})${await bankReason(response)}.`, "failed");

  const payload = (await response.json().catch(() => null)) as { data?: T } | null;
  if (!payload || payload.data === undefined) throw new InvestecError("Investec returned an unreadable response.", "failed");
  return payload.data;
}

// ------------------------------------------------------------ normalising

export interface RawInvestecAccount {
  accountId: string;
  accountNumber?: string;
  accountName?: string;
  referenceName?: string;
  productName?: string;
}

export interface RawInvestecBalance {
  currentBalance?: number;
  availableBalance?: number;
  currency?: string;
}

export interface RawInvestecTransaction {
  accountId?: string;
  type?: string;
  transactionType?: string;
  status?: string;
  description?: string;
  postingDate?: string;
  transactionDate?: string;
  valueDate?: string;
  actionDate?: string;
  postedOrder?: number;
  amount?: number;
}

export function accountTypeFor(productName: string | undefined): FinancialAccount["type"] {
  const product = (productName ?? "").toLowerCase();
  if (/credit|card|overdraft facility/.test(product)) return "credit";
  if (/saving|notice|fixed|money market|call account|pocket/.test(product)) return "savings";
  if (/invest|easy ?equit|unit trust|share|portfolio|endowment|tfsa|retirement/.test(product)) return "investment";
  return "current";
}

export function normaliseAccount(raw: RawInvestecAccount, balance: RawInvestecBalance): FinancialAccount {
  const type = accountTypeFor(raw.productName ?? raw.accountName);
  const reported = balance.currentBalance ?? 0;

  return {
    id: raw.accountId,
    provider: "investec",
    name: raw.referenceName?.trim() || raw.accountName?.trim() || raw.productName?.trim() || "Investec account",
    type,
    currency: balance.currency?.trim() || "ZAR",
    // A card's balance is what is owed: it always reduces net cash, whichever way the bank signs it.
    balance: type === "credit" ? -Math.abs(reported) : reported,
    // Last four digits only. The full number is never stored, logged or sent anywhere.
    mask: raw.accountNumber && raw.accountNumber.length >= 4 ? raw.accountNumber.slice(-4) : undefined,
  };
}

/**
 * What a bank row IS: the account, the day, what it says, how much, and which
 * way. Deliberately not where it happened to sit in the response, and not the
 * bank's own ordering number.
 *
 * Both of those change. A row's position shifts every time a newer payment
 * arrives above it, and an id built from the position gave the same payment a
 * new id on the next sync, so it was saved again and rent showed up twice.
 * The ordering number is not promised to stay put either, so it is left out too.
 */
function rowKey(accountId: string, raw: RawInvestecTransaction): string {
  const date = (raw.postingDate ?? raw.transactionDate ?? raw.valueDate ?? "").slice(0, 10);
  return [accountId, date, (raw.description ?? "").trim(), String(raw.amount ?? 0), (raw.type ?? "").toUpperCase()].join("|");
}

/**
 * A stable id for a bank row, because the bank's rows carry none: the same row
 * read twice must be the same row. `occurrence` is which of several identical
 * rows this is (0 for the first): two coffees at R40 on one day are two
 * payments, and stay two.
 */
export function transactionId(accountId: string, raw: RawInvestecTransaction, occurrence = 0): string {
  return createHash("sha256").update(`${rowKey(accountId, raw)}|${occurrence}`).digest("hex").slice(0, 24);
}

export function normaliseTransaction(accountId: string, raw: RawInvestecTransaction, occurrence = 0): Transaction | undefined {
  const date = (raw.postingDate ?? raw.transactionDate ?? raw.valueDate)?.slice(0, 10);
  const magnitude = raw.amount;
  if (!date || typeof magnitude !== "number" || !Number.isFinite(magnitude)) return undefined;
  // Pending rows change before they settle, so they would be counted twice.
  if (raw.status && raw.status.toUpperCase() === "PENDING") return undefined;

  const description = (raw.description ?? "").trim() || "Transaction";
  // Investec sends a positive amount and says which way it went.
  const credit = (raw.type ?? "").toUpperCase() === "CREDIT";

  return {
    id: transactionId(accountId, raw, occurrence),
    accountId,
    date,
    description,
    amount: Math.round((credit ? Math.abs(magnitude) : -Math.abs(magnitude)) * 100) / 100,
    merchant: cleanMerchant(description),
  };
}

/**
 * A whole response as payments. Identical rows are numbered in the order they
 * come, which is safe whatever order the bank sends them in: identical rows are
 * interchangeable, so it does not matter which one is called the first.
 */
export function normaliseTransactions(accountId: string, rows: readonly RawInvestecTransaction[]): Transaction[] {
  const seen = new Map<string, number>();
  const result: Transaction[] = [];

  for (const raw of rows) {
    const key = rowKey(accountId, raw);
    const occurrence = seen.get(key) ?? 0;
    const normalised = normaliseTransaction(accountId, raw, occurrence);
    // A row that is not counted (pending, unreadable) must not use up a number.
    if (!normalised) continue;
    seen.set(key, occurrence + 1);
    result.push(normalised);
  }
  return result;
}

// ----------------------------------------------------------------- reading

export interface InvestecSnapshot {
  accounts: FinancialAccount[];
  transactions: Transaction[];
  /** Accounts that could not be read, by name, so a partial sync says so instead of pretending. */
  skipped: string[];
}

/**
 * Everything the bank will tell us since `fromDate` (`YYYY-MM-DD`). Reads only.
 *
 * One account that will not answer (a product the API does not expose, say)
 * does not sink the rest: the others are saved and the skipped one is named.
 * If nothing at all could be read, that is a failure and it is thrown.
 */
export async function readInvestec(fromDate: string, toDate: string): Promise<InvestecSnapshot> {
  const listed = await investecGet<{ accounts: RawInvestecAccount[] }>("/za/pb/v1/accounts");

  const accounts: FinancialAccount[] = [];
  const transactions: Transaction[] = [];
  const skipped: string[] = [];
  let lastError: unknown;

  for (const raw of listed.accounts ?? []) {
    try {
      const balance = await investecGet<RawInvestecBalance>(`/za/pb/v1/accounts/${encodeURIComponent(raw.accountId)}/balance`);
      const account = normaliseAccount(raw, balance);

      const rows = await investecGet<{ transactions: RawInvestecTransaction[] }>(
        `/za/pb/v1/accounts/${encodeURIComponent(raw.accountId)}/transactions`,
        { fromDate, toDate },
      );

      accounts.push(account);
      transactions.push(...normaliseTransactions(account.id, rows.transactions ?? []));
    } catch (error) {
      // Credentials being wrong is not one account's problem: stop at once.
      if (error instanceof InvestecError && error.reason === "unauthorized") throw error;
      lastError = error;
      skipped.push(raw.referenceName?.trim() || raw.accountName?.trim() || raw.productName?.trim() || "an account");
    }
  }

  if ((listed.accounts ?? []).length === 0) throw new InvestecError("Investec signed in but lists no accounts for these credentials.", "failed");
  if (accounts.length === 0) throw lastError instanceof Error ? lastError : new InvestecError("No account could be read.", "failed");

  return { accounts, transactions, skipped };
}

/**
 * Just the accounts and their balances, with no transactions: a handful of
 * small reads, so it can run every couple of minutes while a page is open.
 * Same tolerance as a full read: one account that will not answer is skipped,
 * and nothing at all answering is an error. Reads only.
 */
export async function readInvestecBalances(): Promise<{ accounts: FinancialAccount[]; skipped: string[] }> {
  const listed = await investecGet<{ accounts: RawInvestecAccount[] }>("/za/pb/v1/accounts");
  const accounts: FinancialAccount[] = [];
  const skipped: string[] = [];
  let lastError: unknown;

  for (const raw of listed.accounts ?? []) {
    try {
      const balance = await investecGet<RawInvestecBalance>(`/za/pb/v1/accounts/${encodeURIComponent(raw.accountId)}/balance`);
      accounts.push(normaliseAccount(raw, balance));
    } catch (error) {
      if (error instanceof InvestecError && error.reason === "unauthorized") throw error;
      lastError = error;
      skipped.push(raw.referenceName?.trim() || raw.accountName?.trim() || raw.productName?.trim() || "an account");
    }
  }

  if ((listed.accounts ?? []).length === 0) throw new InvestecError("Investec signed in but lists no accounts for these credentials.", "failed");
  if (accounts.length === 0) throw lastError instanceof Error ? lastError : new InvestecError("No account balance could be read.", "failed");
  return { accounts, skipped };
}
