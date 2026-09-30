import type { CapabilityPolicy } from "../../shared/connector-types";
import { isAiEnabled, setAiEnabled } from "../ai-stack/settings";
import { isVoiceEnabled, setVoiceEnabled } from "../voice/settings";
import { defaultPolicy, findCapability, findConnector } from "./catalog";
import { isSwitchedOn, recordUse, setSwitchedOn, storedPolicy, touch } from "./store";

/**
 * The guard every connector client calls before it reaches its service.
 *
 * Two questions, in order: is the connector switched on for AgentOS, and does
 * this capability's policy let this caller use it. Clients translate a refusal
 * into their own "not configured" error, the same well-trodden path Hermes
 * takes when it is switched off, so every screen already degrades for it.
 *
 * Who is asking matters only for `approval`:
 * - `person`  a button pressed in AgentOS. The press is the approval.
 * - `system`  AgentOS' own deterministic code (a sync, a scheduled read).
 * - `agent`   a model deciding to act. Held until a person confirms.
 */

export type Initiator = "person" | "system" | "agent";

export type CapabilityDecision =
  | { allowed: true; policy: CapabilityPolicy }
  | {
      allowed: false;
      code: "unknown-capability" | "connector-off" | "capability-disabled" | "approval-required";
      reason: string;
    };

/** The Hermes, Claude and Grok switches already exist in the AI stack; this page drives the same ones. */
export function isConnectorEnabled(connectorId: string): boolean {
  const connector = findConnector(connectorId);
  if (connector?.required) return true;
  if (connector?.aiStackSwitch) return isAiEnabled(connectorId);
  if (connector?.voiceSwitch) return isVoiceEnabled();
  return isSwitchedOn(connectorId);
}

export function setConnectorEnabled(connectorId: string, enabled: boolean): void {
  const connector = findConnector(connectorId);
  if (connector?.aiStackSwitch) setAiEnabled(connectorId, enabled);
  else if (connector?.voiceSwitch) setVoiceEnabled(enabled);
  else setSwitchedOn(connectorId, enabled);
}

export function effectivePolicy(capabilityId: string): CapabilityPolicy | undefined {
  const found = findCapability(capabilityId);
  if (!found) return undefined;
  return storedPolicy(capabilityId) ?? defaultPolicy(found.capability);
}

export function connectorOffReason(name: string): string {
  return `${name} is switched off in Connectors.`;
}

/** Decides without recording anything. What the orchestrator asks before it plans. */
export function decide(capabilityId: string, initiator: Initiator): CapabilityDecision {
  const found = findCapability(capabilityId);
  if (!found) return { allowed: false, code: "unknown-capability", reason: `${capabilityId} is not a known capability.` };

  const { connector, capability } = found;
  if (!isConnectorEnabled(connector.id)) {
    return { allowed: false, code: "connector-off", reason: connectorOffReason(connector.name) };
  }

  const policy = effectivePolicy(capabilityId) ?? "disabled";
  if (policy === "disabled") {
    return {
      allowed: false,
      code: "capability-disabled",
      reason: `“${capability.name}” is turned off for ${connector.name} in Connectors.`,
    };
  }
  if (policy === "approval" && initiator === "agent") {
    return {
      allowed: false,
      code: "approval-required",
      reason: `“${capability.name}” on ${connector.name} needs a person to approve it.`,
    };
  }

  return { allowed: true, policy };
}

/**
 * Decides, and on a yes records the use: a read moves "last used" (throttled),
 * anything else also lands in the connector's history.
 *
 * `detail` is shown on the connector page, so it must be a label — a branch
 * name, a record kind — never a message body, an address list or a key.
 */
export function authorize(
  capabilityId: string,
  options: { initiator: Initiator; detail?: string; now?: Date },
): CapabilityDecision {
  const decision = decide(capabilityId, options.initiator);
  if (!decision.allowed) return decision;

  const found = findCapability(capabilityId);
  if (!found) return decision;

  const now = options.now ?? new Date();
  try {
    if (found.capability.risk === "read") {
      touch(found.connector.id, now);
    } else {
      recordUse(found.connector.id, {
        capabilityId,
        capabilityName: found.capability.name,
        at: now.toISOString(),
        detail: options.detail?.slice(0, 120),
      });
    }
  } catch (error) {
    // Bookkeeping never blocks the action it describes.
    console.error("[agentos] connector use could not be recorded:", error);
  }

  return decision;
}
