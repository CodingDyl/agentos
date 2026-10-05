import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { BusinessProfile } from "@shared/business-ledger-types";
import { BusinessImportPreviewSchema, BusinessLedgerStatusSchema } from "@shared/business-ledger-types";
import { AgentOSRequestError } from "./client";
import { FinanceBusinessExpensesSchema } from "@shared/business-finance-import";

const key = (entityId: string) => ["business-ledger", entityId] as const;
export const businessLedgerUrl = (entityId: string) => `/api/business/ledger/${encodeURIComponent(entityId)}`;

async function request<T>(url: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new AgentOSRequestError("The Agentos server is not responding."); }
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The business ledger request failed.";
    throw new AgentOSRequestError(message, response.status);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentOSRequestError("The business ledger returned an unexpected response.");
  return parsed.data;
}

export function useBusinessLedger(entityId: string) {
  return useQuery({ queryKey: key(entityId), queryFn: () => request(businessLedgerUrl(entityId), BusinessLedgerStatusSchema), staleTime: 10_000, retry: 1 });
}
export function usePrepareBusinessImport(entityId: string) {
  return useMutation({
    mutationFn: (input: { mode: "crm" } | { mode: "restore" | "history"; backup: unknown }) => request(`${businessLedgerUrl(entityId)}/${input.mode === "crm" ? "preview" : input.mode === "history" ? "history-preview" : "restore-preview"}`, BusinessImportPreviewSchema, input.mode === "crm" ? {} : input.backup),
  });
}
export function useCommitBusinessImport(entityId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (previewId: string) => request(`${businessLedgerUrl(entityId)}/commit`, BusinessLedgerStatusSchema, { previewId }),
    onSuccess: (data) => client.setQueryData(key(entityId), data),
  });
}

export function useBusinessOperation(entityId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { revision: number; action: "save" | "issue" | "accept" | "convert" | "generate" | "void" | "allocate" | "profile" | "reconcile"; requestId?: string; reason?: string; profile?: BusinessProfile; allocations?: { invoiceId: string; amountMinor: number }[]; record?: unknown; id?: string; date?: string }) => request(`${businessLedgerUrl(entityId)}/operate`, BusinessLedgerStatusSchema, { ...input, requestId: input.requestId ?? crypto.randomUUID() }),
    onSuccess: (data) => client.setQueryData(key(entityId), data),
    onError: () => { void client.invalidateQueries({ queryKey: key(entityId) }); },
  });
}

/** Finance transactions marked as business. Only read when the import panel is open. */
export function useFinanceBusinessExpenses(entityId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...key(entityId), "finance-expenses"] as const,
    queryFn: () => request(`${businessLedgerUrl(entityId)}/finance-expenses`, FinanceBusinessExpensesSchema),
    enabled,
    staleTime: 0,
    retry: 1,
  });
}

export function useImportFinanceExpenses(entityId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { revision: number; transactionIds: string[] }) =>
      request(`${businessLedgerUrl(entityId)}/finance-expenses/import`, BusinessLedgerStatusSchema, { ...input, requestId: crypto.randomUUID() }),
    onSuccess: (data) => {
      client.setQueryData(key(entityId), data);
      void client.invalidateQueries({ queryKey: [...key(entityId), "finance-expenses"] });
    },
    onError: () => { void client.invalidateQueries({ queryKey: key(entityId) }); },
  });
}
