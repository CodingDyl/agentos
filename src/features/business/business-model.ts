import type { BusinessClient } from "@shared/business-types";

export const BUSINESS_TABS = [
  { value: "overview", label: "Overview" },
  { value: "billing", label: "Billing & cash flow" },
  { value: "growth", label: "Growth" },
  { value: "clients", label: "Clients" },
  { value: "quotes", label: "Quotes" },
  { value: "agreements", label: "Agreements" },
  { value: "maintenance", label: "Maintenance" },
  { value: "follow-ups", label: "Follow-ups" },
  { value: "setup", label: "Setup & import" },
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

/** A follow-up as an email a person can review and send themselves. Nothing is sent from here. */
export function followUpMailto(email: string | undefined, subject: string | undefined, message: string | undefined): string | undefined {
  if (!email) return undefined;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (message) params.set("body", message);
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}${query ? `?${query}` : ""}`;
}
