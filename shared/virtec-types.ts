import { z } from "zod";

/**
 * Virtec, as AgentOS sees it.
 *
 * Virtec is the CRM behind Virtara: leads, clients, quotes, projects,
 * follow-ups and money, plus the leads our own websites capture. AgentOS
 * reads it through Virtec's `/api/agentos/*` surface, and writes back only a
 * few statuses, behind a separate key (`server/virtec/writes.ts`).
 *
 * These are the *normalised* shapes — what the adapter produces after reading
 * Virtec, not Virtec's raw payload. Two things happen on the way:
 *
 * - **Only what a screen uses is kept.** Phone numbers, quote PDF links and
 *   enrichment internals are dropped at the boundary, so they can never leak
 *   into a response, a log or a Hermes prompt by accident.
 * - **Timestamps become ISO strings.** Virtec returns Firestore timestamps
 *   (`{ _seconds, _nanoseconds }`), and sometimes plain strings or numbers.
 *   Every shape is read; anything unreadable is dropped rather than guessed.
 */

export const VirtecLeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  websiteUrl: z.string().optional(),
  ownerEmail: z.string().optional(),
  address: z.string().optional(),
  area: z.string().optional(),
  category: z.string().optional(),
  track: z.string().optional(),
  /** `none`, `facebook_only`, `weak`, `ok`, `unknown`. */
  websiteSignal: z.string().optional(),
  rating: z.number().optional(),
  reviewCount: z.number().optional(),
  /** 0–100, Virtec's own lead score. */
  score: z.number().optional(),
  scoreReasons: z.array(z.string()).default([]),
  /** `new`, `reviewing`, `qualified`, `disqualified`, `converted`. */
  status: z.string().optional(),
  /** `none`, `o1`, `o2`, `o3`, `replied`, `stopped`. */
  outreachStage: z.string().optional(),
  outreachPitch: z.string().optional(),
  createdAt: z.string().optional(),
});

export const VirtecClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  companyName: z.string().optional(),
  totalSpent: z.number().optional(),
  maintenance: z.boolean().optional(),
  active: z.boolean().optional(),
  createdAt: z.string().optional(),
});

export const VirtecQuoteSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  projectType: z.string().optional(),
  clientId: z.string().optional(),
  totalAmount: z.number().optional(),
  /** `pending`, `accepted`, `rejected`. */
  status: z.string().optional(),
  features: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});

export const VirtecProjectSchema = z.object({
  id: z.string(),
  projectType: z.string().optional(),
  clientName: z.string().optional(),
  clientId: z.string().optional(),
  amount: z.number().optional(),
  status: z.string().optional(),
  /** 0–100. */
  completion: z.number().optional(),
  agreementStatus: z.string().optional(),
  maintenanceFrequency: z.string().optional(),
  maintenanceAmount: z.number().optional(),
  serviceSku: z.string().optional(),
  /**
   * When a person last opened the client's portal (never a link preview or
   * the operator's own preview). Only the latest view is kept, not a history.
   */
  portalLastViewedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

export const VirtecFollowUpSchema = z.object({
  id: z.string(),
  /** `quote_pending`, `agreement_pending`, `invoice_overdue`, `maintenance_renewal`, `project_stale`. */
  type: z.string().optional(),
  /** `open`, `sent`, `dismissed`, `snoozed`. */
  status: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  companyName: z.string().optional(),
  customerEmail: z.string().optional(),
  projectName: z.string().optional(),
  amount: z.number().optional(),
  dueAt: z.string().optional(),
  snoozedUntil: z.string().optional(),
  reason: z.string().optional(),
  suggestedSubject: z.string().optional(),
  suggestedMessage: z.string().optional(),
  lastSentAt: z.string().optional(),
});

/**
 * A person who filled in a form on the Virtara or Jurivo site.
 *
 * Unlike a local lead, they asked to be contacted, so their phone number is
 * kept: replying is the whole point. Their message is their own words and is
 * treated as data, never as an instruction, wherever it is shown or sent.
 */
export const VirtecInboundLeadSchema = z.object({
  id: z.string(),
  /** `virtara` or `jurivo`. */
  track: z.string().optional(),
  /** Which form: `start-a-project`, `contact`, `demo-request`... */
  source: z.string().optional(),
  /** `new`, `reviewing`, `replied`, `won`, `not_a_fit`, `spam`. */
  status: z.string().optional(),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  website: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.string(), z.string()).default({}),
  page: z.string().optional(),
  /** For a lead magnet signup: when Virtec sent the magnet's email, or why it could not. */
  nurtureSentAt: z.string().optional(),
  nurtureError: z.string().optional(),
  createdAt: z.string().optional(),
});

export const VirtecRevenueSchema = z.object({
  monthlyRecurringRevenue: z.number().optional(),
  activeMaintenanceCustomers: z.number().optional(),
  upcomingInvoicesCount: z.number().optional(),
  overdueInvoiceCount: z.number().optional(),
  pendingQuoteValue: z.number().optional(),
  acceptedQuoteValueThisMonth: z.number().optional(),
  totalRevenue: z.number().optional(),
  /** A percentage, 0–100, as Virtec reports it. */
  quoteConversionRate: z.number().optional(),
  stalePendingQuoteCount: z.number().optional(),
});

/**
 * What a Places scan can be pointed at, and what is left to spend.
 *
 * `cap` is null until Virtec's `PLACES_MONTHLY_REQUEST_CAP` is set; scans
 * started from AgentOS are refused until then.
 */
export const VirtecScanInfoSchema = z.object({
  areas: z.array(z.object({ key: z.string(), label: z.string() })),
  categories: z.array(z.object({ category: z.string(), track: z.string(), types: z.array(z.string()) })),
  budget: z.object({
    month: z.string(),
    used: z.number(),
    cap: z.number().nullable(),
    remaining: z.number().nullable(),
  }),
});

export const VirtecScanResultSchema = z.object({
  summary: z.object({
    fetched: z.number().default(0),
    upserted: z.number().default(0),
    skipped: z.number().default(0),
    requests: z.number().default(0),
    errors: z.array(z.string()).default([]),
    stoppedByCap: z.boolean().optional(),
    message: z.string().optional(),
  }),
  budget: VirtecScanInfoSchema.shape.budget,
});

export const VirtecSourceSchema = z.enum(["leads", "inbound", "clients", "quotes", "projects", "followUps", "revenue"]);

/** Whether one endpoint answered. A failed source degrades its section, never the whole screen. */
export const VirtecSourceStatusSchema = z.object({
  ok: z.boolean(),
  /** A plain explanation — never the key, never Virtec's raw error body. */
  error: z.string().optional(),
  /** Records Virtec returned that could not be read, and were skipped. */
  skipped: z.number().int().default(0),
});

export const VirtecSnapshotSchema = z.object({
  /** False when AgentOS has no Virtec URL or key; nothing was requested. */
  configured: z.boolean(),
  fetchedAt: z.string().optional(),
  sources: z.record(VirtecSourceSchema, VirtecSourceStatusSchema).optional(),
  leads: z.array(VirtecLeadSchema).default([]),
  inbound: z.array(VirtecInboundLeadSchema).default([]),
  clients: z.array(VirtecClientSchema).default([]),
  quotes: z.array(VirtecQuoteSchema).default([]),
  projects: z.array(VirtecProjectSchema).default([]),
  followUps: z.array(VirtecFollowUpSchema).default([]),
  revenue: VirtecRevenueSchema.optional(),
});

export type VirtecScanInfo = z.infer<typeof VirtecScanInfoSchema>;
export type VirtecScanResult = z.infer<typeof VirtecScanResultSchema>;
export type VirtecLead = z.infer<typeof VirtecLeadSchema>;
export type VirtecInboundLead = z.infer<typeof VirtecInboundLeadSchema>;
export type VirtecClient = z.infer<typeof VirtecClientSchema>;
export type VirtecQuote = z.infer<typeof VirtecQuoteSchema>;
export type VirtecProject = z.infer<typeof VirtecProjectSchema>;
export type VirtecFollowUp = z.infer<typeof VirtecFollowUpSchema>;
export type VirtecRevenue = z.infer<typeof VirtecRevenueSchema>;
export type VirtecSource = z.infer<typeof VirtecSourceSchema>;
export type VirtecSourceStatus = z.infer<typeof VirtecSourceStatusSchema>;
export type VirtecSnapshot = z.infer<typeof VirtecSnapshotSchema>;

/** `crmId` prefixes, so a Traction prospect can say which Virtec record it came from. */
export const VIRTEC_LEAD_PREFIX = "virtec:lead:";
export const VIRTEC_CLIENT_PREFIX = "virtec:client:";
export const VIRTEC_INBOUND_PREFIX = "virtec:inbound:";

/**
 * Rand, the way Virtec's numbers read on screen: `R 25 000`.
 *
 * Whole rand, grouped by thin spaces as South African usage has it — with the
 * locale's non-breaking space replaced by a plain one so the output is the
 * same on every machine.
 */
export function formatRand(amount: number | undefined): string | undefined {
  if (amount === undefined) return undefined;
  const grouped = Math.round(Math.abs(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${amount < 0 ? "-" : ""}R ${grouped}`;
}

const SITE_NAMES: Record<string, string> = { virtara: "Virtara", jurivo: "Jurivo" };

const FORM_NAMES: Record<string, string> = {
  "start-a-project": "start a project",
  contact: "contact",
  seo: "SEO enquiry",
  starter: "starter package",
  professional: "professional package",
  enterprise: "enterprise package",
  "health-check": "health check download",
  audit: "audit booking",
  "demo-request": "demo request",
};

/** "Jurivo demo request": which of our sites, and which form on it, in words. */
export function inboundOrigin(lead: Pick<VirtecInboundLead, "track" | "source">): string {
  return `${SITE_NAMES[lead.track ?? ""] ?? "Website"} ${FORM_NAMES[lead.source ?? ""] ?? lead.source ?? "form"}`;
}
