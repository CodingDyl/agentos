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
});
export type BusinessClient = z.infer<typeof BusinessClientSchema>;

export const BusinessEntitySummarySchema = BusinessEntitySchema.extend({
  clientCount: z.number(),
  activeProjectCount: z.number(),
  pendingQuoteValue: z.number(),
  maintenanceClientCount: z.number(),
});
export type BusinessEntitySummary = z.infer<typeof BusinessEntitySummarySchema>;

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
});
export type BusinessData = z.infer<typeof BusinessDataSchema>;
