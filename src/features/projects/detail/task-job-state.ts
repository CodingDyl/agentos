import type { AgentStatus } from "@/components/os";

/**
 * How a worker job's state reads on a task row.
 *
 * Kept apart from the components so both the row and the panel can name a
 * state the same way. A task saying "running" while its panel said something
 * else would be two answers to one question.
 *
 * The tones matter: `awaiting_review` and `changes_required` are `attention`
 * rather than `running`, because both mean the machine has stopped and is
 * waiting on a person — the one state a console must never make look busy.
 */
const JOB_STATE: Record<string, { label: string; tone: AgentStatus }> = {
  queued: { label: "Queued", tone: "paused" },
  preparing: { label: "Preparing", tone: "running" },
  running: { label: "Running", tone: "running" },
  waiting: { label: "Waiting", tone: "paused" },
  validating: { label: "Validating", tone: "running" },
  awaiting_review: { label: "Awaiting review", tone: "attention" },
  reviewing: { label: "In review", tone: "running" },
  changes_required: { label: "Changes required", tone: "attention" },
  approved: { label: "Approved", tone: "attention" },
  integrating: { label: "Integrating", tone: "running" },
  completed: { label: "Integrated", tone: "completed" },
  rejected: { label: "Rejected", tone: "blocked" },
  failed: { label: "Failed", tone: "blocked" },
  cancelled: { label: "Cancelled", tone: "paused" },
};

export function taskJobState(status: string | undefined) {
  return status ? JOB_STATE[status] : undefined;
}
