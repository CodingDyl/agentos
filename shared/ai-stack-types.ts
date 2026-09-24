import { z } from "zod";

/**
 * The AI stack: every AI this machine has, and which of them AgentOS uses.
 *
 * Two different questions, kept apart on purpose. *Detected* is a fact about
 * the machine — a CLI on the PATH, an app in /Applications, a key name in
 * `.env`, a local server answering. *Live* is a fact about AgentOS — whether it
 * is wired to the thing, allowed to use it, and able to reach it right now.
 * Plenty of AIs are the first without the second, and the screen says so
 * rather than implying AgentOS can use a tool it has no integration for.
 */

export const AiKindSchema = z.enum([
  "orchestrator",
  "worker",
  "classifier",
  "coding-tool",
  "chat-app",
  "local-runtime",
]);

/**
 * - `live`: integrated, switched on, and healthy.
 * - `off`: integrated, but the operator switched it off.
 * - `unavailable`: integrated and switched on, but it cannot be used right now.
 * - `not-integrated`: found on the machine; AgentOS has no way to use it.
 */
export const AiStatusSchema = z.enum(["live", "off", "unavailable", "not-integrated"]);

export const AiEvidenceSchema = z.object({
  kind: z.enum(["cli", "app", "config", "env-key", "server"]),
  label: z.string(),
  /** A path or URL. Never a secret — env keys are reported by name only. */
  detail: z.string().optional(),
});

/**
 * Usage read from a tool's own local logs, for AIs AgentOS does not run.
 *
 * Tokens only. There is deliberately no cost here: turning tokens into dollars
 * needs a price per model, and a guessed price shown next to real ledger costs
 * would make the real ones harder to trust.
 */
export const AiLocalUsageSchema = z.object({
  source: z.string(),
  input: z.number(),
  output: z.number(),
  cachedInput: z.number(),
  total: z.number(),
  sessions: z.number(),
  byModel: z.array(z.object({ model: z.string(), total: z.number() })),
});

export const AiStackEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  kind: AiKindSchema,
  /** What AgentOS uses it for, when it uses it at all. */
  integration: z.string().optional(),
  /** Only integrated AIs have a switch — there is nothing to switch off for the rest. */
  toggleable: z.boolean(),
  enabled: z.boolean(),
  status: AiStatusSchema,
  statusReason: z.string().optional(),
  detected: z.boolean(),
  evidence: z.array(AiEvidenceSchema),
  /** Key into the usage ledger's per-agent breakdown, for AIs AgentOS runs. */
  ledgerAgent: z.string().optional(),
  /** Matched against a subscription's `provider`, to show what the plan costs. */
  provider: z.string().optional(),
  localUsage: AiLocalUsageSchema.optional(),
});

export const AiStackSchema = z.object({
  generatedAt: z.string(),
  /** What the usage figures cover, e.g. "September 2026". */
  windowLabel: z.string(),
  entries: z.array(AiStackEntrySchema),
});

export const SetAiEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export type AiKind = z.infer<typeof AiKindSchema>;
export type AiStatus = z.infer<typeof AiStatusSchema>;
export type AiEvidence = z.infer<typeof AiEvidenceSchema>;
export type AiLocalUsage = z.infer<typeof AiLocalUsageSchema>;
export type AiStackEntry = z.infer<typeof AiStackEntrySchema>;
export type AiStack = z.infer<typeof AiStackSchema>;
