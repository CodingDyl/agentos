import type {
  CapabilityPolicy,
  CapabilityRisk,
  ConnectorCapability,
  ConnectorStatus,
  ConnectorSummary,
} from "@shared/connector-types";

/**
 * The Connectors screen's wording and grouping, kept out of the components so
 * it can be tested: a connector that is set up but failing must never read as
 * connected, and one AgentOS has no code for must never read as available.
 */

export type ConnectorTone = "green" | "flame" | "muted" | "marigold";

export function statusLabel(status: ConnectorStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "error":
      return "Error";
    case "disconnected":
      return "Not connected";
    case "unavailable":
      return "No adapter";
  }
}

export function statusTone(status: ConnectorStatus): ConnectorTone {
  switch (status) {
    case "connected":
      return "green";
    case "error":
      return "flame";
    case "disconnected":
      return "marigold";
    case "unavailable":
      return "muted";
  }
}

/** Set up on this machine — working or not. These get the card grid. */
export function isSetUp(connector: Pick<ConnectorSummary, "status">): boolean {
  return connector.status === "connected" || connector.status === "error";
}

/**
 * The grid: errors first (they need a person), then by tier, then by name.
 * The list below: adapters that exist before ones that don't.
 */
export function groupConnectors(connectors: readonly ConnectorSummary[]): {
  setUp: ConnectorSummary[];
  available: ConnectorSummary[];
} {
  const byTier = (a: ConnectorSummary, b: ConnectorSummary) => a.tier - b.tier || a.name.localeCompare(b.name);
  const setUp = connectors
    .filter(isSetUp)
    .sort((a, b) => Number(b.status === "error") - Number(a.status === "error") || byTier(a, b));
  const available = connectors
    .filter((connector) => !isSetUp(connector))
    .sort((a, b) => Number(a.status === "unavailable") - Number(b.status === "unavailable") || byTier(a, b));
  return { setUp, available };
}

export const TIER_LABEL: Record<number, string> = {
  1: "Core",
  2: "Everyday",
  3: "Product & SEO",
  4: "Business & data",
  5: "Creative",
};

export const RISK_LABEL: Record<CapabilityRisk, string> = {
  read: "Read",
  "write-local": "Local write",
  "write-external": "External write",
  "external-communication": "Communication",
  destructive: "Destructive",
};

export const RISK_HINT: Record<CapabilityRisk, string> = {
  read: "No side effect",
  "write-local": "Changes AgentOS or files on this machine",
  "write-external": "Changes another service",
  "external-communication": "Reaches a person: email, messages, published copy",
  destructive: "Deletes, or moves money",
};

export const POLICY_OPTIONS: readonly { value: CapabilityPolicy; label: string }[] = [
  { value: "allowed", label: "Allowed" },
  { value: "approval", label: "Approval" },
  { value: "disabled", label: "Off" },
];

export function policyNote(capability: Pick<ConnectorCapability, "policy">): string | undefined {
  if (capability.policy === "approval") return "Requires approval";
  if (capability.policy === "disabled") return "Disabled";
  return undefined;
}

/** How a connector's capabilities split by policy, and how many AgentOS has code for. */
export function capabilityCounts(capabilities: readonly ConnectorCapability[]): {
  allowed: number;
  approval: number;
  disabled: number;
  built: number;
} {
  return {
    allowed: capabilities.filter((capability) => capability.policy === "allowed").length,
    approval: capabilities.filter((capability) => capability.policy === "approval").length,
    disabled: capabilities.filter((capability) => capability.policy === "disabled").length,
    built: capabilities.filter((capability) => capability.implemented).length,
  };
}

/** `16:42` today, `Tue 16:42` this week, `3 Sep` before that. */
export function formatWhen(iso: string | undefined, now = new Date()): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;

  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays >= 0 && ageDays < 6) return `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Why the switch sits where it does, when it isn't this page's alone. */
export function switchNote(connector: Pick<ConnectorSummary, "enabledSource" | "name">): string | undefined {
  if (connector.enabledSource === "required") return `AgentOS runs on ${connector.name}; it can't be switched off.`;
  if (connector.enabledSource === "ai-stack") return "Shared with Operations → AI stack: it's the same switch.";
  if (connector.enabledSource === "voice") return "Shared with Jarvis's voice switch: it's the same switch.";
  return undefined;
}
