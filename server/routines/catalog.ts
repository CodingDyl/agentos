import type { RoutineId } from "../../shared/routine-types";

/**
 * The routines AgentOS offers. Each becomes one Hermes scheduled job.
 *
 * The schedule is a cron expression in the machine's local time, which is
 * what Hermes' scheduler uses.
 */

export interface RoutineDefinition {
  id: RoutineId;
  name: string;
  summary: string;
  when: string;
  /** Completes "Sends nothing when …". */
  quietWhen: string;
  schedule: string;
}

export const ROUTINES: readonly RoutineDefinition[] = [
  {
    id: "follow-ups",
    name: "Follow-ups due",
    summary: "Who wrote back to your outreach, and who is due the next email.",
    when: "Weekdays at 09:00",
    quietWhen: "nobody replied and no email is due",
    schedule: "0 9 * * 1-5",
  },
  {
    id: "inbox",
    name: "Inbox needs you",
    summary: "The emails Mail has sorted into Needs you, newest first.",
    when: "Weekdays at 12:30 and 16:30",
    quietWhen: "no email needs you",
    schedule: "30 12,16 * * 1-5",
  },
  {
    id: "evening-wrap",
    name: "Evening wrap",
    summary: "What you finished today, and the Now tasks still open.",
    when: "Weekdays at 17:30",
    quietWhen: "nothing was finished and nothing is open",
    schedule: "30 17 * * 1-5",
  },
  {
    id: "overdue-invoices",
    name: "Money check",
    summary: "Overdue invoices across your businesses, with the total owed.",
    when: "Mondays at 08:00",
    quietWhen: "no invoice is overdue",
    schedule: "0 8 * * 1",
  },
];

export function findRoutine(id: RoutineId): RoutineDefinition {
  const routine = ROUTINES.find((entry) => entry.id === id);
  if (!routine) throw new Error(`Unknown routine: ${id}`);
  return routine;
}

/** The script's file name inside Hermes' scripts folder. Also how an installed routine is recognised. */
export function routineScriptName(id: RoutineId): string {
  return `agentos-routine-${id}.sh`;
}

export function routineJobName(routine: RoutineDefinition): string {
  return `AgentOS: ${routine.name}`;
}

/**
 * The script Hermes runs. It prints the message AgentOS wrote and Hermes
 * sends that text as it is. No output (nothing to report, or AgentOS is not
 * running) sends nothing.
 */
export function routineScript(routine: RoutineDefinition, port: number): string {
  return [
    "#!/bin/bash",
    `# AgentOS routine "${routine.name}". Installed by AgentOS (Automations > Routines).`,
    "# AgentOS writes the message; Hermes sends it as it is, with no model call.",
    "# No output means nothing to report, and nothing is sent.",
    `curl -s -f -m 30 "http://127.0.0.1:\${AGENTOS_PORT:-${port}}/api/routines/feed/${routine.id}"`,
    "exit 0",
    "",
  ].join("\n");
}
