import type { AiEvidence, AiKind, AiLocalUsage, AiStack, AiStackEntry, AiStatus } from "../../shared/ai-stack-types";
import { getHermesStatus } from "../hermes/client";
import { isJevConfigured } from "../mail/jev-client";
import { claudeWorker } from "../workers/providers/claude-worker";
import { grokWorker } from "../workers/providers/grok-worker";
import { envKeySet, findApp, findConfig, findOnPath, serverAnswers } from "./detect";
import { readClaudeCodeUsage, readCodexUsage } from "./local-usage";
import { isAiEnabled, switchedOffReason } from "./settings";

interface Health {
  available: boolean;
  reason?: string;
}

/**
 * One AI AgentOS knows how to look for.
 *
 * `health` is what makes an entry *integrated*: only AIs AgentOS actually
 * calls have one, and only those get a switch. The ids of integrated entries
 * are the ids the switch is enforced by — `claude` and `grok` are worker ids,
 * `hermes` gates every Hermes request, `jev` gates mail classification.
 */
interface CatalogEntry {
  id: string;
  name: string;
  vendor: string;
  kind: AiKind;
  integration?: string;
  ledgerAgent?: string;
  provider?: string;
  clis?: string[];
  apps?: string[];
  configs?: string[];
  envKeys?: string[];
  servers?: { label: string; url: string }[];
  health?: () => Promise<Health>;
  localUsage?: (since: number) => Promise<AiLocalUsage | undefined>;
}

const CATALOG: readonly CatalogEntry[] = [
  {
    id: "claude",
    name: "Claude",
    vendor: "Anthropic",
    kind: "worker",
    integration: "Runs coding jobs as a worker, through the Agent SDK.",
    ledgerAgent: "claude",
    provider: "anthropic",
    clis: ["claude"],
    apps: ["Claude"],
    configs: [".claude"],
    envKeys: ["ANTHROPIC_API_KEY"],
    // The raw worker, not the registered one: the registered copy reports
    // "switched off", and this needs to know whether it would work if it were on.
    health: () => claudeWorker.healthCheck(),
    localUsage: readClaudeCodeUsage,
  },
  {
    id: "grok",
    name: "Grok",
    vendor: "xAI",
    kind: "worker",
    integration: "Runs coding jobs as a worker.",
    ledgerAgent: "grok",
    provider: "xai",
    clis: ["grok"],
    configs: [".grok"],
    envKeys: ["XAI_API_KEY"],
    health: () => grokWorker.healthCheck(),
  },
  {
    id: "hermes",
    name: "Hermes",
    vendor: "Local agent",
    kind: "orchestrator",
    integration: "Scopes tasks, plans milestones, routes jobs and reviews worker output.",
    ledgerAgent: "hermes",
    clis: ["hermes"],
    configs: [".hermes"],
    envKeys: ["HERMES_API_KEY"],
    health: async () =>
      getHermesStatus().configured
        ? { available: true }
        : { available: false, reason: "HERMES_API_KEY is not set." },
  },
  {
    id: "jev",
    name: "Jev",
    vendor: "TypeSafe",
    kind: "classifier",
    integration: "Classifies mail threads into Needs you, FYI and Low priority.",
    envKeys: ["JEV_API_KEY"],
    health: async () =>
      isJevConfigured() ? { available: true } : { available: false, reason: "JEV_API_KEY is not set." },
  },
  {
    id: "openai",
    name: "ChatGPT & Codex",
    vendor: "OpenAI",
    kind: "coding-tool",
    provider: "openai",
    clis: ["codex"],
    apps: ["ChatGPT", "Codex"],
    configs: [".codex"],
    envKeys: ["OPENAI_API_KEY"],
    localUsage: readCodexUsage,
  },
  {
    id: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    kind: "coding-tool",
    provider: "cursor",
    clis: ["cursor-agent"],
    apps: ["Cursor"],
    configs: [".cursor"],
  },
  {
    id: "gemini",
    name: "Gemini & Antigravity",
    vendor: "Google",
    kind: "coding-tool",
    provider: "google",
    clis: ["gemini"],
    apps: ["Antigravity"],
    configs: [".gemini"],
    envKeys: ["GEMINI_API_KEY"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    vendor: "Windsurf",
    kind: "coding-tool",
    apps: ["Windsurf"],
    configs: [".codeium/windsurf"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    vendor: "Perplexity",
    kind: "chat-app",
    apps: ["Perplexity"],
  },
  {
    id: "ollama",
    name: "Ollama",
    vendor: "Ollama",
    kind: "local-runtime",
    clis: ["ollama"],
    apps: ["Ollama"],
    configs: [".ollama"],
    servers: [{ label: "Ollama server", url: "http://127.0.0.1:11434/api/tags" }],
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    vendor: "LM Studio",
    kind: "local-runtime",
    clis: ["lms"],
    apps: ["LM Studio"],
    configs: [".lmstudio"],
    servers: [{ label: "LM Studio server", url: "http://127.0.0.1:1234/v1/models" }],
  },
];

/** Every AI id that has a switch. Anything else is refused by `PUT /api/ai-stack/:id`. */
export function isToggleable(id: string): boolean {
  return CATALOG.some((entry) => entry.id === id && entry.health !== undefined);
}

/**
 * Live, off, unavailable, or not integrated.
 *
 * The switch is checked before health on purpose: an AI the operator turned
 * off is "off" even while its key is missing, because that is the decision
 * that was actually made about it.
 */
export function deriveStatus(input: { integrated: boolean; enabled: boolean; name: string; health?: Health }): {
  status: AiStatus;
  reason?: string;
} {
  if (!input.integrated) return { status: "not-integrated" };
  if (!input.enabled) return { status: "off", reason: switchedOffReason(input.name) };
  if (!input.health?.available) {
    return { status: "unavailable", reason: input.health?.reason ?? `${input.name} is not available.` };
  }
  return { status: "live", reason: input.health.reason };
}

async function gatherEvidence(entry: CatalogEntry): Promise<AiEvidence[]> {
  const checks: Promise<AiEvidence | undefined>[] = [
    ...(entry.clis ?? []).map(async (binary) => {
      const found = await findOnPath(binary);
      return found ? { kind: "cli" as const, label: `${binary} CLI`, detail: found } : undefined;
    }),
    ...(entry.apps ?? []).map(async (app) => {
      const found = await findApp(app);
      return found ? { kind: "app" as const, label: `${app} app`, detail: found } : undefined;
    }),
    ...(entry.configs ?? []).map(async (relative) => {
      const found = await findConfig(relative);
      return found ? { kind: "config" as const, label: "Config", detail: found } : undefined;
    }),
    ...(entry.envKeys ?? []).map(async (key) =>
      envKeySet(key) ? { kind: "env-key" as const, label: key, detail: "Set in .env" } : undefined,
    ),
    ...(entry.servers ?? []).map(async (server) =>
      (await serverAnswers(server.url)) ? { kind: "server" as const, label: server.label, detail: server.url } : undefined,
    ),
  ];

  return (await Promise.all(checks)).filter((evidence): evidence is AiEvidence => evidence !== undefined);
}

/** Start of the current calendar month, local time — the same window the Operations screen reports. */
export function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * The whole stack, for the AI Stack tab.
 *
 * Integrated AIs are always listed, found or not — they are part of AgentOS
 * whether or not this machine has them set up. Everything else is listed only
 * when something on the machine says it is there.
 */
export async function readAiStack(now = new Date()): Promise<AiStack> {
  const since = monthStart(now);

  const entries = await Promise.all(
    CATALOG.map(async (entry): Promise<AiStackEntry | undefined> => {
      const integrated = entry.health !== undefined;

      const [evidence, health, localUsage] = await Promise.all([
        gatherEvidence(entry),
        entry.health?.().catch(() => ({ available: false, reason: `${entry.name} could not report its health.` })),
        entry.localUsage?.(since.getTime()).catch(() => undefined),
      ]);

      if (!integrated && evidence.length === 0) return undefined;

      const enabled = integrated ? isAiEnabled(entry.id) : false;
      const { status, reason } = deriveStatus({ integrated, enabled, name: entry.name, health });

      return {
        id: entry.id,
        name: entry.name,
        vendor: entry.vendor,
        kind: entry.kind,
        integration: entry.integration,
        toggleable: integrated,
        enabled,
        status,
        statusReason: reason,
        detected: evidence.length > 0,
        evidence,
        ledgerAgent: entry.ledgerAgent,
        provider: entry.provider,
        localUsage,
      };
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    windowLabel: since.toLocaleString("en-US", { month: "long", year: "numeric" }),
    entries: entries.filter((entry): entry is AiStackEntry => entry !== undefined),
  };
}
