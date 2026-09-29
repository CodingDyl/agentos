import { randomUUID } from "node:crypto";
import type {
  Category,
  FinancialAccount,
  FinancialGoal,
  GoalInput,
  GoalPatch,
  JevSubscriptionAssessment,
  SubscriptionDecision,
  Transaction,
} from "../../shared/finance-types";
import { CategorySchema, JevSubscriptionAssessmentSchema, type AccountInput, type AccountPatch, type BillInput, type BillPatch, type BudgetInput, type PartnerInput, type SettlementInput, type SplitRuleInput } from "../../shared/finance-types";
import { isRiskProfile, type RiskProfile } from "../../shared/finance-profiler";
import { merchantKey } from "./categorise";
import { financeDatabase } from "./db";

/** Everything Finance keeps, as small synchronous queries over `finance.db`. */

export class FinanceNotFoundError extends Error {}

/** A change that would be undone, or that is not yours to make. */
export class FinanceConflictError extends Error {}

export type StoredGoal = FinancialGoal & { kind: "goal" | "sinking"; riskProfile?: RiskProfile; annualReturn?: number };

// ---------------------------------------------------------------- ledger

export function saveSnapshot(accounts: readonly FinancialAccount[], transactions: readonly Transaction[]): void {
  const db = financeDatabase();
  const now = new Date().toISOString();

  db.exec("BEGIN");
  try {
    const account = db.prepare(
      `INSERT INTO accounts (id, provider, name, type, currency, balance, mask, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, name = excluded.name, type = excluded.type,
         currency = excluded.currency, balance = excluded.balance, mask = excluded.mask, updated_at = excluded.updated_at`,
    );
    for (const entry of accounts) {
      account.run(entry.id, entry.provider, entry.name, entry.type, entry.currency, entry.balance, entry.mask ?? null, now);
    }

    // A row the bank re-sends is the same row; the description is the bank's, not ours to rewrite.
    const insert = db.prepare(
      `INSERT INTO transactions (id, account_id, date, description, amount, merchant)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET date = excluded.date, amount = excluded.amount`,
    );
    for (const entry of transactions) {
      insert.run(entry.id, entry.accountId, entry.date, entry.description, entry.amount, entry.merchant ?? null);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface AccountRow {
  id: string;
  provider: FinancialAccount["provider"];
  name: string;
  type: FinancialAccount["type"];
  currency: string;
  balance: number;
  mask: string | null;
  interest_rate: number | null;
  credit_limit: number | null;
}

const toAccount = (row: AccountRow): FinancialAccount => ({
  id: row.id,
  provider: row.provider,
  name: row.name,
  type: row.type,
  currency: row.currency,
  balance: row.balance,
  mask: row.mask ?? undefined,
  interestRate: row.interest_rate ?? undefined,
  creditLimit: row.credit_limit ?? undefined,
});

export function readAccounts(): FinancialAccount[] {
  return (financeDatabase().prepare("SELECT * FROM accounts ORDER BY name").all() as unknown as AccountRow[]).map(toAccount);
}

export function readAccount(id: string): FinancialAccount {
  const row = financeDatabase().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as unknown as AccountRow | undefined;
  if (!row) throw new FinanceNotFoundError("That account does not exist.");
  return toAccount(row);
}

/** An account you add yourself. A card's balance is entered as what you owe and stored as a negative. */
export function createManualAccount(input: AccountInput): FinancialAccount {
  const id = `manual-${randomUUID()}`;
  financeDatabase()
    .prepare(
      `INSERT INTO accounts (id, provider, name, type, currency, balance, mask, updated_at, interest_rate, credit_limit)
       VALUES (?, 'manual', ?, ?, 'ZAR', ?, NULL, ?, ?, ?)`,
    )
    .run(id, input.name, input.type, input.type === "credit" ? -input.balance : input.balance, new Date().toISOString(), input.interestRate ?? null, input.creditLimit ?? null);
  return readAccount(id);
}

/**
 * Changes what you told us about an account. A bank-reported balance is not
 * yours to edit (the next sync would only put it back), so `balance` is
 * accepted on manual accounts only. The rate and limit can be set on any.
 */
export function updateAccount(id: string, patch: AccountPatch): FinancialAccount {
  const current = readAccount(id);
  if (current.provider !== "manual" && (patch.balance !== undefined || patch.name !== undefined)) {
    throw new FinanceConflictError("Investec reports that account's name and balance. Only its interest rate and limit can be changed here.");
  }

  const balance = patch.balance === undefined ? current.balance : current.type === "credit" ? -patch.balance : patch.balance;
  const interestRate = patch.interestRate === undefined ? current.interestRate : (patch.interestRate ?? undefined);
  const creditLimit = patch.creditLimit === undefined ? current.creditLimit : (patch.creditLimit ?? undefined);

  financeDatabase()
    .prepare("UPDATE accounts SET name = ?, balance = ?, interest_rate = ?, credit_limit = ?, updated_at = ? WHERE id = ?")
    .run(patch.name ?? current.name, balance, interestRate ?? null, creditLimit ?? null, new Date().toISOString(), id);
  return readAccount(id);
}

/** Removes a manual account and the payments imported into it. An Investec account cannot be removed: the next sync would bring it back. */
export function deleteManualAccount(id: string): void {
  const account = readAccount(id);
  if (account.provider !== "manual") throw new FinanceConflictError("Only accounts you added yourself can be removed.");
  const db = financeDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Adds imported payments. A row seen before is left alone, so importing the same statement twice changes nothing. */
export function insertTransactions(transactions: readonly Transaction[]): number {
  const db = financeDatabase();
  const insert = db.prepare("INSERT OR IGNORE INTO transactions (id, account_id, date, description, amount, merchant) VALUES (?, ?, ?, ?, ?, ?)");
  let added = 0;
  db.exec("BEGIN");
  try {
    for (const entry of transactions) {
      const result = insert.run(entry.id, entry.accountId, entry.date, entry.description, entry.amount, entry.merchant ?? null);
      added += Number(result.changes);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return added;
}

export function readTransactions(): Transaction[] {
  const rows = financeDatabase().prepare("SELECT * FROM transactions ORDER BY date DESC").all() as unknown as {
    id: string;
    account_id: string;
    date: string;
    description: string;
    amount: number;
    merchant: string | null;
  }[];
  return rows.map((row) => ({ id: row.id, accountId: row.account_id, date: row.date, description: row.description, amount: row.amount, merchant: row.merchant ?? undefined }));
}

export function countTransactions(): number {
  return (financeDatabase().prepare("SELECT COUNT(*) AS n FROM transactions").get() as unknown as { n: number }).n;
}

// ------------------------------------------------------------------ meta

export function readMeta(key: string): string | undefined {
  const row = financeDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(key) as unknown as { value: string } | undefined;
  return row?.value;
}

export function writeMeta(key: string, value: string): void {
  financeDatabase().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ----------------------------------------------------------------- goals

interface GoalRow {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  type: FinancialGoal["type"];
  kind: "goal" | "sinking";
  risk_profile: string | null;
  annual_return: number | null;
}

const toGoal = (row: GoalRow): StoredGoal => ({
  id: row.id,
  name: row.name,
  targetAmount: row.target_amount,
  currentAmount: row.current_amount,
  targetDate: row.target_date ?? undefined,
  type: row.type,
  kind: row.kind,
  riskProfile: isRiskProfile(row.risk_profile) ? row.risk_profile : undefined,
  annualReturn: row.annual_return ?? undefined,
});

export function readGoals(): StoredGoal[] {
  const rows = financeDatabase().prepare("SELECT * FROM goals ORDER BY created_at").all() as unknown as GoalRow[];
  return rows.map(toGoal);
}

export function createGoal(input: GoalInput): StoredGoal {
  const id = randomUUID();
  financeDatabase()
    .prepare(
      `INSERT INTO goals (id, name, target_amount, current_amount, target_date, type, kind, created_at, risk_profile, annual_return)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name, input.targetAmount, input.currentAmount, input.targetDate ?? null, input.type, input.kind, new Date().toISOString(), input.riskProfile ?? null, input.annualReturn ?? null);
  return readGoal(id);
}

export function readGoal(id: string): StoredGoal {
  const row = financeDatabase().prepare("SELECT * FROM goals WHERE id = ?").get(id) as unknown as GoalRow | undefined;
  if (!row) throw new FinanceNotFoundError("That goal does not exist.");
  return toGoal(row);
}

export function updateGoal(id: string, patch: GoalPatch): StoredGoal {
  const current = readGoal(id);
  // `null` in a patch clears the profile; absent leaves it as it was.
  const riskProfile = patch.riskProfile === undefined ? current.riskProfile : (patch.riskProfile ?? undefined);
  const annualReturn = patch.annualReturn === undefined ? current.annualReturn : (patch.annualReturn ?? undefined);
  const next = { ...current, ...patch, riskProfile, annualReturn };
  financeDatabase()
    .prepare("UPDATE goals SET name = ?, target_amount = ?, current_amount = ?, target_date = ?, type = ?, kind = ?, risk_profile = ?, annual_return = ? WHERE id = ?")
    .run(next.name, next.targetAmount, next.currentAmount, next.targetDate ?? null, next.type, next.kind, riskProfile ?? null, annualReturn ?? null, id);
  return readGoal(id);
}

export function deleteGoal(id: string): void {
  readGoal(id);
  financeDatabase().prepare("DELETE FROM goals WHERE id = ?").run(id);
}

// ----------------------------------------------------------- corrections

export interface StoredCorrection {
  merchant: string;
  category: Category;
  scope?: "personal" | "business";
}

export function readCorrections(): StoredCorrection[] {
  const rows = financeDatabase().prepare("SELECT merchant, category, scope FROM corrections ORDER BY merchant").all() as unknown as {
    merchant: string;
    category: Category;
    scope: "personal" | "business" | null;
  }[];
  return rows.map((row) => ({ merchant: row.merchant, category: row.category, scope: row.scope ?? undefined }));
}

export function correctionMap(): Map<string, Category> {
  return new Map(readCorrections().map((correction) => [merchantKey(correction.merchant), correction.category]));
}

export function saveCorrection(correction: StoredCorrection): void {
  financeDatabase()
    .prepare(
      `INSERT INTO corrections (merchant_key, merchant, category, scope, corrected_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(merchant_key) DO UPDATE SET merchant = excluded.merchant, category = excluded.category,
         scope = excluded.scope, corrected_at = excluded.corrected_at`,
    )
    .run(merchantKey(correction.merchant), correction.merchant, correction.category, correction.scope ?? null, new Date().toISOString());
}

export function deleteCorrection(merchant: string): void {
  financeDatabase().prepare("DELETE FROM corrections WHERE merchant_key = ?").run(merchantKey(merchant));
}

// ------------------------------------------------------------- decisions

export function readDecisions(): Map<string, { decision: NonNullable<SubscriptionDecision["decision"]>; note?: string }> {
  const rows = financeDatabase().prepare("SELECT merchant_key, decision, note FROM subscription_decisions").all() as unknown as {
    merchant_key: string;
    decision: NonNullable<SubscriptionDecision["decision"]>;
    note: string | null;
  }[];
  return new Map(rows.map((row) => [row.merchant_key, { decision: row.decision, note: row.note ?? undefined }]));
}

/** Records what the person decided; `null` takes the decision back. */
export function saveDecision(decision: SubscriptionDecision): void {
  const key = merchantKey(decision.merchant);
  const db = financeDatabase();

  if (decision.decision === null) {
    db.prepare("DELETE FROM subscription_decisions WHERE merchant_key = ?").run(key);
    return;
  }

  db.prepare(
    `INSERT INTO subscription_decisions (merchant_key, decision, note, decided_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(merchant_key) DO UPDATE SET decision = excluded.decision, note = excluded.note, decided_at = excluded.decided_at`,
  ).run(key, decision.decision, decision.note ?? null, new Date().toISOString());
}

// ----------------------------------------------------------- assessments

export function readAssessments(): Map<string, { signature: string; assessment: JevSubscriptionAssessment }> {
  const rows = financeDatabase().prepare("SELECT merchant_key, signature, assessment FROM subscription_assessments").all() as unknown as {
    merchant_key: string;
    signature: string;
    assessment: string;
  }[];

  const result = new Map<string, { signature: string; assessment: JevSubscriptionAssessment }>();
  for (const row of rows) {
    try {
      const parsed = JevSubscriptionAssessmentSchema.safeParse(JSON.parse(row.assessment));
      if (parsed.success) result.set(row.merchant_key, { signature: row.signature, assessment: parsed.data });
    } catch {
      // A row that no longer parses is a row to assess again, not a reason to fail.
    }
  }
  return result;
}

export function saveAssessment(merchant: string, signature: string, assessment: JevSubscriptionAssessment): void {
  financeDatabase()
    .prepare(
      `INSERT INTO subscription_assessments (merchant_key, signature, assessment, assessed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(merchant_key) DO UPDATE SET signature = excluded.signature, assessment = excluded.assessment, assessed_at = excluded.assessed_at`,
    )
    .run(merchantKey(merchant), signature, JSON.stringify(assessment), assessment.assessedAt);
}

// --------------------------------------------------------------- budgets

export function readBudgets(): Map<Category, number> {
  const rows = financeDatabase().prepare("SELECT category, amount FROM budgets").all() as unknown as { category: string; amount: number }[];
  const budgets = new Map<Category, number>();
  for (const row of rows) {
    const parsed = CategorySchema.safeParse(row.category);
    if (parsed.success) budgets.set(parsed.data, row.amount);
  }
  return budgets;
}

/** Sets a category's monthly limit; a `null` amount removes it. */
export function saveBudget(input: BudgetInput): void {
  const db = financeDatabase();
  if (input.amount === null) {
    db.prepare("DELETE FROM budgets WHERE category = ?").run(input.category);
    return;
  }
  db.prepare("INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount").run(input.category, input.amount);
}

// ----------------------------------------------------------------- bills

export interface StoredBill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: Category;
  match?: string;
}

export interface BillMarkRow {
  billId: string;
  month: string;
  amount: number;
  paidOn: string;
}

interface BillRow {
  id: string;
  name: string;
  amount: number;
  due_day: number;
  category: string;
  match: string | null;
}

const toBill = (row: BillRow): StoredBill => ({
  id: row.id,
  name: row.name,
  amount: row.amount,
  dueDay: row.due_day,
  category: CategorySchema.safeParse(row.category).data ?? "Other",
  match: row.match ?? undefined,
});

export function readBills(): StoredBill[] {
  return (financeDatabase().prepare("SELECT * FROM bills ORDER BY due_day, name").all() as unknown as BillRow[]).map(toBill);
}

export function readBill(id: string): StoredBill {
  const row = financeDatabase().prepare("SELECT * FROM bills WHERE id = ?").get(id) as unknown as BillRow | undefined;
  if (!row) throw new FinanceNotFoundError("That bill does not exist.");
  return toBill(row);
}

export function createBill(input: BillInput): StoredBill {
  const id = randomUUID();
  financeDatabase()
    .prepare("INSERT INTO bills (id, name, amount, due_day, category, match, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.name, input.amount, input.dueDay, input.category, input.match?.trim() || null, new Date().toISOString());
  return readBill(id);
}

export function updateBill(id: string, patch: BillPatch): StoredBill {
  const current = readBill(id);
  const match = patch.match === undefined ? current.match : patch.match?.trim() || undefined;
  const next = { ...current, ...patch, match };
  financeDatabase()
    .prepare("UPDATE bills SET name = ?, amount = ?, due_day = ?, category = ?, match = ? WHERE id = ?")
    .run(next.name, next.amount, next.dueDay, next.category, match ?? null, id);
  return readBill(id);
}

export function deleteBill(id: string): void {
  readBill(id);
  const db = financeDatabase();
  db.prepare("DELETE FROM bill_marks WHERE bill_id = ?").run(id);
  db.prepare("DELETE FROM bills WHERE id = ?").run(id);
}

export function readBillMarks(): BillMarkRow[] {
  const rows = financeDatabase().prepare("SELECT bill_id, month, amount, paid_on FROM bill_marks").all() as unknown as { bill_id: string; month: string; amount: number; paid_on: string }[];
  return rows.map((row) => ({ billId: row.bill_id, month: row.month, amount: row.amount, paidOn: row.paid_on }));
}

/** Marks a bill paid for a month, for a payment Finance cannot see. */
export function markBillPaid(id: string, month: string, amount: number, paidOn: string): void {
  readBill(id);
  financeDatabase()
    .prepare("INSERT INTO bill_marks (bill_id, month, amount, paid_on) VALUES (?, ?, ?, ?) ON CONFLICT(bill_id, month) DO UPDATE SET amount = excluded.amount, paid_on = excluded.paid_on")
    .run(id, month, amount, paidOn);
}

export function unmarkBillPaid(id: string, month: string): void {
  financeDatabase().prepare("DELETE FROM bill_marks WHERE bill_id = ? AND month = ?").run(id, month);
}

// ------------------------------------------------------- shared costs

export interface StoredPartner {
  name: string;
  match: string;
  sinceMonth: string;
}

export interface StoredSplitRule {
  id: string;
  label: string;
  kind: "category" | "merchant";
  value: string;
  share: number;
}

export interface StoredSettlement {
  id: string;
  month: string;
  amount: number;
  note?: string;
}

export function readPartner(): StoredPartner | undefined {
  const row = financeDatabase().prepare("SELECT name, match, since_month FROM partner WHERE id = 1").get() as unknown as { name: string; match: string; since_month: string } | undefined;
  return row ? { name: row.name, match: row.match, sinceMonth: row.since_month } : undefined;
}

export function savePartner(input: PartnerInput): void {
  financeDatabase()
    .prepare("INSERT INTO partner (id, name, match, since_month) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, match = excluded.match, since_month = excluded.since_month")
    .run(input.name, input.match, input.sinceMonth);
}

/** Stops sharing costs. Her rules and recorded settlements go too: without her there is nothing to balance. */
export function removePartner(): void {
  const db = financeDatabase();
  db.prepare("DELETE FROM partner").run();
  db.prepare("DELETE FROM split_rules").run();
  db.prepare("DELETE FROM partner_settlements").run();
}

export function readSplitRules(): StoredSplitRule[] {
  const rows = financeDatabase().prepare("SELECT id, label, kind, value, share FROM split_rules ORDER BY label").all() as unknown as StoredSplitRule[];
  return rows.map((row) => ({ id: row.id, label: row.label, kind: row.kind, value: row.value, share: row.share }));
}

export function createSplitRule(input: SplitRuleInput): StoredSplitRule {
  if (input.kind === "category" && !CategorySchema.safeParse(input.value).success) throw new FinanceConflictError(`"${input.value}" is not a category.`);
  const id = randomUUID();
  financeDatabase().prepare("INSERT INTO split_rules (id, label, kind, value, share) VALUES (?, ?, ?, ?, ?)").run(id, input.label, input.kind, input.value, input.share);
  return { id, ...input };
}

export function deleteSplitRule(id: string): void {
  const result = financeDatabase().prepare("DELETE FROM split_rules WHERE id = ?").run(id);
  if (Number(result.changes) === 0) throw new FinanceNotFoundError("That rule does not exist.");
}

export function readSettlements(): StoredSettlement[] {
  const rows = financeDatabase().prepare("SELECT id, month, amount, note FROM partner_settlements ORDER BY month, created_at").all() as unknown as { id: string; month: string; amount: number; note: string | null }[];
  return rows.map((row) => ({ id: row.id, month: row.month, amount: row.amount, note: row.note ?? undefined }));
}

/** Something she paid another way (cash, another bank), counted against what she owes for `month`. */
export function createSettlement(month: string, input: SettlementInput): void {
  financeDatabase()
    .prepare("INSERT INTO partner_settlements (id, month, amount, note, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), month, input.amount, input.note ?? null, new Date().toISOString());
}

export function deleteSettlement(id: string): void {
  const result = financeDatabase().prepare("DELETE FROM partner_settlements WHERE id = ?").run(id);
  if (Number(result.changes) === 0) throw new FinanceNotFoundError("That payment does not exist.");
}

// ---------------------------------------------------------------- alerts

export interface StoredDismissal {
  id: string;
  scope: "month" | "always";
  month: string;
}

export function readDismissals(): StoredDismissal[] {
  const rows = financeDatabase().prepare("SELECT id, scope, month FROM dismissed_alerts").all() as unknown as StoredDismissal[];
  return rows.map((row) => ({ id: row.id, scope: row.scope, month: row.month }));
}

/**
 * Hides an alert: until `month` ends, or for good. A month-long dismissal from
 * an earlier month can never hide anything again, so it is cleared out here
 * rather than left to build up.
 */
export function saveDismissal(id: string, scope: "month" | "always", month: string): void {
  const db = financeDatabase();
  db.prepare("DELETE FROM dismissed_alerts WHERE scope = 'month' AND month < ?").run(month);
  db.prepare(
    `INSERT INTO dismissed_alerts (id, scope, month, dismissed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, month = excluded.month, dismissed_at = excluded.dismissed_at`,
  ).run(id, scope, month, new Date().toISOString());
}

export function deleteDismissal(id: string): void {
  financeDatabase().prepare("DELETE FROM dismissed_alerts WHERE id = ?").run(id);
}

/** Is this alert hidden right now? A month-long dismissal only counts in the month it was made. */
export const isDismissed = (dismissals: readonly StoredDismissal[], id: string, month: string) =>
  dismissals.some((entry) => entry.id === id && (entry.scope === "always" || entry.month === month));
