import type { ZodType } from "zod";
import {
  VirtecClientSchema,
  VirtecFollowUpSchema,
  VirtecLeadSchema,
  VirtecProjectSchema,
  VirtecQuoteSchema,
  VirtecRevenueSchema,
  type VirtecClient,
  type VirtecFollowUp,
  type VirtecLead,
  type VirtecProject,
  type VirtecQuote,
  type VirtecRevenue,
} from "../../shared/virtec-types";

/**
 * Virtec's payloads, read tolerantly.
 *
 * Virtec is a separate system that changes on its own schedule, so nothing
 * here trusts a field's type. A string is a string only if it is one; a
 * number only if it is finite. One unreadable record is skipped and counted —
 * it never costs the rest of the list.
 */

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((entry): entry is string => entry !== undefined) : [];
}

/**
 * A timestamp in any shape Virtec produces, as an ISO string.
 *
 * - Firestore over JSON: `{ _seconds, _nanoseconds }` (or `{ seconds, nanoseconds }`)
 * - an ISO string
 * - epoch milliseconds, or seconds when the number is too small to be millis
 *
 * Anything else — or a date that does not parse — is `undefined`, never "now".
 */
export function timestamp(value: unknown): string | undefined {
  let millis: number | undefined;

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    millis = Number.isNaN(parsed) ? undefined : parsed;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    // 1e11 ms is 1973; any seconds value for a real date is far below it.
    millis = value < 1e11 ? value * 1000 : value;
  } else if (isRecord(value)) {
    const seconds = number(value._seconds) ?? number(value.seconds);
    const nanos = number(value._nanoseconds) ?? number(value.nanoseconds) ?? 0;
    millis = seconds === undefined ? undefined : seconds * 1000 + Math.floor(nanos / 1e6);
  }

  if (millis === undefined) return undefined;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Drops `undefined` keys so the schemas see only what was actually present. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export type Normalised<T> = { items: T[]; skipped: number };

/**
 * Reads one list endpoint's payload.
 *
 * Virtec wraps each list — `{ leads: [...] }` — but a bare array is accepted
 * too, so a change of envelope does not empty the screen.
 */
function list<T>(payload: unknown, key: string, pick: (raw: Raw) => unknown, schema: ZodType<T>): Normalised<T> {
  const rows = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload[key]) ? payload[key] : undefined;
  if (!rows) throw new Error(`Virtec returned no \`${key}\` list`);

  const items: T[] = [];
  let skipped = 0;

  for (const row of rows) {
    const parsed = isRecord(row) ? schema.safeParse(pick(row)) : undefined;
    if (parsed?.success) items.push(parsed.data);
    else skipped += 1;
  }

  return { items, skipped };
}

export function normaliseLeads(payload: unknown): Normalised<VirtecLead> {
  return list(
    payload,
    "leads",
    (raw) =>
      defined({
        id: text(raw.id),
        name: text(raw.name),
        websiteUrl: text(raw.websiteUrl),
        ownerEmail: text(raw.ownerEmail),
        address: text(raw.address),
        area: text(raw.area) ?? text(raw.suburb),
        category: text(raw.category) ?? text(raw.primaryType),
        track: text(raw.track),
        websiteSignal: text(raw.websiteSignal),
        rating: number(raw.rating),
        reviewCount: number(raw.reviewCount),
        score: number(raw.score),
        scoreReasons: strings(raw.scoreReasons),
        status: text(raw.status),
        outreachStage: text(raw.outreachStage),
        outreachPitch: text(raw.outreachPitch),
        createdAt: timestamp(raw.createdAt),
      }),
    VirtecLeadSchema,
  );
}

export function normaliseClients(payload: unknown): Normalised<VirtecClient> {
  return list(
    payload,
    "clients",
    (raw) =>
      defined({
        id: text(raw.id),
        name: text(raw.name) ?? text(raw.companyName),
        email: text(raw.email),
        companyName: text(raw.companyName),
        totalSpent: number(raw.totalSpent),
        maintenance: boolean(raw.maintenance),
        // Virtec calls it `status`, but it is a boolean: active or not.
        active: boolean(raw.status),
        createdAt: timestamp(raw.createdAt),
      }),
    VirtecClientSchema,
  );
}

export function normaliseQuotes(payload: unknown): Normalised<VirtecQuote> {
  // `pdfUrl` is deliberately not read: a storage download URL works for
  // anyone who has it, which makes it a credential in all but name.
  return list(
    payload,
    "quotes",
    (raw) =>
      defined({
        id: text(raw.id),
        projectId: text(raw.projectId),
        projectType: text(raw.projectType),
        clientId: text(raw.clientId),
        totalAmount: number(raw.totalAmount),
        status: text(raw.status),
        features: strings(raw.features),
        createdAt: timestamp(raw.createdAt),
      }),
    VirtecQuoteSchema,
  );
}

export function normaliseProjects(payload: unknown): Normalised<VirtecProject> {
  return list(
    payload,
    "projects",
    (raw) =>
      defined({
        id: text(raw.id),
        projectType: text(raw.projectType),
        clientName: text(raw.clientName),
        clientId: text(raw.clientId),
        amount: number(raw.amount),
        status: text(raw.status),
        completion: number(raw.completion),
        agreementStatus: text(raw.agreementStatus),
        maintenanceFrequency: text(raw.maintenanceFrequency),
        maintenanceAmount: number(raw.maintenanceAmount),
        serviceSku: text(raw.serviceSku),
        createdAt: timestamp(raw.createdAt),
      }),
    VirtecProjectSchema,
  );
}

export function normaliseFollowUps(payload: unknown): Normalised<VirtecFollowUp> {
  return list(
    payload,
    "followUps",
    (raw) =>
      defined({
        id: text(raw.id),
        type: text(raw.type),
        status: text(raw.status),
        customerId: text(raw.customerId),
        customerName: text(raw.customerName),
        companyName: text(raw.companyName),
        customerEmail: text(raw.customerEmail),
        projectName: text(raw.projectName),
        amount: number(raw.amount),
        dueAt: timestamp(raw.dueAt),
        snoozedUntil: timestamp(raw.snoozedUntil),
        reason: text(raw.reason),
        suggestedSubject: text(raw.suggestedSubject),
        suggestedMessage: text(raw.suggestedMessage),
        lastSentAt: timestamp(raw.lastSentAt),
      }),
    VirtecFollowUpSchema,
  );
}

export function normaliseRevenue(payload: unknown): VirtecRevenue {
  if (!isRecord(payload)) throw new Error("Virtec returned no revenue summary");

  return VirtecRevenueSchema.parse(
    defined({
      monthlyRecurringRevenue: number(payload.monthlyRecurringRevenue),
      activeMaintenanceCustomers: number(payload.activeMaintenanceCustomers),
      upcomingInvoicesCount: number(payload.upcomingInvoicesCount),
      overdueInvoiceCount: number(payload.overdueInvoiceCount),
      pendingQuoteValue: number(payload.pendingQuoteValue),
      acceptedQuoteValueThisMonth: number(payload.acceptedQuoteValueThisMonth),
      totalRevenue: number(payload.totalRevenue),
      quoteConversionRate: number(payload.quoteConversionRate),
      stalePendingQuoteCount: number(payload.stalePendingQuoteCount),
    }),
  );
}
