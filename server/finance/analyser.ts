import type { FinanceData } from "../../shared/finance-types";
import { formatRandAmount } from "../../shared/finance-types";
import { HermesError, sendToHermes } from "../hermes/client";
import { stripIdentifiers } from "./jev";
import { readMeta, writeMeta } from "./store";

/**
 * Hermes as the analyser: an explainer and a coach, not a calculator.
 *
 * The findings are already worked out (`analyse.ts`). Hermes is handed them
 * with the month's totals and asked to order them, explain them and turn them
 * into a plan, in words. It is told to use only the figures it is given.
 *
 * What it is handed, and what it is not:
 *
 * - Handed: income, spending, saving, category totals, the needs/wants split,
 *   subscription count and total, goal progress, and each debt's size, rate and
 *   utilisation. Balances are rounded to the nearest R100.
 * - Never handed: account numbers, account names, logins, individual
 *   merchants or payments, or Investec credentials. Debts are "Card A", "Card
 *   B", not what the bank called them.
 * - Never able to: move money, place an order, or change anything. It replies
 *   with text and nothing else is connected to it.
 */

const TIMEOUT_MS = 150_000;

const SYSTEM = [
  "You are a calm, practical money coach for one person, working from figures that have already been calculated.",
  "Use only the figures you are given. Never calculate a new figure, estimate, or invent one. If a figure you would like is missing, say what is missing.",
  "Apply the named principles in the findings. Put the most important thing first and be specific about the next step.",
  "Never name or recommend a bank, product, fund, share or provider, and never tell the person to buy or sell an investment. You may say what deserves a review, but the person decides what to cancel.",
  "Be honest, not soothing: if the numbers are worrying, say so kindly and plainly.",
  "Plain text only, no bullet symbols or markdown. Use exactly these headings, each on its own line: Where you stand, What to do first, This month, Keep an eye on.",
  "Keep it under 350 words.",
].join(" ");

const round100 = (value: number) => formatRandAmount(Math.round(value / 100) * 100);
const R = (value: number) => formatRandAmount(value);

export function buildAnalysisPacket(data: FinanceData): string {
  const { summary, split } = data;
  const month = new Date(`${data.month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const lines: string[] = [];

  lines.push(`Month: ${month} (so far).`);
  lines.push(`Income ${R(summary.income)}. Spent ${R(summary.spent)}. Kept ${R(summary.saved)}. Savings rate ${summary.savingsRate === undefined ? "unknown" : `${Math.round(summary.savingsRate * 100)}%`}.`);
  if (data.averageMonthlySpend !== undefined) lines.push(`Average monthly spend over the last three complete months: ${R(data.averageMonthlySpend)}.`);
  if (data.freeCashFlow !== undefined) lines.push(`Free cash flow, averaged over those months: ${R(data.freeCashFlow)} a month.`);

  if (split.income > 0) {
    const share = (value: number) => `${Math.round((value / split.income) * 100)}%`;
    lines.push(`Where income went: needs ${share(split.needs)}, wants ${share(split.wants)}, business ${share(split.business)}, uncategorised ${share(split.unsorted)}, kept ${share(Math.max(0, split.saved))}.`);
  }

  if (data.categories.length > 0) {
    lines.push(`Spending by category this month: ${data.categories.filter((c) => c.amount > 0).map((c) => `${c.category} ${R(c.amount)}`).join(", ")}.`);
  }

  if (data.bills.items.length > 0) lines.push(`Fixed monthly bills tracked: ${data.bills.items.length}, totalling ${R(data.bills.committedMonthly)} a month${data.bills.incomeShare === undefined ? "" : ` (${Math.round(data.bills.incomeShare * 100)}% of income)`}.`);
  lines.push(`Recurring subscriptions: ${data.subscriptions.length}, costing ${R(data.subscriptionMonthly)} a month.`);

  const cash = data.accounts.filter((a) => a.type === "current" || a.type === "savings").reduce((total, a) => total + Math.max(0, a.balance), 0);
  lines.push(`Cash in current and savings accounts, rounded: ${round100(cash)}.`);
  if (data.emergencyMonths !== undefined) lines.push(`Emergency fund goal covers ${data.emergencyMonths.toFixed(1)} months of spending.`);

  data.debts.forEach((debt, index) => {
    const label = `Card ${String.fromCharCode(65 + index)}`;
    const parts = [`owes ${round100(debt.owed)}`];
    parts.push(debt.interestRate === undefined ? "interest rate not set" : `${(debt.interestRate * 100).toFixed(1).replace(/\.0$/, "")}% a year`);
    if (debt.utilisation !== undefined) parts.push(`${Math.round(debt.utilisation * 100)}% of its limit used`);
    lines.push(`${label} ${parts.join(", ")}.`);
  });

  if (data.goals.length > 0) {
    lines.push(`Goals: ${data.goals.map((g, i) => `Goal ${i + 1} (${g.type}) ${Math.round(g.progress * 100)}% funded, ${g.status.replace("-", " ")}`).join("; ")}.`);
  }

  lines.push("", "Findings, already worked out:");
  for (const finding of data.analysis.findings) {
    lines.push(`- [${finding.status.toUpperCase()}] ${finding.principle}: ${finding.summary} ${finding.evidence.map(stripIdentifiers).join(" ")}`.trim());
  }
  if (data.analysis.focus.length > 0) lines.push("", `Look first at: ${data.analysis.focus.join(", ")}.`);

  return lines.join("\n");
}

export class AnalyserError extends Error {}

export function readAnalysisNarrative(month: string): { text: string; at: string } | undefined {
  const raw = readMeta(`analysis:${month}`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; at?: unknown };
    return typeof parsed.text === "string" && typeof parsed.at === "string" ? { text: parsed.text, at: parsed.at } : undefined;
  } catch {
    return undefined;
  }
}

async function askHermes(message: string): Promise<string> {
  try {
    const reply = (await sendToHermes(message, { operation: "other", timeoutMs: TIMEOUT_MS, system: SYSTEM })).trim();
    if (!reply) throw new AnalyserError("Hermes answered with nothing to keep.");
    return reply;
  } catch (error) {
    if (error instanceof AnalyserError) throw error;
    throw new AnalyserError(error instanceof HermesError ? error.message : "Hermes could not be reached.");
  }
}

/** Asks Hermes to analyse this month and keeps the answer. Runs only when asked. */
export async function writeAnalysis(data: FinanceData): Promise<{ text: string; at: string }> {
  const text = await askHermes(`${buildAnalysisPacket(data)}\n\nAnalyse my finances using the findings, and give me a prioritised plan.`);
  const saved = { text, at: new Date().toISOString() };
  writeMeta(`analysis:${data.month}`, JSON.stringify(saved));
  return saved;
}

/** Answers a question from the same figures. Not kept: it is a conversation, not a record. */
export async function askAnalyser(data: FinanceData, question: string): Promise<string> {
  const cleaned = stripIdentifiers(question).slice(0, 500);
  if (cleaned.length < 3) throw new AnalyserError("Ask a question first.");
  return askHermes(`${buildAnalysisPacket(data)}\n\nMy question: ${cleaned}\n\nAnswer it using only the figures above, in the same headings-free plain style, in under 200 words. If the figures cannot answer it, say what is missing.`);
}
