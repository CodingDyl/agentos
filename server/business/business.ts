import type { BusinessClient, BusinessData, BusinessEntitySummary } from "../../shared/business-types";
import type { VirtecSnapshot } from "../../shared/virtec-types";
import { isVirtecWritable } from "../virtec/client";
import { getVirtecSnapshot } from "../virtec/snapshot";
import { readBusinessState, type BusinessState } from "./store";

/**
 * Business, derived: Virtec's clients with their projects, quotes and
 * follow-ups folded in, grouped under the entity that owns them.
 *
 * Pure over (snapshot, state) so it is testable without Virtec or a disk.
 */

/** Project states that no longer count as live work. */
const FINISHED = new Set(["completed", "complete", "cancelled", "canceled", "done", "archived"]);

function isLive(status: string | undefined): boolean {
  return !FINISHED.has((status ?? "").trim().toLowerCase());
}

/** Every Virtec client belongs to the entity whose source is Virtec. */
export function buildBusiness(snapshot: VirtecSnapshot, state: BusinessState, writable: boolean): BusinessData {
  const virtecEntity = state.entities.find((entity) => entity.source === "virtec");

  const clients: BusinessClient[] = virtecEntity
    ? snapshot.clients.map((client) => {
        const projects = snapshot.projects.filter((project) => project.clientId === client.id);
        const quotes = snapshot.quotes.filter((quote) => quote.clientId === client.id);
        const followUps = snapshot.followUps.filter((followUp) => followUp.customerId === client.id && followUp.status === "open");

        return {
          id: client.id,
          entityId: virtecEntity.id,
          name: client.name,
          companyName: client.companyName,
          email: client.email,
          active: client.active ?? true,
          maintenance: client.maintenance ?? false,
          totalSpent: client.totalSpent ?? 0,
          projects: projects.map((project) => ({
            id: project.id,
            projectType: project.projectType,
            status: project.status,
            completion: project.completion,
            amount: project.amount,
            maintenanceFrequency: project.maintenanceFrequency,
            agreementStatus: project.agreementStatus,
          })),
          quotes: quotes.map((quote) => ({
            id: quote.id,
            projectType: quote.projectType,
            status: quote.status,
            totalAmount: quote.totalAmount,
            createdAt: quote.createdAt,
          })),
          activeProjectCount: projects.filter((project) => isLive(project.status)).length,
          pendingQuoteValue: quotes.filter((quote) => quote.status === "pending").reduce((sum, quote) => sum + (quote.totalAmount ?? 0), 0),
          openFollowUps: followUps.length,
          workspace: state.clientWorkspaces[client.id],
        };
      })
    : [];

  const entities: BusinessEntitySummary[] = state.entities.map((entity) => {
    const owned = clients.filter((client) => client.entityId === entity.id);
    return {
      ...entity,
      clientCount: owned.length,
      activeProjectCount: owned.reduce((sum, client) => sum + client.activeProjectCount, 0),
      pendingQuoteValue: owned.reduce((sum, client) => sum + client.pendingQuoteValue, 0),
      maintenanceClientCount: owned.filter((client) => client.maintenance && client.active).length,
    };
  });

  const failed = Object.entries(snapshot.sources ?? {}).filter(([, status]) => !status.ok).map(([source]) => source);

  return {
    virtecConfigured: snapshot.configured,
    virtecWritable: writable,
    fetchedAt: snapshot.fetchedAt,
    virtecProblem: snapshot.configured && failed.length > 0 ? `Virtec could not be read for: ${failed.join(", ")}.` : undefined,
    entities,
    clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getBusiness(options: { fresh?: boolean } = {}): Promise<BusinessData> {
  const [snapshot, state] = await Promise.all([getVirtecSnapshot(options), readBusinessState()]);
  return buildBusiness(snapshot, state, isVirtecWritable());
}
