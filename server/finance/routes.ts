import express, { type Response } from "express";
import type { ZodType } from "zod";
import { PartnerInputSchema, SettlementInputSchema, SplitRuleInputSchema, AccountInputSchema, AccountPatchSchema, BillInputSchema, BillMarkSchema, BillPatchSchema, BudgetInputSchema, CategoryCorrectionSchema, GoalInputSchema, GoalPatchSchema, SubscriptionDecisionSchema } from "../../shared/finance-types";
import { merchantKey } from "./categorise";
import { getFinance, localToday, syncFinance } from "./finance";
import { InvestecError, isInvestecConfigured } from "./investec";
import { assessSubscriptions, suggestCategory } from "./jev";
import { JevError } from "../mail/jev-client";
import { AnalyserError, askAnalyser, writeAnalysis } from "./analyser";
import { CsvImportError, readStatement, type SignRule } from "./csv-import";
import { ReviewError, writeNarrative } from "./review";
import { createSettlement, createSplitRule, deleteSettlement, deleteSplitRule, removePartner, savePartner, createBill, createGoal, createManualAccount, deleteBill, markBillPaid, readBill, unmarkBillPaid, updateBill, deleteCorrection, deleteGoal, deleteManualAccount, FinanceConflictError, FinanceNotFoundError, insertTransactions, readAccount, updateAccount, saveBudget, saveCorrection, saveDecision, updateGoal } from "./store";

/**
 * `/api/finance`.
 *
 * Every body is parsed with a shared schema first. Nothing here moves money:
 * the only calls out to the bank are the sync's reads, and no route accepts an
 * account, an amount to send, or a beneficiary.
 */
export const financeRouter = express.Router();

function parse<T>(schema: ZodType<T>, body: unknown, response: Response, what: string): T | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  response.status(400).json({ error: `Invalid ${what}${issue ? `: ${issue.path.join(".") || "body"}: ${issue.message}` : ""}` });
  return undefined;
}

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof FinanceNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof FinanceConflictError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof CsvImportError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof InvestecError) {
    response.status(error.reason === "not-configured" ? 409 : 502).json({ error: error.message });
    return;
  }
  if (error instanceof JevError || error instanceof ReviewError || error instanceof AnalyserError) {
    response.status(422).json({ error: error.message });
    return;
  }
  console.error(`[agentos] finance: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

financeRouter.get("/", (_request, response) => {
  try {
    response.json(getFinance());
  } catch (error) {
    fail(response, error, "read Finance");
  }
});

/** Pulls the latest from Investec. A read of the bank; it changes nothing there. */
financeRouter.post("/sync", async (_request, response) => {
  if (!isInvestecConfigured()) {
    response.status(409).json({ error: "Investec is not configured. Set INVESTEC_CLIENT_ID, INVESTEC_SECRET and INVESTEC_API_KEY in .env, then restart the server." });
    return;
  }
  try {
    await syncFinance();
    response.json(getFinance());
  } catch (error) {
    fail(response, error, "sync Investec");
  }
});

financeRouter.put("/corrections", (request, response) => {
  const correction = parse(CategoryCorrectionSchema, request.body, response, "correction");
  if (!correction) return;
  try {
    saveCorrection(correction);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "save the correction");
  }
});

/** A monthly limit for one category. A null amount takes it away. */
financeRouter.put("/budgets", (request, response) => {
  const budget = parse(BudgetInputSchema, request.body, response, "budget");
  if (!budget) return;
  try {
    saveBudget(budget);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "save the budget");
  }
});

financeRouter.delete("/corrections/:merchant", (request, response) => {
  try {
    deleteCorrection(request.params.merchant);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the correction");
  }
});

financeRouter.put("/subscriptions/decision", (request, response) => {
  const decision = parse(SubscriptionDecisionSchema, request.body, response, "decision");
  if (!decision) return;
  try {
    saveDecision(decision);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "save the decision");
  }
});

/** Asks Jev which subscriptions deserve a review. Only those whose facts changed since it last looked. */
financeRouter.post("/subscriptions/assess", async (_request, response) => {
  try {
    const run = await assessSubscriptions(getFinance().subscriptions);
    if (run.error && run.assessed === 0) {
      response.status(422).json({ error: run.error });
      return;
    }
    response.json({ ...run, data: getFinance() });
  } catch (error) {
    fail(response, error, "assess subscriptions");
  }
});

/** A suggested category for one payment. Never applied here: applying it is a correction, made by a person. */
financeRouter.post("/transactions/:id/suggest", async (request, response) => {
  try {
    const row = getFinance().transactions.find((entry) => entry.id === request.params.id);
    if (!row) throw new FinanceNotFoundError("That payment is not in the recent list.");
    response.json({ suggestion: await suggestCategory(row.merchant ?? row.description, row.amount), key: merchantKey(row.merchant ?? row.description) });
  } catch (error) {
    fail(response, error, "suggest a category");
  }
});

financeRouter.post("/goals", (request, response) => {
  const input = parse(GoalInputSchema, request.body, response, "goal");
  if (!input) return;
  try {
    response.status(201).json({ goal: createGoal(input) });
  } catch (error) {
    fail(response, error, "add the goal");
  }
});

financeRouter.patch("/goals/:id", (request, response) => {
  const patch = parse(GoalPatchSchema, request.body, response, "goal change");
  if (!patch) return;
  try {
    response.json({ goal: updateGoal(request.params.id, patch) });
  } catch (error) {
    fail(response, error, "update the goal");
  }
});

financeRouter.delete("/goals/:id", (request, response) => {
  try {
    deleteGoal(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the goal");
  }
});

/** Hermes explains this month's review. Written over derived numbers only. */
financeRouter.post("/review", async (_request, response) => {
  try {
    await writeNarrative(getFinance());
    response.json(getFinance());
  } catch (error) {
    fail(response, error, "write the review");
  }
});

// ------------------------------------------------------------- accounts

/** An account Investec cannot see (a Discovery card, say), added by hand. */
financeRouter.post("/accounts", (request, response) => {
  const input = parse(AccountInputSchema, request.body, response, "account");
  if (!input) return;
  try {
    response.status(201).json({ account: createManualAccount(input) });
  } catch (error) {
    fail(response, error, "add the account");
  }
});

financeRouter.patch("/accounts/:id", (request, response) => {
  const patch = parse(AccountPatchSchema, request.body, response, "account change");
  if (!patch) return;
  try {
    response.json({ account: updateAccount(request.params.id, patch) });
  } catch (error) {
    fail(response, error, "update the account");
  }
});

financeRouter.delete("/accounts/:id", (request, response) => {
  try {
    deleteManualAccount(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the account");
  }
});

/**
 * Reads a statement CSV into a manual account. The body is the file's text,
 * sent as `text/csv`. Importing the same statement twice changes nothing.
 * `?sign=` is `auto`, `positive-is-out` or `positive-is-in`.
 */
financeRouter.post("/accounts/:id/import", express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }), (request, response) => {
  try {
    const account = readAccount(request.params.id);
    if (account.provider !== "manual") throw new FinanceConflictError("Statements can only be imported into accounts you added yourself. Investec accounts sync on their own.");
    if (typeof request.body !== "string" || request.body.trim() === "") throw new CsvImportError("The file was empty.");

    const requested = String(request.query.sign ?? "auto");
    const sign: SignRule = requested === "positive-is-out" || requested === "positive-is-in" ? requested : "auto";

    const result = readStatement(request.body, account, sign);
    const added = insertTransactions(result.transactions);
    response.json({
      added,
      alreadyHad: result.transactions.length - added,
      skipped: result.skipped,
      from: result.from,
      to: result.to,
      positiveMeansOut: result.positiveMeansOut,
      signNote: result.signNote,
    });
  } catch (error) {
    fail(response, error, "import the statement");
  }
});

// -------------------------------------------------------------- analyser

/** Hermes analyses this month from the findings. It is handed totals and rounded balances, never merchants or account details. */
financeRouter.post("/analyse", async (_request, response) => {
  try {
    await writeAnalysis(getFinance());
    response.json(getFinance());
  } catch (error) {
    fail(response, error, "analyse your finances");
  }
});

financeRouter.post("/analyse/ask", async (request, response) => {
  const question = typeof request.body?.question === "string" ? request.body.question : "";
  try {
    response.json({ answer: await askAnalyser(getFinance(), question) });
  } catch (error) {
    fail(response, error, "answer that");
  }
});

// ----------------------------------------------------------------- bills

financeRouter.post("/bills", (request, response) => {
  const input = parse(BillInputSchema, request.body, response, "bill");
  if (!input) return;
  try {
    response.status(201).json({ bill: createBill(input) });
  } catch (error) {
    fail(response, error, "add the bill");
  }
});

financeRouter.patch("/bills/:id", (request, response) => {
  const patch = parse(BillPatchSchema, request.body, response, "bill change");
  if (!patch) return;
  try {
    response.json({ bill: updateBill(request.params.id, patch) });
  } catch (error) {
    fail(response, error, "update the bill");
  }
});

financeRouter.delete("/bills/:id", (request, response) => {
  try {
    deleteBill(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the bill");
  }
});

/** Marks this month's bill paid, for one paid in cash or from an account Finance cannot see. */
financeRouter.post("/bills/:id/paid", (request, response) => {
  const mark = parse(BillMarkSchema, request.body, response, "payment");
  if (!mark) return;
  try {
    const bill = readBill(request.params.id);
    const today = localToday();
    markBillPaid(bill.id, today.slice(0, 7), mark.amount ?? bill.amount, today);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "mark the bill paid");
  }
});

financeRouter.delete("/bills/:id/paid", (request, response) => {
  try {
    readBill(request.params.id);
    unmarkBillPaid(request.params.id, localToday().slice(0, 7));
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "undo that");
  }
});

// --------------------------------------------------------- shared costs

/** Who your partner is, as her payments show on your statement, and the month to start counting from. */
financeRouter.put("/shared/partner", (request, response) => {
  const input = parse(PartnerInputSchema, request.body, response, "partner");
  if (!input) return;
  try {
    savePartner(input);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "save the partner");
  }
});

financeRouter.delete("/shared/partner", (_request, response) => {
  try {
    removePartner();
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "stop sharing costs");
  }
});

financeRouter.post("/shared/rules", (request, response) => {
  const input = parse(SplitRuleInputSchema, request.body, response, "rule");
  if (!input) return;
  try {
    response.status(201).json({ rule: createSplitRule(input) });
  } catch (error) {
    fail(response, error, "add the rule");
  }
});

financeRouter.delete("/shared/rules/:id", (request, response) => {
  try {
    deleteSplitRule(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the rule");
  }
});

/** Something she paid another way (cash, another bank), counted against this month. */
financeRouter.post("/shared/settlements", (request, response) => {
  const input = parse(SettlementInputSchema, request.body, response, "payment");
  if (!input) return;
  try {
    createSettlement(localToday().slice(0, 7), input);
    response.status(201).json({ ok: true });
  } catch (error) {
    fail(response, error, "record the payment");
  }
});

financeRouter.delete("/shared/settlements/:id", (request, response) => {
  try {
    deleteSettlement(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the payment");
  }
});
