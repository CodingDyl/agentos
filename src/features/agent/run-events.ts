import type {
  AgentRunEvent,
  AgentRunStatus,
  ApprovalDecision,
  ApprovalRequest,
} from "@shared/agentos-types";

/**
 * Interprets Hermes run events.
 *
 * Event names are matched by family rather than by an exact list, and anything
 * unrecognised is kept as-is rather than discarded or thrown on. Hermes can add
 * event types at any time; the console must keep working when it does.
 */

export type ActivityState = "running" | "complete" | "error";

export interface ActivityStep {
  id: string;
  label: string;
  state: ActivityState;
}

export interface SubagentActivity {
  name: string;
  state: ActivityState;
}

export interface RunState {
  status: AgentRunStatus;
  /** Assistant text accumulated from streamed deltas. */
  output: string;
  steps: ActivityStep[];
  subagents: SubagentActivity[];
  /** The live system approval, kept after a decision as a record of it. */
  approval?: ApprovalRequest;
  /** Events the console has no specific handling for. Surfaced in debug only. */
  unrecognised: AgentRunEvent[];
  error?: string;
}

export const initialRunState: RunState = {
  status: "starting",
  output: "",
  steps: [],
  subagents: [],
  unrecognised: [],
};

function record(event: AgentRunEvent): Record<string, unknown> {
  return typeof event.data === "object" && event.data !== null
    ? (event.data as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** First present string among these keys. */
function field(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(data[key]);
    if (value) return value;
  }
  return undefined;
}

function upsertStep(
  steps: ActivityStep[],
  id: string,
  label: string,
  state: ActivityState,
): ActivityStep[] {
  const index = steps.findIndex((step) => step.id === id);
  if (index === -1) return [...steps, { id, label, state }];

  const next = [...steps];
  next[index] = { ...next[index], label, state };
  return next;
}

function upsertSubagent(
  subagents: SubagentActivity[],
  name: string,
  state: ActivityState,
): SubagentActivity[] {
  const index = subagents.findIndex((agent) => agent.name === name);
  if (index === -1) return [...subagents, { name, state }];

  const next = [...subagents];
  next[index] = { name, state };
  return next;
}

/**
 * Applies one event.
 *
 * Matching is by substring so `tool.started`, `tool_start` and
 * `agent.tool.begin` all land in the same branch.
 */
export function applyRunEvent(
  state: RunState,
  event: AgentRunEvent,
  /** The run being streamed, used when an event omits its own id. */
  runId?: string,
): RunState {
  const type = event.type.toLowerCase();
  const data = record(event);

  const isStart = /start|begin|created|queued/.test(type);
  const isEnd = /complete|finish|end|success|done/.test(type);
  const isError = /error|fail/.test(type);

  // Streamed assistant text.
  if (/text|token|delta|message|output|content/.test(type) && !isError) {
    const chunk = field(data, ["text", "delta", "content", "output", "chunk"]);
    if (chunk) return { ...state, output: state.output + chunk };
  }

  if (type.includes("subagent")) {
    const name = field(data, ["name", "agent", "label", "title"]) ?? "Subagent";
    return {
      ...state,
      subagents: upsertSubagent(
        state.subagents,
        name,
        isError ? "error" : isEnd ? "complete" : "running",
      ),
    };
  }

  if (type.includes("approval")) {
    // Hermes answering its own gate — or reporting ours — reopens the run.
    if (/resolve|grant|decision|answer|denied|approved/.test(type)) {
      return {
        ...state,
        approval: state.approval
          ? {
              ...state.approval,
              status: /deny|denied|reject/.test(type) ? "denied" : "approved",
            }
          : undefined,
        status: state.status === "waiting_for_approval" ? "running" : state.status,
      };
    }

    // `approval.request`: the run stops here until a decision is recorded.
    return {
      ...state,
      status: "waiting_for_approval",
      approval: {
        requestId:
          field(data, [
            "request_id",
            "requestId",
            "approval_id",
            "approvalId",
            "id",
          ]) ?? event.type,
        runId:
          field(data, ["run_id", "runId"]) ??
          (typeof runId === "string" ? runId : "") ,
        command: field(data, ["command", "tool", "action", "input"]),
        description: field(data, [
          "description",
          "detail",
          "reason",
          "summary",
          "message",
        ]),
        status: "pending",
      },
    };
  }

  if (/tool|step|task|phase/.test(type)) {
    const label =
      field(data, ["name", "label", "title", "tool", "description"]) ?? "Working";
    const id = field(data, ["id", "call_id", "tool_call_id"]) ?? label;

    return {
      ...state,
      steps: upsertStep(
        state.steps,
        id,
        label,
        isError ? "error" : isEnd ? "complete" : "running",
      ),
    };
  }

  if (type.includes("run") || type.includes("status")) {
    if (isError) {
      return {
        ...state,
        status: "failed",
        error: field(data, ["error", "message", "detail"]),
      };
    }
    if (/cancel/.test(type)) return { ...state, status: "cancelled" };
    if (/stopping/.test(type)) return { ...state, status: "stopping" };
    if (isEnd) return { ...state, status: "completed" };
    if (/steer/.test(type)) return state;
    if (isStart) return { ...state, status: "running" };
  }

  // Unknown: kept, never thrown on.
  return { ...state, unrecognised: [...state.unrecognised, event] };
}

/**
 * Records the operator's decision on the live approval.
 *
 * Called only once Hermes has acknowledged it. Nothing here claims a file
 * changed — it marks the gate as answered and lets the run continue, and the
 * stream reports what actually happened.
 */
export function resolveApproval(
  state: RunState,
  decision: ApprovalDecision,
): RunState {
  if (!state.approval) return state;

  return {
    ...state,
    approval: {
      ...state.approval,
      status: decision === "deny" ? "denied" : "approved",
    },
    status: state.status === "waiting_for_approval" ? "running" : state.status,
  };
}

/** Steps still running are resolved once a run reaches a terminal status. */
export function settleRunState(state: RunState): RunState {
  const settle = (activityState: ActivityState): ActivityState =>
    activityState === "running" ? "complete" : activityState;

  return {
    ...state,
    steps: state.steps.map((step) => ({ ...step, state: settle(step.state) })),
    subagents: state.subagents.map((agent) => ({
      ...agent,
      state: settle(agent.state),
    })),
  };
}

const TERMINAL: readonly AgentRunStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: AgentRunStatus): boolean {
  return TERMINAL.includes(status);
}
