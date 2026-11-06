import type { CapabilityPolicy } from "../../shared/connector-types";
import type {
  ComposioAccount,
  ComposioActionClass,
  ComposioApp,
  ComposioAppPatch,
  ComposioAppsResponse,
  ComposioToolkit,
} from "../../shared/composio-types";
import type { RunAppActionInput } from "../chat/confirmed-actions";
import { effectivePolicy, isConnectorEnabled } from "../connectors/policy";
import { recordUse, touch } from "../connectors/store";
import {
  ComposioError,
  ComposioUnavailableError,
  createConnectLink,
  deleteAccount,
  executeTool,
  getTool,
  getToolkit,
  isComposioConfigured,
  listAccounts,
  searchTools,
  type ComposioAccountWire,
  type ComposioToolWire,
} from "./client";
import { appSettings, updateAppSettings } from "./store";

/**
 * Composio apps as AgentOS sees them: which are connected, what an agent may
 * do in each, and running one action under those limits.
 *
 * AgentOS decides, not Composio. Each action is classed read, change or delete
 * from Composio's hints and its name, and when in doubt it is the stricter
 * class, so a tool with no hints is a change and asks. The default for each
 * class is its capability in Connectors → Composio; an app can override it.
 */

export class ComposioRequestError extends Error {}

/** Deletes, and things that can't be cleanly taken back. A verb in the name is enough. */
const DELETES = /(^|_)(DELETE|REMOVE|TRASH|PURGE|DESTROY|ERASE|WIPE|REVOKE)(_|$)/;
/** Moves money. Only asked of an action not marked read-only: LIST_PAYMENTS is a read. */
const MOVES_MONEY = /(^|_)(PAY|PAYMENT|PAYOUT|REFUND|CHARGE|TRANSFER)(_|$)/;
/** A read-only hint on a tool named like this is more likely wrong than the name. */
const WRITES = /(^|_)(SEND|CREATE|UPDATE|EDIT|POST|PUBLISH|REPLY|FORWARD|INVITE|ADD|SET|MOVE|MERGE|WRITE|UPLOAD|SHARE|EXECUTE|RUN)(_|$)/;

export function classifyTool(slug: string, tags: readonly string[] | null | undefined): ComposioActionClass {
  const hints = new Set(tags ?? []);
  if (hints.has("destructiveHint") || DELETES.test(slug)) return "delete";
  const markedRead = hints.has("readOnlyHint") && !hints.has("createHint") && !hints.has("updateHint");
  if (!markedRead && MOVES_MONEY.test(slug)) return "delete";
  return markedRead && !WRITES.test(slug) ? "read" : "change";
}

/** This app's own setting for a class, or the default from Connectors → Composio. */
export function appPolicy(slug: string, actionClass: ComposioActionClass): CapabilityPolicy {
  return appSettings(slug).policies?.[actionClass] ?? effectivePolicy(`composio.${actionClass}`) ?? "disabled";
}

const LISTED: ReadonlySet<string> = new Set(["ACTIVE", "EXPIRED", "INACTIVE"]);

function toAccount(wire: ComposioAccountWire): ComposioAccount | undefined {
  if (!LISTED.has(wire.status)) return undefined;
  return {
    id: wire.id,
    label: wire.alias || wire.word_id || wire.id,
    status: wire.status as ComposioAccount["status"],
    statusReason: wire.status_reason ?? undefined,
    createdAt: wire.created_at ?? undefined,
  };
}

/** Names and logos barely change, and the apps list is read every time the page gets focus. */
const TOOLKIT_TTL_MS = 60 * 60_000;
const toolkits = new Map<string, { value: ComposioToolkit; expires: number }>();

async function toolkitInfo(slug: string): Promise<ComposioToolkit> {
  const cached = toolkits.get(slug);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const value = await getToolkit(slug);
    toolkits.set(slug, { value, expires: Date.now() + TOOLKIT_TTL_MS });
    return value;
  } catch {
    // A missing logo is no reason to hide an account that exists.
    return { slug, name: slug, noAuth: false };
  }
}

function appFor(toolkit: ComposioToolkit, accounts: ComposioAccount[]): ComposioApp {
  const settings = appSettings(toolkit.slug);
  const classes: ComposioActionClass[] = ["read", "change", "delete"];
  return {
    slug: toolkit.slug,
    name: toolkit.name,
    description: toolkit.description,
    logo: toolkit.logo,
    accounts,
    enabled: settings.enabled !== false,
    policies: { read: appPolicy(toolkit.slug, "read"), change: appPolicy(toolkit.slug, "change"), delete: appPolicy(toolkit.slug, "delete") },
    overridden: classes.filter((actionClass) => settings.policies?.[actionClass] !== undefined),
  };
}

async function accountsByApp(): Promise<Map<string, ComposioAccount[]>> {
  const grouped = new Map<string, ComposioAccount[]>();
  for (const wire of await listAccounts()) {
    const account = toAccount(wire);
    if (!account) continue;
    grouped.set(wire.toolkit.slug, [...(grouped.get(wire.toolkit.slug) ?? []), account]);
  }
  return grouped;
}

/** Makes no request when Composio isn't set up or is switched off. */
export async function listApps(): Promise<ComposioAppsResponse> {
  const configured = isComposioConfigured();
  const enabled = isConnectorEnabled("composio");
  if (!configured || !enabled) return { configured, enabled, apps: [] };

  const grouped = await accountsByApp();
  const apps = await Promise.all([...grouped].map(async ([slug, accounts]) => appFor(await toolkitInfo(slug), accounts)));
  return { configured, enabled, apps: apps.sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function updateApp(slug: string, patch: ComposioAppPatch): Promise<ComposioAppsResponse> {
  updateAppSettings(slug, patch);
  return listApps();
}

export async function connectApp(toolkit: string, label?: string): Promise<string> {
  const url = await createConnectLink(toolkit, label);
  recordUse("composio", { capabilityId: "composio.connect", capabilityName: "Started connecting an app", at: new Date().toISOString(), detail: toolkit });
  return url;
}

/** Only an account filed under AgentOS, so a stale or guessed id can't reach anything else in the project. */
export async function disconnectAccount(id: string): Promise<ComposioAppsResponse> {
  const account = (await listAccounts()).find((entry) => entry.id === id);
  if (!account) throw new ComposioRequestError("That account isn't connected.");
  await deleteAccount(id);
  recordUse("composio", { capabilityId: "composio.disconnect", capabilityName: "Disconnected an account", at: new Date().toISOString(), detail: account.toolkit.slug });
  return listApps();
}

/** An action's inputs, cut down: full schemas run to pages and the agent only needs names and meanings. */
function compactInputs(schema: unknown): unknown {
  const value = (schema && typeof schema === "object" ? schema : {}) as { properties?: Record<string, { type?: unknown; description?: unknown }>; required?: unknown };
  return {
    required: Array.isArray(value.required) ? value.required : [],
    properties: Object.fromEntries(
      Object.entries(value.properties ?? {}).map(([name, property]) => [
        name,
        { type: property?.type, description: typeof property?.description === "string" ? property.description.slice(0, 200) : undefined },
      ]),
    ),
  };
}

function toAction(tool: ComposioToolWire) {
  const actionClass = classifyTool(tool.slug, tool.tags);
  return {
    action: tool.slug,
    app: tool.toolkit.slug,
    name: tool.name,
    description: (tool.human_description || tool.description || "").slice(0, 400),
    kind: actionClass,
    policy: appPolicy(tool.toolkit.slug, actionClass),
    inputs: compactInputs(tool.input_parameters),
  };
}

const ACTIONS_PER_APP = 6;
const APPS_SEARCHED = 12;

/** Searches the apps the operator has connected and left on, or one of them. */
export async function findActions(query: string, app?: string) {
  const grouped = await accountsByApp();
  const usable = [...grouped]
    .filter(([slug, accounts]) => appSettings(slug).enabled !== false && accounts.some((account) => account.status === "ACTIVE"))
    .map(([slug]) => slug);

  // An app with no sign-in has no account to find it by, so it can only be asked for by name.
  const reachable = app !== undefined && (usable.includes(app) || (appSettings(app).enabled !== false && (await toolkitInfo(app)).noAuth));
  if (app && !reachable) {
    return { actions: [], note: `${app} isn't connected, or is switched off. The operator can connect it in AgentOS → Connectors.` };
  }
  const apps = (app ? [app] : usable).slice(0, APPS_SEARCHED);
  if (apps.length === 0) return { actions: [], note: "No apps are connected through Composio yet. The operator can connect them in AgentOS → Connectors." };

  const results = await Promise.all(apps.map((slug) => searchTools({ query, toolkit: slug, limit: ACTIONS_PER_APP })));
  return { actions: results.flat().map(toAction) };
}

export type ActionPlan =
  | { kind: "refused"; reason: string }
  | { kind: "ready"; slug: string; app: string; actionClass: ComposioActionClass; policy: CapabilityPolicy; accountId?: string };

const refused = (reason: string): ActionPlan => ({ kind: "refused", reason });

/**
 * Whether this action may run, under what policy and from which account.
 * Does nothing itself. `policy` isn't `disabled` on a ready plan: anything but
 * `allowed` still needs the operator's OK.
 */
export async function planAppAction(input: RunAppActionInput): Promise<ActionPlan> {
  // COMPOSIO_* are Composio's own meta tools, including running code in its sandbox.
  if (input.action.startsWith("COMPOSIO_")) return refused("Composio's own tools can't be used from here. Use an app's action.");

  const tool = await getTool(input.action);
  if (!tool) return refused(`There is no action called ${input.action}. Use find_app_actions to find the right one.`);

  const app = tool.toolkit.slug;
  if (appSettings(app).enabled === false) return refused(`${app} is switched off in Connectors.`);

  const actionClass = classifyTool(tool.slug, tool.tags);
  const policy = appPolicy(app, actionClass);
  if (policy === "disabled") {
    const what = actionClass === "delete" ? "Deleting and moving money" : actionClass === "change" ? "Making changes" : "Reading";
    return refused(`${what} in ${app} is turned off in Connectors. The operator can change that; you can't.`);
  }

  if (tool.no_auth) return { kind: "ready", slug: tool.slug, app, actionClass, policy };

  const active = ((await accountsByApp()).get(app) ?? []).filter((account) => account.status === "ACTIVE");
  if (active.length === 0) return refused(`${app} isn't connected, or its sign-in has expired. The operator can sign in from AgentOS → Connectors.`);

  if (input.account) {
    if (!active.some((account) => account.id === input.account)) return refused(`${input.account} isn't a connected ${app} account. Use list_connected_apps to see them.`);
    return { kind: "ready", slug: tool.slug, app, actionClass, policy, accountId: input.account };
  }
  // Acting from the wrong one of two accounts is the mistake this exists to stop.
  if (active.length > 1) {
    const choices = active.map((account) => `${account.label} (${account.id})`).join(", ");
    return refused(`${app} has more than one account connected: ${choices}. Ask the operator which, and pass its id as account.`);
  }
  return { kind: "ready", slug: tool.slug, app, actionClass, policy, accountId: active[0].id };
}

/**
 * Whether to put this call to the operator before it starts. Anything that
 * will be refused anyway, or can't be checked, runs on to the tool, which plans
 * again and says why: the tool is what enforces this, not this question.
 */
export async function appActionNeedsOk(input: RunAppActionInput): Promise<boolean> {
  try {
    const plan = await planAppAction(input);
    return plan.kind === "ready" && plan.policy !== "allowed";
  } catch {
    return false;
  }
}

const CLASS_LABEL: Record<ComposioActionClass, string> = { read: "Read from an app", change: "Changed something in an app", delete: "Deleted or paid in an app" };

/** Runs a ready plan. The caller has already checked for the operator's OK when the policy needs one. */
export async function runPlannedAction(plan: Extract<ActionPlan, { kind: "ready" }>, args: Record<string, unknown>): Promise<unknown> {
  const now = new Date();
  try {
    if (plan.actionClass === "read") touch("composio", now);
    else recordUse("composio", { capabilityId: `composio.${plan.actionClass}`, capabilityName: CLASS_LABEL[plan.actionClass], at: now.toISOString(), detail: plan.slug });
  } catch (error) {
    // Bookkeeping never blocks the action it describes.
    console.error("[agentos] composio use could not be recorded:", error);
  }
  return executeTool({ slug: plan.slug, arguments: args, connectedAccountId: plan.accountId });
}

/** The connection test: one read of the account list, which is what the whole connector relies on. */
export async function testComposio(): Promise<{ ok: boolean; detail: string }> {
  const grouped = await accountsByApp();
  const apps = grouped.size;
  return { ok: true, detail: `Composio accepted the key. ${apps} ${apps === 1 ? "app" : "apps"} connected.` };
}

export { ComposioError, ComposioUnavailableError };
