import type { BusinessClient, BusinessData, BusinessEntitySummary } from "@shared/business-types";

/**
 * Growth, derived from what Business already reads. Nothing is stored.
 *
 * The measures come from books that changed how agencies are run:
 *
 * - *Built to Sell* (Warrillow): recurring revenue is what makes a business
 *   worth something without you, and one client being too large a share of
 *   revenue is a risk to it. Hence recurring share and concentration.
 * - *The E-Myth Revisited* (Gerber): the work should run on a system, not on
 *   memory. Hence the weekly review is a list computed from real state.
 * - *Traction* lives on its own page; *Profit First* lives in Finance.
 */

/** Above this share of revenue, one client is a dependency rather than a customer. */
export const CONCENTRATION_LIMIT = 0.3;

export interface GrowthReport {
  /** Monthly value of live retainers. */
  recurringMonthly: number;
  /** Share of active clients on a retainer, 0..1; undefined with no active clients. */
  retainerShare?: number;
  /** The client with the largest share of lifetime spend, and that share. */
  largestClient?: { client: BusinessClient; share: number };
  /** The retainer with the largest share of recurring revenue, and that share. */
  largestRetainer?: { clientName: string; share: number };
  /** Active clients whose work is done and who have no care plan: the next offer to make. */
  upsell: BusinessClient[];
  /** The average accepted project quote, the price point actually being bought. */
  averageAcceptedQuote?: number;
  checklist: GrowthCheck[];
}

export interface GrowthCheck {
  id: string;
  label: string;
  count: number;
  /** The Business tab that resolves it. */
  tab: "clients" | "quotes" | "agreements" | "maintenance" | "follow-ups";
}

export function buildGrowth(data: BusinessData, entity: BusinessEntitySummary): GrowthReport {
  const own = <T extends { entityId: string }>(items: readonly T[]) => items.filter((item) => item.entityId === entity.id);
  const clients = own(data.clients);
  const retainers = own(data.retainers);
  const quotes = own(data.quotes);
  const active = clients.filter((client) => client.active);

  const recurringMonthly = retainers.reduce((sum, retainer) => sum + retainer.monthlyEquivalent, 0);

  const totalSpent = clients.reduce((sum, client) => sum + client.totalSpent, 0);
  const biggest = [...clients].sort((a, b) => b.totalSpent - a.totalSpent)[0];
  const largestClient = biggest && totalSpent > 0 ? { client: biggest, share: biggest.totalSpent / totalSpent } : undefined;

  const topRetainer = [...retainers].sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent)[0];
  const largestRetainer = topRetainer && recurringMonthly > 0 ? { clientName: topRetainer.clientName, share: topRetainer.monthlyEquivalent / recurringMonthly } : undefined;

  const onRetainer = new Set(retainers.map((retainer) => retainer.clientId).filter(Boolean));
  const upsell = active
    .filter((client) => !client.maintenance && !onRetainer.has(client.id) && client.projects.length > 0 && client.activeProjectCount === 0)
    .sort((a, b) => b.totalSpent - a.totalSpent);

  // Build prices only: a monthly maintenance charge is not what a project sells for.
  const accepted = quotes.filter((quote) => quote.kind === "project" && quote.status === "accepted" && quote.totalAmount > 0);
  const averageAcceptedQuote = accepted.length > 0 ? accepted.reduce((sum, quote) => sum + quote.totalAmount, 0) / accepted.length : undefined;

  const checklist: GrowthCheck[] = [
    { id: "overdue", label: "Overdue follow-ups to clear", count: own(data.followUps).filter((followUp) => followUp.overdue).length, tab: "follow-ups" as const },
    { id: "stale", label: "Quotes gone quiet to chase or close", count: quotes.filter((quote) => quote.stale).length, tab: "quotes" as const },
    { id: "agreements", label: "Agreements waiting on a signature", count: own(data.agreements).filter((agreement) => agreement.status === "pending" || agreement.status === "approved").length, tab: "agreements" as const },
    { id: "upsell", label: "Finished clients to offer a care plan", count: upsell.length, tab: "clients" as const },
    { id: "unlinked", label: "Active clients with no workspace", count: active.filter((client) => client.activeProjectCount > 0 && !client.workspace).length, tab: "clients" as const },
  ].filter((check) => check.count > 0);

  return {
    recurringMonthly,
    retainerShare: active.length > 0 ? active.filter((client) => client.maintenance || onRetainer.has(client.id)).length / active.length : undefined,
    largestClient,
    largestRetainer,
    upsell,
    averageAcceptedQuote,
    checklist,
  };
}
