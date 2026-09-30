import type {
  CapabilityPolicy,
  CredentialResult,
  CredentialStep,
  ConnectorCapability,
  ConnectorDetail,
  ConnectorsResponse,
  ConnectorStatus,
  ConnectorSummary,
} from "../../shared/connector-types";
import { getProjects, isLiveState } from "../agentos/projects";
import { readTasks } from "../agentos/mutations/tasks";
import { readProjectSource } from "../agentos/mutations/status";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { readProjectSeo } from "../seo/store";
import { capabilityId, CONNECTORS, defaultPolicy, findConnector, type CatalogConnector } from "./catalog";
import { effectivePolicy, isConnectorEnabled, setConnectorEnabled } from "./policy";
import { env, PROBES, UNAVAILABLE_HINTS, type LocalProbe } from "./probes";
import { valueProblem, writeEnvValues, EnvWriteError } from "./env-file";
import { forgetInvestecToken } from "../finance/investec";
import { resetAccessTokenCache } from "../mail/gmail-auth";
import { resetOutreachTokenCache } from "../outreach/auth";
import { recommendConnectors, type ProjectSignals } from "./recommendations";
import { clearHealth, lastUsed, recordUse, saveHealth, setStoredPolicies, storedHealth, storedPolicy, usesFor } from "./store";

/**
 * The capability registry: catalog + what this machine has + what the
 * operator decided, assembled into what the Connectors page and the
 * orchestrator read.
 */

export class ConnectorNotFoundError extends Error {}
export class ConnectorRequestError extends Error {}

async function probeLocal(connector: CatalogConnector): Promise<LocalProbe | undefined> {
  const probe = PROBES[connector.id];
  if (!probe) return undefined;
  try {
    return await probe.local();
  } catch (error) {
    return {
      configured: false,
      detail: error instanceof Error ? error.message : "Could not check.",
      setup: [],
      connectHint: "",
    };
  }
}

/**
 * Connected, disconnected, error or unavailable.
 *
 * A failed test only counts while it is the latest word: set up + last test
 * failed is `error`; set up + passed or never tested is `connected`.
 */
export function deriveConnectorStatus(input: {
  integrated: boolean;
  configured: boolean;
  lastTestOk?: boolean;
}): ConnectorStatus {
  if (!input.integrated) return "unavailable";
  if (!input.configured) return "disconnected";
  if (input.lastTestOk === false) return "error";
  return "connected";
}

function capabilitiesFor(connector: CatalogConnector, status: ConnectorStatus, local: LocalProbe | undefined): ConnectorCapability[] {
  return connector.capabilities.map((capability) => {
    const id = capabilityId(connector, capability);
    const implemented = capability.implementedBy !== undefined;
    const grantProblem = local?.missingGrants?.[capability.action];

    let unavailableReason: string | undefined;
    if (!implemented) unavailableReason = "AgentOS has no code for this yet.";
    else if (status === "unavailable") unavailableReason = "AgentOS has no adapter for this service yet.";
    else if (status === "disconnected") unavailableReason = local?.detail ?? "Not connected.";
    else if (grantProblem) unavailableReason = grantProblem;

    const policy: CapabilityPolicy = effectivePolicy(id) ?? defaultPolicy(capability);
    return {
      id,
      name: capability.name,
      risk: capability.risk,
      policy,
      defaultPolicy: defaultPolicy(capability),
      policyOverridden: storedPolicy(id) !== undefined,
      implemented,
      available: unavailableReason === undefined,
      unavailableReason,
    };
  });
}

interface Assembled {
  summary: ConnectorSummary;
  capabilities: ConnectorCapability[];
  local: LocalProbe | undefined;
}

async function assemble(connector: CatalogConnector): Promise<Assembled> {
  const local = connector.integrated ? await probeLocal(connector) : undefined;
  const health = storedHealth(connector.id);
  const configured = local?.configured ?? false;
  const status = deriveConnectorStatus({ integrated: connector.integrated, configured, lastTestOk: configured ? health?.ok : undefined });
  const capabilities = capabilitiesFor(connector, status, local);

  const statusDetail =
    status === "unavailable"
      ? "No adapter yet"
      : status === "disconnected"
        ? local?.detail
        : status === "error"
          ? health?.detail
          : undefined;

  return {
    local,
    capabilities,
    summary: {
      id: connector.id,
      name: connector.name,
      description: connector.description,
      category: connector.category,
      tier: connector.tier,
      icon: connector.icon,
      status,
      statusDetail,
      enabled: isConnectorEnabled(connector.id),
      enabledSource: connector.required ? "required" : connector.aiStackSwitch ? "ai-stack" : connector.voiceSwitch ? "voice" : "connectors",
      account: configured ? health?.account : undefined,
      capabilityCount: capabilities.length,
      implementedCount: capabilities.filter((capability) => capability.implemented).length,
      lastHealthCheck: health ? { ok: health.ok, checkedAt: health.checkedAt, detail: health.detail } : undefined,
      lastUsed: lastUsed(connector.id),
    },
  };
}

/** Open task titles, SEO history and Vercel links for the live workspaces. Local files only. */
async function projectSignals(): Promise<ProjectSignals[]> {
  const projects = await getProjects("live").catch(() => []);

  return Promise.all(
    projects
      .filter((project) => isLiveState(project.state))
      .map(async (project): Promise<ProjectSignals> => {
        const [tasks, source] = await Promise.all([
          readTasks(project.slug).catch(() => undefined),
          readProjectSource(project.slug, "PROJECT.md").catch(() => undefined),
        ]);
        let seoAuditCount = 0;
        try {
          const seo = readProjectSeo(project.slug);
          seoAuditCount = (seo.latest ? 1 : 0) + seo.history.length;
        } catch {
          // No SEO store yet: no audits.
        }

        return {
          slug: project.slug,
          name: project.name,
          workspaceType: project.workspaceType,
          openTasks: (tasks?.tasks ?? []).filter((task) => !task.completed).map((task) => task.title),
          seoAuditCount,
          hasVercelProject: Boolean(parseConfiguration(source?.contents).vercelProjectId),
        };
      }),
  );
}

export async function listConnectors(): Promise<ConnectorsResponse> {
  const [assembled, signals] = await Promise.all([Promise.all(CONNECTORS.map(assemble)), projectSignals()]);
  const connectors = assembled.map((entry) => entry.summary);

  return {
    generatedAt: new Date().toISOString(),
    connectors,
    recommendations: recommendConnectors(signals, connectors),
  };
}

export async function getConnector(id: string): Promise<ConnectorDetail> {
  const connector = findConnector(id);
  if (!connector) throw new ConnectorNotFoundError(`There is no connector called ${id}.`);

  const { summary, capabilities, local } = await assemble(connector);
  const unavailable = UNAVAILABLE_HINTS[connector.id];

  return {
    ...summary,
    capabilities,
    setup: local?.setup ?? (unavailable?.setup ?? []).map((name) => env(name)),
    connectHint: local?.connectHint ?? unavailable?.hint ?? "AgentOS has no adapter for this service yet.",
    connectUrl: local?.connectUrl,
    canDisconnect: Boolean(local?.canDisconnect && PROBES[connector.id]?.disconnect),
    recentUses: usesFor(connector.id),
  };
}

export async function updateConnector(
  id: string,
  patch: { enabled?: boolean; policies?: Record<string, CapabilityPolicy | null> },
): Promise<ConnectorDetail> {
  const connector = findConnector(id);
  if (!connector) throw new ConnectorNotFoundError(`There is no connector called ${id}.`);

  if (patch.policies) {
    const known = new Set(connector.capabilities.map((capability) => capabilityId(connector, capability)));
    const unknown = Object.keys(patch.policies).filter((capability) => !known.has(capability));
    if (unknown.length > 0) throw new ConnectorRequestError(`${unknown.join(", ")} ${unknown.length === 1 ? "is not a capability" : "are not capabilities"} of ${connector.name}.`);
  }
  if (patch.enabled !== undefined && connector.required) {
    throw new ConnectorRequestError(`${connector.name} can't be switched off: AgentOS runs on it.`);
  }
  if (patch.enabled !== undefined && !connector.integrated) {
    throw new ConnectorRequestError(`${connector.name} has no adapter yet, so there is nothing to switch.`);
  }

  if (patch.enabled !== undefined) setConnectorEnabled(id, patch.enabled);
  if (patch.policies) setStoredPolicies(patch.policies);

  return getConnector(id);
}

/** One real, read-only request. Refused while the connector is off: off means AgentOS doesn't contact it. */
export async function testConnector(id: string): Promise<ConnectorDetail> {
  const connector = findConnector(id);
  if (!connector) throw new ConnectorNotFoundError(`There is no connector called ${id}.`);

  const probe = PROBES[id];
  if (!probe) throw new ConnectorRequestError(`${connector.name} has no adapter yet, so there is nothing to test.`);
  if (!isConnectorEnabled(id)) throw new ConnectorRequestError(`${connector.name} is switched off. Turn it on to test it.`);

  const local = await probeLocal(connector);
  if (!local?.configured) {
    throw new ConnectorRequestError(local?.detail ?? `${connector.name} isn't set up on this machine yet.`);
  }

  const result = await probe.test().catch((error: unknown) => ({
    ok: false,
    detail: error instanceof Error ? error.message : "The test failed.",
    account: undefined,
  }));

  saveHealth(id, {
    ok: result.ok,
    checkedAt: new Date().toISOString(),
    detail: result.detail.slice(0, 300),
    account: result.account,
  });

  return getConnector(id);
}

export async function disconnectConnector(id: string): Promise<ConnectorDetail> {
  const connector = findConnector(id);
  if (!connector) throw new ConnectorNotFoundError(`There is no connector called ${id}.`);

  const probe = PROBES[id];
  if (!probe?.disconnect) {
    throw new ConnectorRequestError(`${connector.name} is connected through .env. Remove its variables and restart the data adapter to disconnect it.`);
  }

  await probe.disconnect();
  clearHealth(id);
  return getConnector(id);
}

/**
 * "Save & connect": the whole task the Setup form starts when Enter is pressed.
 *
 * 1. Only names on this connector's own setup list are accepted.
 * 2. The values are written into `.env` (see `env-file.ts`).
 * 3. They're applied to this running process, so nothing needs a restart,
 *    and any cached token that belonged to the old values is dropped.
 * 4. The connector is switched on for AgentOS.
 * 5. If that completes its setup, its connection test runs.
 *
 * Each step is reported. No value is ever returned, logged or recorded; the
 * connector's history notes which *names* changed.
 */
export async function saveCredentials(id: string, submitted: Record<string, string>): Promise<CredentialResult> {
  const connector = findConnector(id);
  if (!connector) throw new ConnectorNotFoundError(`There is no connector called ${id}.`);

  const allowed = new Set(
    (await getConnector(id)).setup.flatMap((item) => (item.envName ? [item.envName] : [])),
  );
  const unknown = Object.keys(submitted).filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new ConnectorRequestError(`${unknown.join(", ")} ${unknown.length === 1 ? "isn't a setting" : "aren't settings"} of ${connector.name}.`);
  }

  // Blank means "leave it as it is": the form never shows a saved key, so an
  // empty password field must not wipe one.
  const values = Object.fromEntries(
    Object.entries(submitted)
      .map(([name, value]) => [name, value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
  const names = Object.keys(values);
  if (names.length === 0) throw new ConnectorRequestError("Nothing to save: every field was blank.");

  const steps: CredentialStep[] = [];
  const finish = async (): Promise<CredentialResult> => ({
    ok: steps.every((step) => step.ok),
    steps,
    connector: await getConnector(id),
  });

  const problems = names.flatMap((name) => valueProblem(name, values[name]) ?? []);
  if (problems.length > 0) {
    steps.push({ label: "Check the values", ok: false, detail: problems.join(" ") });
    return finish();
  }

  try {
    writeEnvValues(values);
    steps.push({ label: "Save to .env", ok: true, detail: names.join(", ") });
  } catch (error) {
    steps.push({ label: "Save to .env", ok: false, detail: error instanceof EnvWriteError ? error.message : ".env could not be written." });
    return finish();
  }

  for (const name of names) process.env[name] = values[name];
  forgetInvestecToken();
  resetAccessTokenCache();
  resetOutreachTokenCache();
  steps.push({ label: "Apply without a restart", ok: true });

  recordUse(id, {
    capabilityId: `${id}.settings`,
    capabilityName: "Settings updated",
    at: new Date().toISOString(),
    detail: names.join(", "),
  });

  if (!connector.integrated) {
    steps.push({ label: "Activate", ok: true, detail: "Saved. AgentOS has no adapter for this yet, so it will be used once one exists." });
    return finish();
  }

  if (!connector.required && !isConnectorEnabled(id)) {
    setConnectorEnabled(id, true);
    steps.push({ label: "Switch on for AgentOS", ok: true });
  }

  const local = await probeLocal(connector);
  if (!local?.configured) {
    steps.push({
      label: "Finish setup",
      ok: false,
      detail: local?.connectUrl ? `${local.detail ?? "Not connected yet."} Sign in to finish.` : (local?.detail ?? "Something is still missing."),
    });
    return finish();
  }

  try {
    const tested = await testConnector(id);
    const health = tested.lastHealthCheck;
    steps.push({ label: "Test the connection", ok: Boolean(health?.ok), detail: health?.detail });
  } catch (error) {
    steps.push({ label: "Test the connection", ok: false, detail: error instanceof Error ? error.message : "The test failed." });
  }

  return finish();
}
