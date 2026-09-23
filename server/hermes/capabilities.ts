import type { AgentCapabilities } from "../../shared/agentos-types";
import { hermesFetch, HermesError } from "./client";

/**
 * Feature discovery.
 *
 * Hermes publishes capability flags so external UIs can discover support
 * instead of assuming it. The exact payload shape is not contractual, so this
 * reader is deliberately tolerant: it looks for a flag under several plausible
 * shapes and defaults every one to `false`. An unreadable or unfamiliar payload
 * disables features — it never enables them.
 */

const NONE: AgentCapabilities = {
  available: false,
  runs: false,
  events: false,
  stop: false,
  steer: false,
  approvals: false,
  subagents: false,
  vision: false,
  visionReason: "Hermes did not report its capabilities.",
};

/** Candidate objects a flag might live in. */
function flagSources(payload: unknown): Record<string, unknown>[] {
  if (typeof payload !== "object" || payload === null) return [];

  const root = payload as Record<string, unknown>;
  const nested = ["capabilities", "features", "supports", "supported"]
    .map((key) => root[key])
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    );

  return [root, ...nested];
}

/** Feature names listed as an array, e.g. `{ features: ["runs", "stop"] }`. */
function listedFeatures(payload: unknown): Set<string> {
  if (typeof payload !== "object" || payload === null) return new Set();

  const root = payload as Record<string, unknown>;
  const lists = ["features", "capabilities", "supported"]
    .map((key) => root[key])
    .filter((value): value is unknown[] => Array.isArray(value));

  return new Set(
    lists
      .flat()
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase()),
  );
}

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/** Whether any of these aliases is advertised, in any of the shapes above. */
export function readFlag(payload: unknown, aliases: readonly string[]): boolean {
  const sources = flagSources(payload);
  const listed = listedFeatures(payload);

  return aliases.some((alias) => {
    const lower = alias.toLowerCase();
    if (listed.has(lower)) return true;
    return sources.some((source) => truthy(source[alias]));
  });
}

/** Normalises whatever Hermes reports into the flags the console cares about. */
export function readCapabilities(payload: unknown): AgentCapabilities {
  const runs = readFlag(payload, [
    "runs",
    "run",
    "agent_runs",
    "agentRuns",
    // What Hermes actually publishes. Being able to submit a run is what
    // "runs" means here; `run_status` is the weaker corroborating signal, and
    // either alone is enough to stop the console declaring the feature absent.
    "run_submission",
    "run_status",
  ]);

  return {
    available: true,
    // Vision is discovered separately, from the toolsets document.
    vision: false,
    runs,
    // Streaming, stopping and steering are meaningless without runs.
    events:
      runs &&
      readFlag(payload, [
        "events",
        "run_events",
        "sse",
        "streaming",
        "run_events_sse",
        "tool_progress_events",
      ]),
    stop: runs && readFlag(payload, ["stop", "cancel", "run_stop"]),
    steer: runs && readFlag(payload, ["steer", "steering", "run_steer"]),
    approvals:
      runs &&
      readFlag(payload, [
        "approvals",
        "approval",
        "guarded",
        "run_approval_response",
        "approval_events",
      ]),
    // Left as it was. This Hermes publishes no subagent flag at all, so the
    // answer is false either way — and narrowing the aliases would only make
    // the console blind to a build that does advertise one.
    subagents: runs && readFlag(payload, ["subagents", "subagent", "delegation"]),
  };
}

/**
 * Whether Hermes can actually look at an image.
 *
 * Read from `/toolsets` rather than `/capabilities`, because that is where
 * Hermes says which tools exist and which are usable — the capabilities
 * document does not mention vision at all.
 *
 * Both flags are required. A toolset that is `enabled` but not `configured`
 * has no model behind it: the call would be accepted and an opinion returned
 * without anything having been looked at, which is worse than a refusal
 * because nothing about the answer would say so.
 *
 * Fails closed, and says why: a visual review that cannot see is not offered.
 */
export function readVision(payload: unknown): {
  vision: boolean;
  visionReason?: string;
} {
  const data =
    typeof payload === "object" && payload !== null
      ? (payload as { data?: unknown }).data
      : undefined;

  if (!Array.isArray(data)) {
    return {
      vision: false,
      visionReason: "Hermes did not report which toolsets it has.",
    };
  }

  const toolset = data.find(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).name === "vision",
  );

  if (!toolset) {
    return {
      vision: false,
      visionReason:
        "This Hermes has no vision toolset, so it cannot inspect images.",
    };
  }

  if (toolset.enabled !== true) {
    return {
      vision: false,
      visionReason:
        "Hermes' vision toolset is disabled. Enable it to review design references.",
    };
  }

  if (toolset.configured !== true) {
    return {
      vision: false,
      visionReason:
        "Hermes' vision toolset is enabled but not configured, so it has no model to look at images with. Configure vision in Hermes to review design references.",
    };
  }

  return { vision: true };
}

/** Asks Hermes which toolsets it has. An unreadable answer means no vision. */
async function getVision(): Promise<{
  vision: boolean;
  visionReason?: string;
}> {
  try {
    const response = await hermesFetch("/toolsets", { method: "GET" });

    if (!response.ok) {
      return {
        vision: false,
        visionReason: "Hermes would not say which toolsets it has.",
      };
    }

    return readVision(await response.json());
  } catch {
    return {
      vision: false,
      visionReason: "Hermes could not be reached to check for vision support.",
    };
  }
}

/**
 * Reads capabilities from Hermes.
 *
 * Failure is not an error here: a Hermes that cannot answer is simply one
 * without run support, and the console falls back to plain messaging.
 */
export async function getCapabilities(): Promise<AgentCapabilities> {
  try {
    const [response, vision] = await Promise.all([
      hermesFetch("/capabilities", { method: "GET" }),
      getVision(),
    ]);

    if (!response.ok) return { ...NONE, ...vision };

    return { ...readCapabilities(await response.json()), ...vision };
  } catch (error) {
    if (error instanceof HermesError && error.reason === "not-configured") {
      throw error;
    }
    return NONE;
  }
}
