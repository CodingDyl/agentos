import type { ActivityEvent, ActivityLevel } from "../../shared/agentos-types";
import { getAutomations, getRecentExecutions } from "../hermes/automations";

/**
 * What Hermes did while nobody was watching.
 *
 * Read from Hermes' own durable execution history, joined to the job names it
 * lists — so an automation appears in the timeline under the name it has on the
 * Automations screen, not as a job id.
 */

const LEVEL_BY_STATUS: Record<string, ActivityLevel> = {
  success: "success",
  failed: "error",
  running: "info",
};

const TITLE_BY_STATUS: Record<string, string> = {
  success: "completed",
  failed: "failed",
  running: "started",
};

/** Every recent automation run, unsorted. */
export async function readAutomationActivity(
  limit: number,
): Promise<ActivityEvent[]> {
  const [{ automations }, executions] = await Promise.all([
    getAutomations(),
    getRecentExecutions(limit),
  ]);

  const names = new Map(
    automations.map((automation) => [automation.id, automation.name]),
  );

  return executions.map((execution) => {
    // A job removed from the schedule can still have history; its id is the
    // only name left, and inventing a friendlier one would be a fiction.
    const name = names.get(execution.automationId) ?? execution.automationId;
    const outcome = TITLE_BY_STATUS[execution.status] ?? execution.status;

    return {
      id: `automation-${execution.id}`,
      timestamp: execution.timestamp,
      source: "automation",
      level: LEVEL_BY_STATUS[execution.status] ?? "info",
      type: `automation.${execution.status}`,
      title: `${name} ${outcome}`,
      // Hermes' own word for an attempt whose outcome it never established,
      // and its own reason when something failed.
      description: execution.error ?? execution.rawStatus,
      metadata: { automation: execution.automationId },
    };
  });
}
