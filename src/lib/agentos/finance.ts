import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FinanceDataSchema,
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
