import { z } from "zod";
import { BusinessMinorAmountSchema } from "./business-ledger-types";

/**
 * Pulling business spending from Finance into a Business ledger's expenses.
 *
 * Finance owns the bank transactions; Business owns the books. A transaction
 * counts as business spend when Finance files it under the Business category,
 * or when the person marked its merchant as business there. Each transaction
 * can be imported once, into one business, so nothing is ever counted twice.
 */

export const FinanceBusinessExpenseSchema = z.object({
  transactionId: z.string(),
  /** `YYYY-MM-DD`. */
  date: z.iso.date(),
  merchant: z.string(),
  description: z.string(),
  /** Finance's category for it, which becomes the expense category. */
  category: z.string(),
  amountMinor: BusinessMinorAmountSchema.positive(),
  /** The business it was already imported into, if any. */
  importedInto: z.string().optional(),
});

export const FinanceBusinessExpensesSchema = z.object({
  /** False while Finance only has its illustrative sample data, which is nobody's spending. */
  available: z.boolean(),
  reason: z.string().optional(),
  candidates: z.array(FinanceBusinessExpenseSchema),
});

export const FinanceExpenseImportRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    transactionIds: z.array(z.string().min(1).max(256)).min(1).max(500),
    requestId: z.uuid().optional(),
  })
  .strict();

export type FinanceBusinessExpense = z.infer<typeof FinanceBusinessExpenseSchema>;
export type FinanceBusinessExpenses = z.infer<typeof FinanceBusinessExpensesSchema>;
export type FinanceExpenseImportRequest = z.infer<typeof FinanceExpenseImportRequestSchema>;
