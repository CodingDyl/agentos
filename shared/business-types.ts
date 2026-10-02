import { z } from "zod";

/**
 * Business: the companies being run, and the clients each one serves.
 *
 * A *business entity* is a company with its own clients, pipeline and money —
 * Virtec (the agency), Pantry Pilot and Voxmachine (products). It is not a
 * workspace: a workspace is an area of work. An entity links to the
 * workspaces that do its work, and a client links to the workspace its
 * project lives in.
 *
 * Stage 1 reads clients from Virtec, which is the system of record while the
 * CRM is taken over module by module. Entities with no client source yet
 * simply have none; nothing here invents them.
 */

export const BusinessKindSchema = z.enum(["agency", "product"]);
export type BusinessKind = z.infer<typeof BusinessKindSchema>;

/** Where an entity's clients come from. `local` has no source yet. */
export const BusinessSourceSchema = z.enum(["virtec", "local"]);
export type BusinessSource = z.infer<typeof BusinessSourceSchema>;

export const WorkspaceSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/, "Not a workspace slug");

export const BusinessEntitySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: z.string().min(1).max(80),
  kind: BusinessKindSchema,
  source: BusinessSourceSchema,
  /** Slugs of the workspaces that do this business's work. */
  workspaces: z.array(WorkspaceSlugSchema).default([]),
});
export type BusinessEntity = z.infer<typeof BusinessEntitySchema>;

export const DEFAULT_BUSINESS_ENTITIES: readonly BusinessEntity[] = [
  { id: "virtec", name: "Virtec", kind: "agency", source: "virtec", workspaces: [] },
  { id: "pantry-pilot", name: "Pantry Pilot", kind: "product", source: "local", workspaces: [] },
  { id: "voxmachine", name: "Voxmachine", kind: "product", source: "local", workspaces: [] },
];

export const EntityWorkspacesPatchSchema = z.object({
  workspaces: z.array(WorkspaceSlugSchema).max(40),
});

/** `null` clears the link. */
export const ClientWorkspaceLinkSchema = z.object({
  workspace: WorkspaceSlugSchema.nullable(),
});

export const BusinessClientProjectSchema = z.object({
  id: z.string(),
  projectType: z.string().optional(),
  status: z.string().optional(),
  completion: z.number().optional(),
  amount: z.number().optional(),
  maintenanceFrequency: z.string().optional(),
  agreementStatus: z.string().optional(),
});

export const BusinessClientQuoteSchema = z.object({
  id: z.string(),
  projectType: z.string().optional(),
  status: z.string().optional(),
  totalAmount: z.number().optional(),
  createdAt: z.string().optional(),
});

/** One Inbox thread, matched to a client by its sender. */
export const BusinessClientMailSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  snippet: z.string(),
  messageDate: z.string(),
  unread: z.boolean(),
  /** In the Inbox's Needs you bucket. */
  needsYou: z.boolean(),
});
export type BusinessClientMail = z.infer<typeof BusinessClientMailSchema>;

export const BusinessClientSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  name: z.string(),
  companyName: z.string().optional(),
  email: z.string().optional(),
  active: z.boolean(),
  maintenance: z.boolean(),
  totalSpent: z.number(),
  projects: z.array(BusinessClientProjectSchema),
  quotes: z.array(BusinessClientQuoteSchema),
  activeProjectCount: z.number(),
  pendingQuoteValue: z.number(),
  openFollowUps: z.number(),
  /** The workspace this client's work lives in, when one has been linked. */
  workspace: WorkspaceSlugSchema.optional(),
  /** Recent Inbox threads from this client, newest first. */
  mail: z.array(BusinessClientMailSchema).default([]),
});
export type BusinessClient = z.infer<typeof BusinessClientSchema>;

export const BusinessEntitySummarySchema = BusinessEntitySchema.extend({
  clientCount: z.number(),
  activeProjectCount: z.number(),
  pendingQuoteValue: z.number(),
  maintenanceClientCount: z.number(),
});
export type BusinessEntitySummary = z.infer<typeof BusinessEntitySummarySchema>;

/** A quote, with who it is for and how long it has been waiting. */
export const BusinessQuoteSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  clientId: z.string().optional(),
  clientName: z.string(),
  projectType: z.string().optional(),
  status: z.string().optional(),
  totalAmount: z.number(),
  createdAt: z.string().optional(),
  /** Whole days since it was created; absent when Virtec gave no date. */
  ageDays: z.number().optional(),
  /** Pending for a week or more: the quote most likely to go quiet. */
  stale: z.boolean(),
});
export type BusinessQuote = z.infer<typeof BusinessQuoteSchema>;

/** A project's letter agreement. The document itself stays in Virtec. */
export const BusinessAgreementSchema = z.object({
  projectId: z.string(),
  entityId: z.string(),
  clientId: z.string().optional(),
  clientName: z.string(),
  projectType: z.string().optional(),
  /** `pending`, `approved`, `declined`, `signed`. */
  status: z.string(),
  amount: z.number().optional(),
});
export type BusinessAgreement = z.infer<typeof BusinessAgreementSchema>;

/** A maintenance project billed on a repeating cycle. */
export const BusinessRetainerSchema = z.object({
  projectId: z.string(),
  entityId: z.string(),
  clientId: z.string().optional(),
  clientName: z.string(),
  projectType: z.string().optional(),
  frequency: z.string(),
  amount: z.number(),
  /** What it is worth per month; `ad-hoc` retainers are worth nothing until billed. */
  monthlyEquivalent: z.number(),
  status: z.string().optional(),
  serviceSku: z.string().optional(),
});
export type BusinessRetainer = z.infer<typeof BusinessRetainerSchema>;

export const BusinessFollowUpSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  type: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string(),
  companyName: z.string().optional(),
  customerEmail: z.string().optional(),
  projectName: z.string().optional(),
  amount: z.number().optional(),
  dueAt: z.string().optional(),
  overdue: z.boolean(),
  reason: z.string().optional(),
  suggestedSubject: z.string().optional(),
  suggestedMessage: z.string().optional(),
});
export type BusinessFollowUp = z.infer<typeof BusinessFollowUpSchema>;

export const FOLLOW_UP_ACTIONS = ["sent", "snooze", "dismiss"] as const;
export const FollowUpActionSchema = z.object({
  action: z.enum(FOLLOW_UP_ACTIONS),
  /** Snooze length in days; ignored by the other actions. */
  days: z.number().int().min(1).max(30).default(3),
});
export type FollowUpAction = z.infer<typeof FollowUpActionSchema>;

export const BusinessRevenueSchema = z.object({
  monthlyRecurringRevenue: z.number().optional(),
  pendingQuoteValue: z.number().optional(),
  acceptedQuoteValueThisMonth: z.number().optional(),
  totalRevenue: z.number().optional(),
  quoteConversionRate: z.number().optional(),
  overdueInvoiceCount: z.number().optional(),
});

export const BusinessDataSchema = z.object({
  /** False when Virtec's environment variables are not set. */
  virtecConfigured: z.boolean(),
  /** Whether Virtec accepts writes from AgentOS (stage 2 depends on it). */
  virtecWritable: z.boolean(),
  fetchedAt: z.string().optional(),
  /** Set when Virtec was reachable but a source failed to read. */
  virtecProblem: z.string().optional(),
  entities: z.array(BusinessEntitySummarySchema),
  clients: z.array(BusinessClientSchema),
  quotes: z.array(BusinessQuoteSchema),
  agreements: z.array(BusinessAgreementSchema),
  retainers: z.array(BusinessRetainerSchema),
  followUps: z.array(BusinessFollowUpSchema),
  revenue: BusinessRevenueSchema.optional(),
});
export type BusinessData = z.infer<typeof BusinessDataSchema>;
