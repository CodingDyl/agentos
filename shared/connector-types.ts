import { z } from "zod";

/**
 * Connectors: the services AgentOS can reach, and what it may do in each.
 *
 * The unit the orchestrator reasons about is the *capability* —
 * `github.create_pull_request`, `gmail.send` — not the provider. A connector is
 * the account behind a group of capabilities; a capability is one action with
 * one risk and one policy.
 *
 * Nothing here ever carries a secret. Setup is described by the *names* of the
 * variables a connector reads and whether each is set, never their values; an
 * account is shown by its public handle only.
 */

/**
 * - `connected`   configured here and, as far as AgentOS last looked, working
 * - `disconnected` AgentOS has an adapter, but it is not set up on this machine
 * - `error`       set up, but the last connection test failed
 * - `unavailable` AgentOS has no adapter for it yet
 */
export const ConnectorStatusSchema = z.enum(["connected", "disconnected", "error", "unavailable"]);

/**
 * How much a capability can change, in increasing order.
 *
 * - `read`                   no side effect anywhere
 * - `write-local`            changes AgentOS state or files on this machine
 * - `write-external`         changes another service (GitHub, Vercel, Virtec…)
 * - `external-communication` reaches a person: email, messages, published copy
 * - `destructive`            deletes or moves money; not cleanly reversible
 */
export const CapabilityRiskSchema = z.enum([
  "read",
  "write-local",
  "write-external",
  "external-communication",
  "destructive",
]);

/**
 * What AgentOS may do with a capability.
 *
 * `approval` means an agent may ask for it but a person must confirm. A person
 * pressing the button in AgentOS *is* that confirmation, so it only holds an
 * agent back. `disabled` refuses everyone.
 */
export const CapabilityPolicySchema = z.enum(["allowed", "approval", "disabled"]);

export const ConnectorCategorySchema = z.enum([
  "development",
  "business",
  "communication",
  "productivity",
  "data",
  "finance",
  "creative",
  "analytics",
]);

/** Priority for AgentOS, 1 (core) to 5 (creative). Orders the page and the recommendations. */
export const ConnectorTierSchema = z.number().int().min(1).max(5);

export const ConnectorCapabilitySchema = z.object({
  /** `<connector>.<action>`, stable: policies and usage history are keyed by it. */
  id: z.string(),
  name: z.string(),
  risk: CapabilityRiskSchema,
  policy: CapabilityPolicySchema,
  /** True when the operator changed the policy from its default. */
  policyOverridden: z.boolean(),
  defaultPolicy: CapabilityPolicySchema,
  /** Whether AgentOS has a code path for this action today. */
  implemented: z.boolean(),
  /** Whether it could run right now: connector connected and any extra grant present. */
  available: z.boolean(),
  /** Why it can't run, when it can't. */
  unavailableReason: z.string().optional(),
});

export const ConnectorSetupItemSchema = z.object({
  /** An environment variable name, or a short step such as "Sign in from Inbox". */
  label: z.string(),
  kind: z.enum(["env", "oauth", "cli", "path"]),
  /** Whether this step is already done. Never the value itself. */
  done: z.boolean(),
});

export const ConnectorUseSchema = z.object({
  capabilityId: z.string(),
  capabilityName: z.string(),
  at: z.string(),
  /** A short, non-sensitive note: a branch name, a record kind. Never a body or a key. */
  detail: z.string().optional(),
});

export const ConnectorHealthSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  detail: z.string(),
});

export const ConnectorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: ConnectorCategorySchema,
  tier: ConnectorTierSchema,
  /** A key into the UI's icon set. */
  icon: z.string(),
  status: ConnectorStatusSchema,
  statusDetail: z.string().optional(),
  /** AgentOS' own switch. Independent of `status`: connected-but-off is a real state. */
  enabled: z.boolean(),
  /** Some connectors' switch lives with the AI stack and gates the same thing. */
  enabledSource: z.enum(["connectors", "ai-stack", "required"]),
  /** Public account handle (a login, an email address) from the last test. */
  account: z.string().optional(),
  capabilityCount: z.number().int().nonnegative(),
  implementedCount: z.number().int().nonnegative(),
  lastHealthCheck: ConnectorHealthSchema.optional(),
  lastUsed: z.string().optional(),
});

export const ConnectorDetailSchema = ConnectorSummarySchema.extend({
  capabilities: z.array(ConnectorCapabilitySchema),
  setup: z.array(ConnectorSetupItemSchema),
  /** How to connect or disconnect, in one or two sentences. */
  connectHint: z.string(),
  /** A same-origin URL that starts an OAuth connection, when there is one. */
  connectUrl: z.string().optional(),
  /** Whether AgentOS can disconnect it itself (OAuth grants it stores). */
  canDisconnect: z.boolean(),
  recentUses: z.array(ConnectorUseSchema),
});

export const ConnectorRecommendationSchema = z.object({
  connectorId: z.string(),
  connectorName: z.string(),
  icon: z.string(),
  status: ConnectorStatusSchema,
  /** The workspace this is for, when the reason is about one. */
  projectSlug: z.string().optional(),
  projectName: z.string().optional(),
  why: z.string(),
});

export const ConnectorsResponseSchema = z.object({
  generatedAt: z.string(),
  connectors: z.array(ConnectorSummarySchema),
  recommendations: z.array(ConnectorRecommendationSchema),
});

export const ConnectorPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Capability id → policy. `null` restores the default. */
    policies: z.record(z.string(), CapabilityPolicySchema.nullable()).optional(),
  })
  .strict();

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;
export type CapabilityRisk = z.infer<typeof CapabilityRiskSchema>;
export type CapabilityPolicy = z.infer<typeof CapabilityPolicySchema>;
export type ConnectorCategory = z.infer<typeof ConnectorCategorySchema>;
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;
export type ConnectorSetupItem = z.infer<typeof ConnectorSetupItemSchema>;
export type ConnectorUse = z.infer<typeof ConnectorUseSchema>;
export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;
export type ConnectorSummary = z.infer<typeof ConnectorSummarySchema>;
export type ConnectorDetail = z.infer<typeof ConnectorDetailSchema>;
export type ConnectorRecommendation = z.infer<typeof ConnectorRecommendationSchema>;
export type ConnectorsResponse = z.infer<typeof ConnectorsResponseSchema>;
export type ConnectorPatch = z.infer<typeof ConnectorPatchSchema>;

/** The policy a capability starts with, from its risk alone. A catalog entry may be stricter. */
export function defaultPolicyForRisk(risk: CapabilityRisk): CapabilityPolicy {
  if (risk === "destructive") return "disabled";
  if (risk === "external-communication") return "approval";
  return "allowed";
}

/** The connector a capability id belongs to: everything before the first dot. */
export function connectorIdOf(capabilityId: string): string {
  const dot = capabilityId.indexOf(".");
  return dot === -1 ? capabilityId : capabilityId.slice(0, dot);
}
