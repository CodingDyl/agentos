import { z } from "zod";
import { CapabilityPolicySchema } from "./connector-types";

/**
 * Composio: one key that reaches the apps AgentOS has no adapter of its own for.
 *
 * Composio holds the sign-ins (a person signs in on its hosted page), so nothing
 * here ever carries a token. An *app* is a Composio toolkit with at least one
 * account connected; its actions fall into three classes, each with a policy.
 */

export const ComposioSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/, "That isn't an app name.");

/** How much an action can change. Anything Composio doesn't mark as read-only counts as a change. */
export const ComposioActionClassSchema = z.enum(["read", "change", "delete"]);

export const ComposioToolkitSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  logo: z.string().optional(),
  toolsCount: z.number().int().nonnegative().optional(),
  /** Works without anyone signing in, so there is nothing to connect. */
  noAuth: z.boolean(),
});

export const ComposioToolkitPageSchema = z.object({
  items: z.array(ComposioToolkitSchema),
  nextCursor: z.string().optional(),
  total: z.number().int().nonnegative().optional(),
});

export const ComposioCategorySchema = z.object({ id: z.string(), name: z.string() });
export const ComposioCategoriesSchema = z.object({ categories: z.array(ComposioCategorySchema) });

export const ComposioAccountSchema = z.object({
  id: z.string(),
  /** The name the operator gave it, or Composio's own word for it. */
  label: z.string(),
  /** Only accounts that exist for real: an abandoned sign-in isn't listed. */
  status: z.enum(["ACTIVE", "EXPIRED", "INACTIVE"]),
  statusReason: z.string().optional(),
  createdAt: z.string().optional(),
});

const PoliciesSchema = z.object({
  read: CapabilityPolicySchema,
  change: CapabilityPolicySchema,
  delete: CapabilityPolicySchema,
});

export const ComposioAppSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  logo: z.string().optional(),
  accounts: z.array(ComposioAccountSchema),
  /** AgentOS' own switch for this app. Off keeps the sign-in but agents can't use it. */
  enabled: z.boolean(),
  policies: PoliciesSchema,
  /** The classes set for this app alone; the rest follow Connectors → Composio. */
  overridden: z.array(ComposioActionClassSchema),
});

export const ComposioAppsResponseSchema = z.object({
  /** COMPOSIO_API_KEY is set. */
  configured: z.boolean(),
  /** The Composio connector's switch. Off means AgentOS doesn't contact it. */
  enabled: z.boolean(),
  apps: z.array(ComposioAppSchema),
});

export const ComposioConnectRequestSchema = z
  .object({
    toolkit: ComposioSlugSchema,
    /** Tells two accounts of one app apart: "Work", "Personal". */
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export const ComposioConnectResponseSchema = z.object({ redirectUrl: z.string().url() });

export const ComposioAppPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** `null` goes back to following Connectors → Composio. */
    policies: z
      .object({
        read: CapabilityPolicySchema.nullable().optional(),
        change: CapabilityPolicySchema.nullable().optional(),
        delete: CapabilityPolicySchema.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ComposioActionClass = z.infer<typeof ComposioActionClassSchema>;
export type ComposioToolkit = z.infer<typeof ComposioToolkitSchema>;
export type ComposioToolkitPage = z.infer<typeof ComposioToolkitPageSchema>;
export type ComposioCategory = z.infer<typeof ComposioCategorySchema>;
export type ComposioAccount = z.infer<typeof ComposioAccountSchema>;
export type ComposioApp = z.infer<typeof ComposioAppSchema>;
export type ComposioAppsResponse = z.infer<typeof ComposioAppsResponseSchema>;
export type ComposioConnectRequest = z.infer<typeof ComposioConnectRequestSchema>;
export type ComposioAppPatch = z.infer<typeof ComposioAppPatchSchema>;
