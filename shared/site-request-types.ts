import { z } from "zod";
import { COMPLEXITY_MULTIPLIERS, URGENCY_MULTIPLIERS, DEFAULT_HOURLY_RATE } from "./business-quote-pricing";

/**
 * Customer website update requests: a client asks for a change or a new
 * feature on a live site; it is triaged, quoted if the plan does not cover
 * it, built, reviewed and shipped.
 *
 * A request can only be built once it is *approved*, and it can only be
 * approved when the client's plan covers it or its quote has been accepted.
 * That rule lives in the server; the pages only show it.
 */

export const SitePlanSchema = z.enum(["none", "care", "maintenance"]);
export type SitePlan = z.infer<typeof SitePlanSchema>;
export const SITE_PLAN_LABEL: Record<SitePlan, string> = { none: "No plan", care: "Care", maintenance: "Maintenance" };

/** The Care plan's "2h small fixes" a month; a Maintenance plan sets its own. */
export const CARE_INCLUDED_HOURS = 2;

export const SiteRequestKindSchema = z.enum(["change", "feature"]);
export const SiteRequestPrioritySchema = z.enum(["low", "normal", "urgent"]);
export const SITE_REQUEST_KIND_LABEL = { change: "Change", feature: "New feature" } as const;
export const SITE_REQUEST_PRIORITY_LABEL = { low: "Low", normal: "Normal", urgent: "Urgent" } as const;

export const SiteRequestStatusSchema = z.enum([
  "received",
  "triaged",
  "quote_needed",
  "quoted",
  "approved",
  "building",
  "blocked",
  "ready_for_review",
  "shipping",
  "live",
  "declined",
  "cancelled",
]);
export type SiteRequestStatus = z.infer<typeof SiteRequestStatusSchema>;

/** What Dylan sees. */
export const SITE_REQUEST_STATUS_LABEL: Record<SiteRequestStatus, string> = {
  received: "Received",
  triaged: "Triaged",
  quote_needed: "Needs a quote",
  quoted: "Quote sent",
  approved: "Approved",
  building: "Building",
  blocked: "Blocked",
  ready_for_review: "Ready for review",
  shipping: "Shipping",
  live: "Live",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ClientStatusLabelSchema = z.enum(["Received", "In progress", "Ready for review", "Live", "Closed"]);
export type ClientStatusLabel = z.infer<typeof ClientStatusLabelSchema>;

/** What the client is told: four steps, whatever happens behind them. */
export function clientStatusLabel(status: SiteRequestStatus): ClientStatusLabel {
  switch (status) {
    case "received":
    case "triaged":
    case "quote_needed":
    case "quoted":
      return "Received";
    case "approved":
    case "building":
    case "blocked":
    case "shipping":
      return "In progress";
    case "ready_for_review":
      return "Ready for review";
    case "live":
      return "Live";
    case "declined":
    case "cancelled":
      return "Closed";
  }
}

/** Statuses in which a request has been let through to be built, or has been built. Their estimate counts against the month's hours. */
export const BUILT_OR_BUILDING: ReadonlySet<SiteRequestStatus> = new Set(["approved", "building", "blocked", "ready_for_review", "shipping", "live"]);

const Slug = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, "A site's slug uses lowercase letters, numbers and dashes.");

export const ClientSiteInputSchema = z
  .object({
    slug: Slug,
    company: z.string().trim().min(1).max(120),
    clientId: z.string().trim().max(120).optional(),
    contactEmail: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
    repoPath: z.string().trim().max(500).optional(),
    githubRepo: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name.").optional().or(z.literal("")),
    vercelProject: z.string().trim().max(120).optional(),
    productionUrl: z.union([z.literal(""), z.string().trim().url().max(500).regex(/^https?:\/\//, "Start with http:// or https://")]).optional(),
    plan: SitePlanSchema.default("none"),
    includedHoursPerMonth: z.number().finite().min(0).max(200).optional(),
  })
  .strict();
export type ClientSiteInput = z.input<typeof ClientSiteInputSchema>;

export const ClientSiteSchema = z.object({
  slug: z.string(),
  company: z.string(),
  clientId: z.string().optional(),
  contactEmail: z.string().optional(),
  repoPath: z.string().optional(),
  githubRepo: z.string().optional(),
  vercelProject: z.string().optional(),
  productionUrl: z.string().optional(),
  plan: SitePlanSchema,
  includedHoursPerMonth: z.number(),
  /** Hours of covered requests approved so far this calendar month. */
  hoursUsedThisMonth: z.number(),
  createdAt: z.string(),
});
export type ClientSite = z.infer<typeof ClientSiteSchema>;

/** A finished rebuild that is not registered as a client site yet, with what it already knows. */
export const SiteSuggestionSchema = z.object({
  slug: z.string(),
  company: z.string(),
  repoPath: z.string().optional(),
  githubRepo: z.string().optional(),
  vercelProject: z.string().optional(),
});
export type SiteSuggestion = z.infer<typeof SiteSuggestionSchema>;

export const TriageClassificationSchema = z.enum(["small_edit", "new_feature"]);
export const TRIAGE_LABEL = { small_edit: "Small edit", new_feature: "New feature" } as const;

export const TriageAnswerSchema = z
  .object({
    classification: TriageClassificationSchema,
    estimateHours: z.number().finite().min(0).max(500),
    reason: z.string().trim().min(1).max(600),
  })
  .strict();
export type TriageAnswer = z.infer<typeof TriageAnswerSchema>;

export const TriageSchema = TriageAnswerSchema.extend({
  /** Whether the client's plan pays for it, and why or why not. */
  covered: z.boolean(),
  coverage: z.string(),
  setBy: z.enum(["ai", "person"]),
  at: z.string(),
});
export type Triage = z.infer<typeof TriageSchema>;

export interface CoverageInput {
  plan: SitePlan;
  includedHoursPerMonth: number;
  /** Hours of covered requests already let through this calendar month. */
  hoursUsed: number;
  classification: z.infer<typeof TriageClassificationSchema>;
  estimateHours: number;
}

/**
 * Whether a plan pays for a request: a small edit, on a Care or Maintenance
 * plan, that fits in the hours left this month. The reason names the first
 * test that fails, so the person knows why a quote is needed.
 */
export function coverageOf(input: CoverageInput): { covered: boolean; reason: string } {
  if (input.plan === "none") return { covered: false, reason: "This site has no Care or Maintenance plan." };
  if (input.classification === "new_feature") return { covered: false, reason: "A new feature is quoted, not covered by the plan." };
  const left = Math.max(0, input.includedHoursPerMonth - input.hoursUsed);
  if (input.estimateHours > left) {
    return {
      covered: false,
      reason: left === 0 ? `This month's ${input.includedHoursPerMonth}h are used up.` : `${input.estimateHours}h is more than the ${left}h left of this month's ${input.includedHoursPerMonth}h.`,
    };
  }
  return { covered: true, reason: `Covered by the ${SITE_PLAN_LABEL[input.plan]} plan: ${input.estimateHours}h of ${left}h left this month.` };
}

export const QuoteLineSchema = z.object({ label: z.string(), value: z.number(), type: z.enum(["amount", "multiplier", "discount"]) });

export const QuoteSchema = z.object({
  estimatedHours: z.number(),
  hourlyRate: z.number(),
  complexity: z.enum(["Low", "Medium", "High"]),
  urgency: z.enum(["Standard", "Rush", "Extreme Rush"]),
  lines: z.array(QuoteLineSchema),
  total: z.number(),
  createdAt: z.string(),
  /** Set by hand when the client agrees. */
  acceptedAt: z.string().optional(),
  /** The Mail draft with the quote in it, when one was made. */
  draftedAt: z.string().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const QuoteRequestSchema = z
  .object({
    estimatedHours: z.number().finite().min(0.25).max(500),
    complexity: z.enum(Object.keys(COMPLEXITY_MULTIPLIERS) as [keyof typeof COMPLEXITY_MULTIPLIERS, ...(keyof typeof COMPLEXITY_MULTIPLIERS)[]]).default("Medium"),
    urgency: z.enum(Object.keys(URGENCY_MULTIPLIERS) as [keyof typeof URGENCY_MULTIPLIERS, ...(keyof typeof URGENCY_MULTIPLIERS)[]]).default("Standard"),
    hourlyRate: z.number().finite().min(0).max(100_000).default(DEFAULT_HOURLY_RATE),
  })
  .strict();

export const SiteRequestScreenshotSchema = z.object({ id: z.string(), name: z.string(), href: z.string() });

export const SiteRequestEventSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  kind: z.enum(["status", "triage", "quote", "decision", "email", "note", "screenshot"]),
  message: z.string(),
});

export const SiteRequestSchema = z.object({
  id: z.string(),
  siteSlug: z.string(),
  company: z.string(),
  kind: SiteRequestKindSchema,
  title: z.string(),
  description: z.string(),
  page: z.string().optional(),
  priority: SiteRequestPrioritySchema,
  source: z.enum(["manual", "mail"]),
  /** The Mail thread this came from, when it came from one. */
  threadId: z.string().optional(),
  status: SiteRequestStatusSchema,
  clientStatus: ClientStatusLabelSchema,
  screenshots: z.array(SiteRequestScreenshotSchema),
  triage: TriageSchema.optional(),
  quote: QuoteSchema.optional(),
  approvedAt: z.string().optional(),
  /** Whether the Approve button works now: covered by the plan, or the quote accepted. */
  canApprove: z.boolean(),
  /** Why the request cannot be built yet, in words, while it cannot. */
  buildBlocker: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(SiteRequestEventSchema),
});
export type SiteRequest = z.infer<typeof SiteRequestSchema>;

export const SiteRequestSummarySchema = SiteRequestSchema.omit({ events: true, screenshots: true, description: true });
export type SiteRequestSummary = z.infer<typeof SiteRequestSummarySchema>;

export const SiteRequestCreateSchema = z
  .object({
    siteSlug: Slug,
    kind: SiteRequestKindSchema,
    title: z.string().trim().min(1, "Give the request a short title.").max(160),
    description: z.string().trim().min(1, "Say what the client wants.").max(8000),
    page: z.string().trim().max(200).optional(),
    priority: SiteRequestPrioritySchema.default("normal"),
    source: z.enum(["manual", "mail"]).default("manual"),
    threadId: z.string().trim().max(200).optional(),
  })
  .strict();
export type SiteRequestCreateInput = z.input<typeof SiteRequestCreateSchema>;

/** Dylan's own call on a request: it replaces the AI's. */
export const TriageOverrideSchema = z
  .object({
    classification: TriageClassificationSchema,
    estimateHours: z.number().finite().min(0).max(500),
    reason: z.string().trim().max(600).optional(),
  })
  .strict();
