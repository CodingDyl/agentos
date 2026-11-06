import { z } from "zod";
import type { ComposioCategory, ComposioToolkit, ComposioToolkitPage } from "../../shared/composio-types";
import { connectorOffReason, isConnectorEnabled } from "../connectors/policy";
import { COMPOSIO_KEY_ENV } from "./key";

/**
 * Composio's REST API (v3.1), with `fetch` and nothing else.
 *
 * Every call goes through `call`, which refuses while the connector is off or
 * has no key: off means AgentOS doesn't contact it. Composio's own words come
 * back as errors; the key goes in one header and never appears in a message.
 *
 * Its SDK isn't used because only these few routes are needed, and its MCP
 * endpoint isn't given to agents because that would run actions without
 * passing AgentOS's policy (see service.ts).
 */

const DEFAULT_BASE = "https://backend.composio.dev/api/v3.1";
const TIMEOUT_MS = 30_000;
/** An action can be slow (a large search, an upload), and a retry could do it twice. */
const EXECUTE_TIMEOUT_MS = 120_000;

/** Connected accounts are filed under a user. AgentOS has one, so this never changes. */
export const COMPOSIO_USER_ID = "agentos-owner";

/** Composio can't be used right now, for a reason the operator can fix here. */
export class ComposioUnavailableError extends Error {}
/** Composio refused or failed, in its own words. */
export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isComposioConfigured(): boolean {
  return Boolean(process.env[COMPOSIO_KEY_ENV]?.trim());
}

function baseUrl(): string {
  return (process.env.COMPOSIO_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

const ErrorBodySchema = z.object({
  error: z.object({ message: z.string().optional(), suggested_fix: z.string().nullish() }).optional(),
});

function errorMessage(status: number, text: string): string {
  if (status === 401 || status === 403) return "Composio refused the API key. Check it in Connectors → Composio.";
  try {
    const { error } = ErrorBodySchema.parse(JSON.parse(text));
    if (error?.message) return error.suggested_fix ? `${error.message} ${error.suggested_fix}` : error.message;
  } catch {
    // Not the JSON it normally sends.
  }
  return `Composio answered ${status}.`;
}

type Query = Record<string, string | number | boolean | readonly string[] | undefined>;

async function call<T>(
  schema: z.ZodType<T>,
  route: string,
  init: { method?: string; query?: Query; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  if (!isConnectorEnabled("composio")) throw new ComposioUnavailableError(connectorOffReason("Composio"));
  const key = process.env[COMPOSIO_KEY_ENV]?.trim();
  if (!key) throw new ComposioUnavailableError(`${COMPOSIO_KEY_ENV} is not set. Add it in Connectors → Composio.`);

  const url = new URL(`${baseUrl()}${route}`);
  for (const [name, value] of Object.entries(init.query ?? {})) {
    if (value === undefined) continue;
    if (typeof value === "object") for (const entry of value) url.searchParams.append(name, entry);
    else url.searchParams.set(name, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: { "x-api-key": key, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    throw new ComposioError("Composio couldn't be reached. Check the connection and try again.");
  }

  const text = await response.text();
  if (!response.ok) throw new ComposioError(errorMessage(response.status, text), response.status);

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new ComposioError("Composio sent back something that wasn't JSON.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new ComposioError("Composio answered in an unexpected shape.");
  return result.data;
}

const ToolkitWireSchema = z.object({
  slug: z.string(),
  name: z.string(),
  no_auth: z.boolean().nullish(),
  meta: z
    .object({
      description: z.string().nullish(),
      logo: z.string().nullish(),
      tools_count: z.number().nullish(),
    })
    .nullish(),
});

function toToolkit(wire: z.infer<typeof ToolkitWireSchema>): ComposioToolkit {
  const logo = wire.meta?.logo ?? undefined;
  return {
    slug: wire.slug,
    name: wire.name,
    description: wire.meta?.description ?? undefined,
    // A logo is put straight into an <img>, so only a real web address gets through.
    logo: logo?.startsWith("https://") ? logo : undefined,
    toolsCount: wire.meta?.tools_count ?? undefined,
    noAuth: wire.no_auth === true,
  };
}

const ToolkitPageWireSchema = z.object({
  items: z.array(ToolkitWireSchema),
  next_cursor: z.string().nullish(),
  total_items: z.number().nullish(),
});

export async function listToolkits(input: { search?: string; category?: string; cursor?: string; limit?: number }): Promise<ComposioToolkitPage> {
  const page = await call(ToolkitPageWireSchema, "/toolkits", {
    query: { search: input.search || undefined, category: input.category || undefined, cursor: input.cursor, limit: input.limit ?? 24, sort_by: "usage" },
  });
  return { items: page.items.map(toToolkit), nextCursor: page.next_cursor ?? undefined, total: page.total_items ?? undefined };
}

export async function getToolkit(slug: string): Promise<ComposioToolkit> {
  return toToolkit(await call(ToolkitWireSchema, `/toolkits/${encodeURIComponent(slug)}`));
}

export async function listCategories(): Promise<ComposioCategory[]> {
  const page = await call(z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) }), "/toolkits/categories");
  return page.items;
}

const AccountWireSchema = z.object({
  id: z.string(),
  alias: z.string().nullish(),
  word_id: z.string().nullish(),
  status: z.string(),
  status_reason: z.string().nullish(),
  is_disabled: z.boolean().nullish(),
  created_at: z.string().nullish(),
  toolkit: z.object({ slug: z.string() }),
});

export type ComposioAccountWire = z.infer<typeof AccountWireSchema>;

/** A personal tool has a handful of these; the page cap only stops a runaway loop. */
const MAX_ACCOUNT_PAGES = 5;

export async function listAccounts(): Promise<ComposioAccountWire[]> {
  const accounts: ComposioAccountWire[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
    const result = await call(z.object({ items: z.array(AccountWireSchema), next_cursor: z.string().nullish() }), "/connected_accounts", {
      query: { user_ids: [COMPOSIO_USER_ID], limit: 100, cursor },
    });
    accounts.push(...result.items);
    cursor = result.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return accounts;
}

export async function deleteAccount(id: string): Promise<void> {
  await call(z.unknown(), `/connected_accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Sign-ins are started from a session, which is what picks Composio's own app
 * for a toolkit without AgentOS creating one. One is kept for the life of this
 * process, and replaced if Composio no longer knows it.
 */
let linkSession: string | undefined;

async function newLinkSession(): Promise<string> {
  const session = await call(z.object({ session_id: z.string() }), "/tool_router/session", {
    method: "POST",
    body: {
      user_id: COMPOSIO_USER_ID,
      // Several accounts per app (work and personal), and no remote code sandbox.
      multi_account: { enable: true, max_accounts_per_toolkit: 10 },
      workbench: { enable: false },
    },
  });
  return session.session_id;
}

/** The hosted sign-in page for one app. Tokens stay on Composio's side and never pass through AgentOS. */
export async function createConnectLink(toolkit: string, label?: string): Promise<string> {
  linkSession ??= await newLinkSession();
  const request = (session: string) =>
    call(z.object({ redirect_url: z.string().url() }), `/tool_router/session/${encodeURIComponent(session)}/link`, {
      method: "POST",
      body: { toolkit, ...(label ? { alias: label } : {}) },
    });
  try {
    return (await request(linkSession)).redirect_url;
  } catch (error) {
    if (!(error instanceof ComposioError) || error.status !== 404) throw error;
    linkSession = await newLinkSession();
    return (await request(linkSession)).redirect_url;
  }
}

const ToolWireSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  human_description: z.string().nullish(),
  toolkit: z.object({ slug: z.string() }),
  tags: z.array(z.string()).nullish(),
  no_auth: z.boolean().nullish(),
  input_parameters: z.unknown().optional(),
});

export type ComposioToolWire = z.infer<typeof ToolWireSchema>;

export async function searchTools(input: { query: string; toolkit: string; limit: number }): Promise<ComposioToolWire[]> {
  const page = await call(z.object({ items: z.array(ToolWireSchema) }), "/tools", {
    query: { query: input.query, toolkit_slug: input.toolkit, limit: input.limit },
  });
  return page.items;
}

/** One action's definition, or undefined when there is no such action. */
export async function getTool(slug: string): Promise<ComposioToolWire | undefined> {
  try {
    return await call(ToolWireSchema, `/tools/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ComposioError && error.status === 404) return undefined;
    throw error;
  }
}

export async function executeTool(input: { slug: string; arguments: Record<string, unknown>; connectedAccountId?: string }): Promise<unknown> {
  const result = await call(
    z.object({ successful: z.boolean(), data: z.unknown().optional(), error: z.string().nullish() }),
    `/tools/execute/${encodeURIComponent(input.slug)}`,
    {
      method: "POST",
      timeoutMs: EXECUTE_TIMEOUT_MS,
      body: {
        user_id: COMPOSIO_USER_ID,
        arguments: input.arguments,
        ...(input.connectedAccountId ? { connected_account_id: input.connectedAccountId } : {}),
      },
    },
  );
  if (!result.successful) throw new ComposioError(result.error || "The app refused the action.");
  return result.data;
}

/** For tests. */
export function resetComposioClient(): void {
  linkSession = undefined;
}
