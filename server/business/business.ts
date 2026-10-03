import type { BusinessAgreement, BusinessClient, BusinessData, BusinessEntitySummary, BusinessFollowUp, BusinessQuote, BusinessRetainer } from "../../shared/business-types";
import { clientMailMatcher } from "../../shared/business-mail";
import type { MailData, MailThread } from "../../shared/mail-types";
import type { VirtecSnapshot } from "../../shared/virtec-types";
import { readMailData } from "../mail/store";
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
const MONTHS_PER_CYCLE: Record<string, number> = { monthly: 1, quarterly: 3, biannual: 6, annual: 12 };
const STALE_QUOTE_DAYS = 7;
const DAY = 86_400_000;

/** What a retainer is worth per month. An `ad-hoc` one is billed when it happens, so counts as nothing. */
export function monthlyEquivalent(frequency: string, amount: number): number {
  const months = MONTHS_PER_CYCLE[frequency.trim().toLowerCase()];
  return months ? Math.round((amount / months) * 100) / 100 : 0;
}

/** Per client, at most this many threads: the screen shows recent contact, not an archive. */
const MAIL_PER_CLIENT = 10;

export function buildBusiness(snapshot: VirtecSnapshot, state: BusinessState, writable: boolean, now: Date = new Date(), mail?: MailData): BusinessData {
  const virtecEntity = state.entities.find((entity) => entity.source === "virtec");

  const mailByClient = groupMail(snapshot, mail);
  // Older quotes carry a project ID but no client ID. Resolve the exact link
  // so the client totals and the full quote list describe the same pipeline.
  const projectClients = new Map(snapshot.projects.map((project) => [project.id, project.clientId]));
  const sourceQuotes = snapshot.quotes.map((quote) => ({ ...quote, clientId: quote.clientId ?? projectClients.get(quote.projectId ?? "") }));

  const clients: BusinessClient[] = virtecEntity
    ? snapshot.clients.map((client) => {
        const projects = snapshot.projects.filter((project) => project.clientId === client.id);
        const quotes = sourceQuotes.filter((quote) => quote.clientId === client.id);
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
          mail: mailByClient.get(client.id) ?? [],
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

  const entityId = virtecEntity?.id;
  const names = new Map(snapshot.clients.map((client) => [client.id, client.companyName ?? client.name]));
  const nameFor = (clientId: string | undefined, fallback?: string) => (clientId ? names.get(clientId) : undefined) ?? fallback ?? "Unknown client";

  const quotes: BusinessQuote[] = entityId
    ? sourceQuotes.map((quote) => {
        const created = quote.createdAt ? Date.parse(quote.createdAt) : NaN;
        const ageDays = Number.isNaN(created) ? undefined : Math.max(0, Math.floor((now.getTime() - created) / DAY));
        return {
          id: quote.id,
          entityId,
          clientId: quote.clientId,
          clientName: nameFor(quote.clientId),
          projectType: quote.projectType,
          status: quote.status,
          totalAmount: quote.totalAmount ?? 0,
          createdAt: quote.createdAt,
          ageDays,
          stale: quote.status === "pending" && ageDays !== undefined && ageDays >= STALE_QUOTE_DAYS,
        };
      })
    : [];

  const agreements: BusinessAgreement[] = entityId
    ? snapshot.projects.flatMap((project) =>
        project.agreementStatus
          ? [{ projectId: project.id, entityId, clientId: project.clientId, clientName: nameFor(project.clientId, project.clientName), projectType: project.projectType, status: project.agreementStatus, amount: project.amount }]
          : [],
      )
    : [];

  const retainers: BusinessRetainer[] = entityId
    ? snapshot.projects.flatMap((project) =>
        project.maintenanceFrequency && isLive(project.status)
          ? [
              {
                projectId: project.id,
                entityId,
                clientId: project.clientId,
                clientName: nameFor(project.clientId, project.clientName),
                projectType: project.projectType,
                frequency: project.maintenanceFrequency,
                amount: project.maintenanceAmount ?? 0,
                monthlyEquivalent: monthlyEquivalent(project.maintenanceFrequency, project.maintenanceAmount ?? 0),
                status: project.status,
                serviceSku: project.serviceSku,
              },
            ]
          : [],
      )
    : [];

  // Open ones, and snoozed ones whose snooze has run out.
  const followUps: BusinessFollowUp[] = entityId
    ? snapshot.followUps
        .filter((followUp) => followUp.status === "open" || (followUp.status === "snoozed" && (!followUp.snoozedUntil || Date.parse(followUp.snoozedUntil) <= now.getTime())))
        .map((followUp) => {
          const due = followUp.dueAt ? Date.parse(followUp.dueAt) : NaN;
          return {
            id: followUp.id,
            entityId,
            type: followUp.type,
            customerId: followUp.customerId,
            customerName: followUp.customerName ?? nameFor(followUp.customerId),
            companyName: followUp.companyName,
            customerEmail: followUp.customerEmail,
            projectName: followUp.projectName,
            amount: followUp.amount,
            dueAt: followUp.dueAt,
            overdue: !Number.isNaN(due) && due < now.getTime(),
            reason: followUp.reason,
            suggestedSubject: followUp.suggestedSubject,
            suggestedMessage: followUp.suggestedMessage,
          };
        })
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
    : [];

  const failed = Object.entries(snapshot.sources ?? {}).filter(([, status]) => !status.ok).map(([source]) => source);

  return {
    virtecConfigured: snapshot.configured,
    virtecWritable: writable,
    fetchedAt: snapshot.fetchedAt,
    virtecProblem: snapshot.configured && failed.length > 0 ? `Virtec could not be read for: ${failed.join(", ")}.` : undefined,
    entities,
    clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
    quotes: quotes.sort((a, b) => Number(b.stale) - Number(a.stale) || (b.ageDays ?? 0) - (a.ageDays ?? 0)),
    agreements,
    retainers: retainers.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent),
    followUps,
    revenue: snapshot.revenue,
  };
}

function groupMail(snapshot: VirtecSnapshot, mail: MailData | undefined): Map<string, BusinessClient["mail"]> {
  const grouped = new Map<string, BusinessClient["mail"]>();
  if (!mail) return grouped;

  const match = clientMailMatcher(snapshot.clients);
  const tagged: [MailThread, boolean][] = [
    ...mail.needsYou.map((thread): [MailThread, boolean] => [thread, true]),
    ...mail.fyi.map((thread): [MailThread, boolean] => [thread, false]),
    ...mail.lowPriority.map((thread): [MailThread, boolean] => [thread, false]),
  ];

  for (const [thread, needsYou] of tagged) {
    const client = match(thread.fromEmail);
    if (!client) continue;
    const list = grouped.get(client.id) ?? [];
    list.push({ threadId: thread.threadId, subject: thread.subject, snippet: thread.snippet, messageDate: thread.messageDate, unread: thread.unread, needsYou });
    grouped.set(client.id, list);
  }

  for (const [id, list] of grouped) grouped.set(id, list.sort((a, b) => b.messageDate.localeCompare(a.messageDate)).slice(0, MAIL_PER_CLIENT));
  return grouped;
}

/** The Inbox's stored threads, or nothing: Business never fails because Mail is not set up. */
function storedMail(): MailData | undefined {
  try {
    return readMailData();
  } catch (error) {
    console.error("[agentos] business: Inbox threads could not be read:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

export async function getBusiness(options: { fresh?: boolean } = {}): Promise<BusinessData> {
  const [snapshot, state] = await Promise.all([getVirtecSnapshot(options), readBusinessState()]);
  return buildBusiness(snapshot, state, isVirtecWritable(), new Date(), storedMail());
}
