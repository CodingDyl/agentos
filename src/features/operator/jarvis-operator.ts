import type { OperatorMode, OperatorRun, OperatorStep } from "@shared/operator-types";
import { pendingExternalSteps, stepCounts } from "./operator-model";

/**
 * Jarvis on the Operator page: what a spoken sentence means here, and what
 * Jarvis says as a run moves.
 *
 * Pure, so it is tested without a microphone. The rules that matter:
 *
 * - A command is a short sentence on its own. "Stop" stops the run; "stop the
 *   pricing page breaking on mobile" is a request, not a stop.
 * - Stopping by voice is immediate: it is the safe direction.
 * - Approving by voice is two steps when the run would change anything outside
 *   this machine: "approve", Jarvis reads out what will change, then "confirm".
 *   A mis-heard word must not be able to push to GitHub.
 * - Narration is what changed, never a replay: opening an old run says nothing.
 */

export type VoiceCommand =
  | { kind: "stop" }
  | { kind: "approve" }
  | { kind: "confirm" }
  | { kind: "run-plan" }
  | { kind: "status" }
  | { kind: "read-plan" }
  | { kind: "mode"; mode: OperatorMode }
  | { kind: "request"; mode: OperatorMode; input: string };

const WAKE = /^\s*(?:(?:hey|ok|okay)\s+)?jarvis\b[\s,.!:;-]*/i;
const QUESTION = /^(what|why|how|which|who|when|where|is|are|should|can|could|does|do|tell me)\b/i;

const COMMANDS: readonly (readonly [RegExp, VoiceCommand])[] = [
  [/^(stop|cancel|abort|halt|kill)( (it|that|this|the run|this run|everything))?( now)?( please)?$/, { kind: "stop" }],
  [/^(confirm|confirmed|yes confirm|i confirm)( please)?$/, { kind: "confirm" }],
  [/^(approve|approved|approve it|approve and run|go ahead|run it|do it|proceed|yes( please)?)( please)?$/, { kind: "approve" }],
  [/^(run|do|execute|start) (this|the|that) plan( please)?$/, { kind: "run-plan" }],
  [/^(status|progress|update( me)?|what'?s (happening|the status|going on)|where are (we|you)( at)?|how'?s it going)$/, { kind: "status" }],
  [/^(read|tell me|what'?s|what is) (me )?(the )?plan$/, { kind: "read-plan" }],
];

/** Lower case, wake word and trailing punctuation gone: what commands are matched against. */
export function normaliseUtterance(text: string): string {
  return text
    .replace(WAKE, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

/** What a spoken sentence asks Operator to do. `fallbackMode` is the mode the composer is on. */
export function parseVoiceCommand(raw: string, fallbackMode: OperatorMode): VoiceCommand | undefined {
  const spoken = raw.replace(WAKE, "").trim();
  if (!spoken) return undefined;

  const plain = normaliseUtterance(spoken);
  for (const [pattern, command] of COMMANDS) {
    if (pattern.test(plain)) return command;
  }

  const mode = /^(?:switch to |use )?(ask|plan|run) mode$/.exec(plain)?.[1] as OperatorMode | undefined;
  if (mode) return { kind: "mode", mode };

  // "Ask: what's slow on Virtara" drops the prefix; "Plan a landing page" keeps
  // its words, because "plan" is part of the request.
  const asked = /^(?:ask|question)\b[\s:,-]+(.+)$/i.exec(spoken);
  if (asked) return { kind: "request", mode: "ask", input: asked[1].trim() };
  if (/^plan\b/i.test(spoken)) return { kind: "request", mode: "plan", input: spoken };
  if (QUESTION.test(spoken)) return { kind: "request", mode: "ask", input: spoken };
  return { kind: "request", mode: fallbackMode, input: spoken };
}

/** How long a spoken "approve" waits for "confirm". */
export const CONFIRM_WINDOW_MS = 30_000;

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function lower(title: string): string {
  return title.charAt(0).toLowerCase() + title.slice(1);
}

/** Whether a spoken approve can go straight through, and what Jarvis says either way. */
export function approvalGate(run: OperatorRun): { needsConfirm: boolean; say: string } {
  const external = pendingExternalSteps(run.plan).map((step) => lower(step.title));
  if (external.length > 0) {
    return {
      needsConfirm: true,
      say: `This will change things outside this machine: ${list(external)}. Say confirm to go ahead, or stop.`,
    };
  }
  return { needsConfirm: false, say: "Approved. Running it now." };
}

function subject(run: OperatorRun): string {
  const name = run.intent?.workspace?.name;
  const kind = run.intent?.interpretedAs ?? "Your request";
  return name ? `${kind}, ${name}` : kind;
}

export function approvalBrief(run: OperatorRun): string {
  const counts = stepCounts(run.plan);
  const local = run.plan.filter((step) => step.status === "pending" && !step.external && step.risk !== "read").map((step) => lower(step.title));
  const external = pendingExternalSteps(run.plan).map((step) => lower(step.title));
  const cant = counts.blocked > 0 ? `, ${counts.blocked} can't yet` : "";
  const what =
    external.length > 0
      ? `It will change things outside this machine: ${list(external)}. Say approve, then confirm, or say stop.`
      : `Everything stays on this machine: ${list(local.slice(0, 4))}. Say approve to run it, or stop.`;
  return `${subject(run)}. ${counts.runnable} of ${counts.total} steps can run here${cant}. ${what}`;
}

function firstBlocked(run: OperatorRun): OperatorStep | undefined {
  return run.plan.find((step) => step.status === "blocked");
}

export function settledBrief(run: OperatorRun): string {
  const counts = stepCounts(run.plan);
  switch (run.status) {
    case "completed":
      if (run.mode === "ask") return run.report?.answer ?? "Done, but there was no answer to read out.";
      if (run.mode === "plan") {
        return `Plan ready${run.intent?.workspace ? ` for ${run.intent.workspace.name}` : ""}. ${counts.runnable} of ${counts.total} steps can run here. Say run this plan to do it.`;
      }
      return `Done. ${run.report?.summary ?? ""}`.trim();
    case "blocked": {
      const blocked = firstBlocked(run);
      return `Finished what I could: ${counts.done} of ${counts.total} steps.${blocked ? ` ${blocked.title} can't run yet. ${blocked.reason ?? ""}` : ""}`.trim();
    }
    case "failed": {
      const failed = run.plan.find((step) => step.status === "failed");
      if (run.mode === "ask") return `I couldn't get an answer. ${failed?.reason ?? run.statusDetail ?? ""}`.trim();
      return failed ? `That failed at ${lower(failed.title)}. ${failed.reason ?? ""}`.trim() : `That failed. ${run.statusDetail ?? ""}`.trim();
    }
    case "stopped":
      return run.changes.length > 0
        ? `Stopped. ${run.changes.length} change${run.changes.length === 1 ? " was" : "s were"} made before that, and kept.`
        : "Stopped. Nothing was changed.";
    default:
      return "";
  }
}

/** The answer to "status". */
export function statusBrief(run: OperatorRun | undefined): string {
  if (!run) return "No run is open. Tell me what you want done.";
  const counts = stepCounts(run.plan);
  switch (run.status) {
    case "planning":
      return "Still planning it.";
    case "awaiting_approval":
      return approvalBrief(run);
    case "running": {
      const current = run.plan.find((step) => step.status === "running");
      return `Running. ${counts.done} of ${counts.total} steps done${current ? `, now ${lower(current.title)}` : ""}.`;
    }
    default:
      return settledBrief(run);
  }
}

/** The answer to "read me the plan": numbered, with what can't run said plainly. */
export function readPlan(run: OperatorRun | undefined, limit = 10): string {
  if (!run || run.plan.length === 0) return "There's no plan yet.";
  const lines = run.plan.slice(0, limit).map((step, index) => `${index + 1}, ${lower(step.title)}${step.status === "blocked" ? ", can't run yet" : ""}.`);
  const more = run.plan.length > limit ? ` And ${run.plan.length - limit} more on screen.` : "";
  return `${run.plan.length} steps. ${lines.join(" ")}${more}`;
}

/**
 * What to say about the change from one snapshot of a run to the next.
 * Nothing on the first sight of a run: only what happened while you watched.
 */
export function narrate(previous: OperatorRun | undefined, next: OperatorRun): string | undefined {
  if (!previous || previous.id !== next.id) return undefined;

  const before = new Map(previous.plan.map((step) => [step.id, step.status]));
  const lines: string[] = [];

  // Steps only once the plan existed before: planning fills in a whole plan at once.
  if (previous.plan.length > 0) {
    for (const step of next.plan) {
      const was = before.get(step.id);
      if (was === step.status) continue;
      // Bookkeeping steps are not news.
      if (step.status === "done" && step.operation !== "hermes.plan" && step.operation !== "agentos.record") lines.push(`${step.title}, done.`);
      if (step.status === "failed") lines.push(`${step.title} failed.`);
    }
  }

  if (previous.status !== next.status) {
    if (next.status === "awaiting_approval") lines.push(approvalBrief(next));
    else if (next.status === "running" && previous.status === "awaiting_approval") lines.unshift("Running.");
    else if (next.status !== "running" && next.status !== "planning") lines.push(settledBrief(next));
  }

  const said = lines.join(" ").trim();
  return said.length > 0 ? said : undefined;
}

/** What Jarvis says the moment a spoken request is taken. */
export function acknowledge(mode: OperatorMode): string {
  switch (mode) {
    case "ask":
      return "Looking into it.";
    case "plan":
      return "Planning it. Nothing will run.";
    case "run":
      return "On it. I'll plan it first and ask before anything changes.";
  }
}
