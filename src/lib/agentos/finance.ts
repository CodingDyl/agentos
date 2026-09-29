import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FinanceDataSchema,
  type AccountInput,
  type AccountPatch,
  type BillInput,
  type PartnerInput,
  type SettlementInput,
  type SplitRuleInput,
  type BillPatch,
  type BudgetInput,
  type CategoryCorrection,
  type FinanceData,
  type GoalInput,
  type GoalPatch,
  type SubscriptionDecision,
} from "@shared/finance-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Finance's client and queries.
 *
 * One read, many small writes, the same shape as Traction: every write
 * re-reads the one payload so the numbers on screen are always the engine's
 * numbers, never an optimistic patch. Nothing here can name an account or an
 * amount to send. The server has no route that would accept one.
 */

export const financeKey = () => [...agentosKeys.all, "finance"] as const;

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "Finance could not be updated.", response.status);
  }

  return payload as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const id = (value: string) => encodeURIComponent(value);

function parseFinance(payload: unknown): FinanceData {
  const parsed = FinanceDataSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Finance returned data in an unexpected shape.");
  return parsed.data;
}

export async function getFinance(): Promise<FinanceData> {
  return parseFinance(await request("/api/finance"));
}

/** Polled gently: the ledger moves when the bank does, and the server refreshes it in the background. */
export function useFinance() {
  return useQuery({
    queryKey: financeKey(),
    queryFn: getFinance,
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    networkMode: "always",
  });
}

function useFinanceMutation<V, R = unknown>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export const useSyncInvestec = () => useFinanceMutation(() => request("/api/finance/sync", { method: "POST" }));

export const useSaveCorrection = () => useFinanceMutation((correction: CategoryCorrection) => request("/api/finance/corrections", json("PUT", correction)));

export const useRemoveCorrection = () => useFinanceMutation((merchant: string) => request(`/api/finance/corrections/${id(merchant)}`, { method: "DELETE" }));

export const useSaveBudget = () => useFinanceMutation((budget: BudgetInput) => request("/api/finance/budgets", json("PUT", budget)));

export const useSaveDecision = () => useFinanceMutation((decision: SubscriptionDecision) => request("/api/finance/subscriptions/decision", json("PUT", decision)));

export const useAssessSubscriptions = () =>
  useFinanceMutation(() => request<{ assessed: number; skipped: number; error?: string }>("/api/finance/subscriptions/assess", { method: "POST" }));

export interface CategorySuggestionResult {
  suggestion: {
    category: string;
    confidence: number;
    alternatives: { category: string; confidence: number }[];
    discretionary: number;
    unusual: number;
  };
}

/** Asks Jev; applies nothing. The caller turns a suggestion into a correction only when a person says so. */
export const useSuggestCategory = () => useMutation({ mutationFn: (transactionId: string) => request<CategorySuggestionResult>(`/api/finance/transactions/${id(transactionId)}/suggest`, { method: "POST" }), networkMode: "always", retry: 0 });

export const useCreateGoal = () => useFinanceMutation((input: GoalInput) => request("/api/finance/goals", json("POST", input)));

export const useUpdateGoal = () => useFinanceMutation(({ goalId, patch }: { goalId: string; patch: GoalPatch }) => request(`/api/finance/goals/${id(goalId)}`, json("PATCH", patch)));

export const useDeleteGoal = () => useFinanceMutation((goalId: string) => request(`/api/finance/goals/${id(goalId)}`, { method: "DELETE" }));

export const useWriteReview = () => useFinanceMutation(() => request("/api/finance/review", { method: "POST" }));

export const useCreateAccount = () => useFinanceMutation((input: AccountInput) => request("/api/finance/accounts", json("POST", input)));

export const useUpdateAccount = () => useFinanceMutation(({ accountId, patch }: { accountId: string; patch: AccountPatch }) => request(`/api/finance/accounts/${id(accountId)}`, json("PATCH", patch)));

export const useDeleteAccount = () => useFinanceMutation((accountId: string) => request(`/api/finance/accounts/${id(accountId)}`, { method: "DELETE" }));

export interface StatementImportResult {
  added: number;
  alreadyHad: number;
  skipped: number;
  from?: string;
  to?: string;
  positiveMeansOut: boolean;
  signNote?: string;
}

/** Sends a statement's text to the server to be read into a manual account. The file never leaves this machine. */
export const useImportStatement = () =>
  useFinanceMutation(({ accountId, text, sign }: { accountId: string; text: string; sign: "auto" | "positive-is-out" | "positive-is-in" }) =>
    request<StatementImportResult>(`/api/finance/accounts/${id(accountId)}/import?sign=${sign}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: text }),
  );

export const useAnalyse = () => useFinanceMutation(() => request("/api/finance/analyse", { method: "POST" }));

/** A question answered from the same figures. Nothing is kept, so nothing needs re-reading. */
export const useAskAnalyser = () => useMutation({ mutationFn: (question: string) => request<{ answer: string }>("/api/finance/analyse/ask", json("POST", { question })), networkMode: "always", retry: 0 });

export const useCreateBill = () => useFinanceMutation((input: BillInput) => request("/api/finance/bills", json("POST", input)));

export const useUpdateBill = () => useFinanceMutation(({ billId, patch }: { billId: string; patch: BillPatch }) => request(`/api/finance/bills/${id(billId)}`, json("PATCH", patch)));

export const useDeleteBill = () => useFinanceMutation((billId: string) => request(`/api/finance/bills/${id(billId)}`, { method: "DELETE" }));

/** Marks this month's bill paid, for one paid in cash or from an account Finance cannot see. */
export const useMarkBillPaid = () => useFinanceMutation(({ billId, amount }: { billId: string; amount?: number }) => request(`/api/finance/bills/${id(billId)}/paid`, json("POST", amount === undefined ? {} : { amount })));

export const useUnmarkBillPaid = () => useFinanceMutation((billId: string) => request(`/api/finance/bills/${id(billId)}/paid`, { method: "DELETE" }));

export const useSavePartner = () => useFinanceMutation((input: PartnerInput) => request("/api/finance/shared/partner", json("PUT", input)));

export const useStopSharing = () => useFinanceMutation(() => request("/api/finance/shared/partner", { method: "DELETE" }));

export const useCreateSplitRule = () => useFinanceMutation((input: SplitRuleInput) => request("/api/finance/shared/rules", json("POST", input)));

export const useDeleteSplitRule = () => useFinanceMutation((ruleId: string) => request(`/api/finance/shared/rules/${id(ruleId)}`, { method: "DELETE" }));

/** Something she paid another way, counted against what she owes this month. */
export const useRecordSettlement = () => useFinanceMutation((input: SettlementInput) => request("/api/finance/shared/settlements", json("POST", input)));

export const useDeleteSettlement = () => useFinanceMutation((settlementId: string) => request(`/api/finance/shared/settlements/${id(settlementId)}`, { method: "DELETE" }));
