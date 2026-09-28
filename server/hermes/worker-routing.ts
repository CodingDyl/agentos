import type {
  WorkerPerformance,
  WorkerRoutingDecision,
} from "../../shared/worker-routing-types";
import {
  RoutingConfidenceSchema,
  WorkerTaskComplexitySchema,
  WorkerTaskTypeSchema,
} from "../../shared/worker-routing-types";
import type { WorkerId } from "../../shared/worker-types";
import { sendToHermes } from "./client";
import { extractJson } from "./worker-review";

/**
 * Asking Hermes which worker should take a job.
 *
 * The reply is read defensively, as every model reply in this system is, but
 * the failure it guards against is not the reviewer's. A review that cannot be
 * read must never become a pass, because the cost is unreviewed code on a real
 * branch. A routing reply that cannot be read costs far less: the work still
 * gets validated, still gets reviewed, and still waits for a person. So the
 * rule here is the opposite one — **an unreadable answer falls back rather
 * than blocking**, and says plainly that it fell back.
 *
 * The one thing that is refused outright is a worker that was not offered.
 * Hermes is given the candidates and may choose among them; a reply naming
 * anything else is not a choice this module can honour, and quietly correcting
 * it would hide a router that had stopped understanding its own options.
 */

/** The Hermes skill that carries the router's instructions. */
const ROUTING_SKILL = "/route-worker-job";

/** Kept short: a reason nobody reads is not a reason. */
const MAX_REASONS = 5;
const MAX_REASON_CHARS = 200;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** A percentage, or a dash. A worker with no history says so. */
function percent(value: number | undefined): string {
  return value === undefined ? "no data" : `${Math.round(value * 100)}%`;
}

function money(value: number | undefined): string {
  return value === undefined ? "no data" : `$${value.toFixed(2)}`;
}

function rounded(value: number | undefined, digits = 1): string {
  return value === undefined ? "no data" : value.toFixed(digits);
}

/**
 * What Hermes is told about one worker.
 *
 * Only the record, and only this worker's. Nothing about the vault, the
 * portfolio, or any job other than the one being routed.
 */
function describeCandidate(
  performance: WorkerPerformance,
  capabilities: readonly string[],
): string {
  return [
    `${performance.worker}`,
    `- capabilities: ${capabilities.join(", ")}`,
    `- finished jobs: ${performance.jobs}`,
    `- review pass rate: ${percent(performance.reviewPassRate)} (${performance.reviews} reviewed)`,
    `- validation pass rate: ${percent(performance.validationPassRate)}`,
    `- average revisions: ${rounded(performance.avgRevisions)}`,
    `- average cost: ${money(performance.avgCostUsd)}`,
  ].join("\n");
}

export interface RoutingPacketInput {
  objective: string;
  project: string;
  /** The deterministic reading of the task, offered as a starting point. */
  taskType?: string;
  complexity?: string;
  candidates: {
    performance: WorkerPerformance;
    capabilities: readonly string[];
  }[];
}

/**
 * The brief Hermes is actually sent.
 *
 * Compact on purpose. A router given the whole history would be choosing from
 * everything AgentOS knows rather than from what bears on this job, and would
 * be slower, dearer, and no better at it.
 *
 * The ordering of the criteria is stated because it is a judgement AgentOS is
 * making, not one the model should improvise: the cheapest worker is not the
 * right worker when it takes three revisions to get there.
 */
export function buildRoutingPacket(input: RoutingPacketInput): string {
  return [
    "WORKER ROUTING REQUEST",
    "",
    "Choose which worker should execute one scoped job.",
    "",
    "TASK",
    input.objective,
    "",
    `PROJECT: ${input.project}`,
    input.taskType ? `LIKELY TYPE: ${input.taskType}` : undefined,
    input.complexity ? `LIKELY COMPLEXITY: ${input.complexity}` : undefined,
    "",
    "AVAILABLE WORKERS",
    "",
    ...input.candidates.map((candidate) =>
      describeCandidate(candidate.performance, candidate.capabilities),
    ),
    "",
    "HOW TO WEIGH THEM, IN ORDER",
    "1. Can the worker do this job at all?",
    "2. How reliable has it been: review and validation history.",
    "3. How well the task suits it.",
    "4. How many revisions it is likely to need.",
    "5. Cost.",
    "6. Speed.",
    "",
    "Cost is the fifth consideration, not the first. A worker that costs less",
    "and needs three revisions is the more expensive choice.",
    "",
    "A worker with no history is not a bad worker, just an unmeasured one.",
    "Say so rather than ruling it out for having no numbers.",
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "selectedWorker": "<one of the workers listed above>",',
    '  "confidence": "high" | "medium" | "low",',
    '  "taskType": "implementation" | "debugging" | "refactor" | "code-review"',
    '            | "architecture" | "research" | "design-implementation" | "testing",',
    '  "complexity": "low" | "medium" | "high",',
    '  "reasons": ["short reason", "short reason"],',
    '  "alternatives": [{ "worker": "<id>", "reason": "why not this one" }]',
    "}",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function readReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((entry) => {
      const reason = asString(entry);
      return reason ? [reason.slice(0, MAX_REASON_CHARS)] : [];
    })
    .slice(0, MAX_REASONS);
}

/**
 * Reads Hermes' reply into a decision.
 *
 * Returns nothing when the reply cannot be trusted, which the caller turns
 * into a deterministic fallback. Exported so the parsing can be tested against
 * real replies without calling Hermes.
 */
export function readRoutingDecision(
  text: string,
  candidates: readonly WorkerId[],
): WorkerRoutingDecision | undefined {
  const payload = asRecord(extractJson(text));
  if (!payload) return undefined;

  const selected = asString(payload.selectedWorker) as WorkerId | undefined;

  // The one hard refusal. Hermes may choose among the workers it was offered
  // and nothing else — a reply naming an unavailable or unknown worker is a
  // router that has lost track of its own options, not a decision to honour.
  if (!selected || !candidates.includes(selected)) return undefined;

  const confidence = RoutingConfidenceSchema.safeParse(
    asString(payload.confidence)?.toLowerCase(),
  );

  const taskType = WorkerTaskTypeSchema.safeParse(
    asString(payload.taskType)?.toLowerCase(),
  );

  const complexity = WorkerTaskComplexitySchema.safeParse(
    asString(payload.complexity)?.toLowerCase(),
  );

  const alternatives = (
    Array.isArray(payload.alternatives) ? payload.alternatives : []
  ).flatMap((entry) => {
    const source = asRecord(entry);
    const worker = asString(source?.worker) as WorkerId | undefined;
    const reason = asString(source?.reason);

    // An alternative naming a worker that was not on offer is dropped rather
    // than shown: it would read as a choice the operator could have made.
    if (!worker || !reason || !candidates.includes(worker)) return [];
    if (worker === selected) return [];

    return [{ worker, reason: reason.slice(0, MAX_REASON_CHARS) }];
  });

  const reasons = readReasons(payload.reasons);

  return {
    selectedWorker: selected,
    // An unreadable confidence is low confidence, never high. The router does
    // not get the benefit of the doubt about how sure it was.
    confidence: confidence.success ? confidence.data : "low",
    reasons:
      reasons.length > 0
        ? reasons
        : ["Hermes selected this worker but gave no reason."],
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    taskType: taskType.success ? taskType.data : undefined,
    complexity: complexity.success ? complexity.data : undefined,
    decidedBy: "hermes",
    decidedAt: new Date().toISOString(),
  };
}

/**
 * Sends one routing packet to Hermes and reads the answer.
 *
 * A Hermes that cannot be reached returns nothing rather than throwing: the
 * caller has a deterministic fallback, and a delegation screen that refused to
 * open because the router was down would be a worse system than one that
 * recommends from the record and says that is what it did.
 */
export async function requestRouting(
  packet: string,
  candidates: readonly WorkerId[],
  project?: string,
): Promise<WorkerRoutingDecision | undefined> {
  try {
    const reply = await sendToHermes(`${ROUTING_SKILL}\n\n${packet}`, {
      operation: "routing",
      project,
    });

    return readRoutingDecision(reply, candidates);
  } catch {
    return undefined;
  }
}
