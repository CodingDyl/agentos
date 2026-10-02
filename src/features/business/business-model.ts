import type { BusinessClient } from "@shared/business-types";

export const BUSINESS_TABS = [
  { value: "overview", label: "Overview" },
  { value: "clients", label: "Clients" },
] as const;

export type BusinessTab = (typeof BUSINESS_TABS)[number]["value"];

export function isBusinessTab(value: string | null): value is BusinessTab {
  return BUSINESS_TABS.some((tab) => tab.value === value);
}

const RAND = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });

export function formatRand(amount: number): string {
  return RAND.format(amount);
}

/** Live work first, then by what is owed to a decision (quotes waiting), then name. */
export function sortClients(clients: readonly BusinessClient[]): BusinessClient[] {
  return [...clients].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.activeProjectCount - a.activeProjectCount ||
      b.pendingQuoteValue - a.pendingQuoteValue ||
      a.name.localeCompare(b.name),
  );
}

export function matchesClient(client: BusinessClient, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [client.name, client.companyName, client.email].some((field) => field?.toLowerCase().includes(needle));
}
