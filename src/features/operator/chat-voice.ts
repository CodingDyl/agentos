import type { ChatApprovalPart, ChatMessage } from "@shared/chat-types";
import { normaliseUtterance } from "./jarvis-operator";

/**
 * Jarvis in a chat: what a spoken sentence means here, and what Jarvis says.
 *
 * Pure, so it is tested without a microphone. The same rules as Operator's:
 *
 * - A command is a short sentence on its own. "Stop" stops the reply; "stop
 *   the build failing on CI" is a message.
 * - Saying no is immediate: "don't allow" and "stop" are the safe direction.
 * - Saying yes is two steps. Everything a chat asks about is risky by
 *   definition, so "allow" has Jarvis read out exactly what will run, and only
 *   "confirm" lets it. A mis-heard word must not be able to push to GitHub.
 */

export type ChatVoiceCommand =
  | { kind: "stop" }
  | { kind: "allow" }
  | { kind: "confirm" }
  | { kind: "deny" }
  | { kind: "new-chat" }
  | { kind: "message"; text: string };

const COMMANDS: readonly (readonly [RegExp, ChatVoiceCommand])[] = [
  [/^(stop|cancel|abort|halt)( (it|that|this|now|the reply))?( please)?$/, { kind: "stop" }],
  [/^(don'?t|do not) (allow|do|run)( (it|that|this))?( please)?$|^(deny|denied|reject|no|nope|don'?t)( (it|that))?( please)?$/, { kind: "deny" }],
  [/^(confirm|confirmed|yes confirm|i confirm)( please)?$/, { kind: "confirm" }],
  [/^(allow|allowed|allow (it|that|this)|approve|approve (it|that)|go ahead|yes( please)?)( please)?$/, { kind: "allow" }],
  [/^(new|start a new|fresh|clear( the)?) chat( please)?$|^clear( the)? (chat|history|conversation)( please)?$/, { kind: "new-chat" }],
];

export function parseChatVoiceCommand(raw: string): ChatVoiceCommand | undefined {
  const plain = normaliseUtterance(raw);
  if (!plain) return undefined;
  for (const [pattern, command] of COMMANDS) {
    if (pattern.test(plain)) return command;
  }
  // Anything else is something to say to the agent, wake word removed.
  const text = raw.replace(/^\s*(?:(?:hey|ok|okay)\s+)?jarvis\b[\s,.!:;-]*/i, "").trim();
  return text ? { kind: "message", text } : undefined;
}

/** How long "confirm" stays valid after "allow": long enough to answer, short enough to mean it. */
export const CONFIRM_WINDOW_MS = 20_000;

export function pendingApproval(message: ChatMessage | undefined): ChatApprovalPart | undefined {
  return message?.parts.find((part): part is ChatApprovalPart => part.type === "approval" && part.status === "pending");
}

/** What Jarvis says when an agent stops to ask. */
export function approvalPrompt(agent: string, part: ChatApprovalPart): string {
  return `${agent} wants to ${describeAction(part)}. ${part.reason} Say allow, or don't allow.`;
}

/** What Jarvis reads back after "allow", before anything runs. */
export function confirmPrompt(part: ChatApprovalPart): string {
  return `It will ${describeAction(part)}. Say confirm to go ahead.`;
}

function describeAction(part: ChatApprovalPart): string {
  const what = part.summary.length > 120 ? `${part.summary.slice(0, 117)}…` : part.summary;
  if (!what) return `use ${part.tool}`;
  return part.tool === "Bash" || part.tool === "Execute" ? `run ${what}` : `${part.tool.toLowerCase()} ${what}`;
}

/**
 * A reply, shortened for speaking: the first couple of sentences of what the
 * agent said, without code or markdown. Long answers are for reading.
 */
export function spokenSummary(message: ChatMessage, sentences = 2): string | undefined {
  if (message.error) return message.error;
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  // A sentence ends at punctuation followed by a space, so `animate.test.ts` stays whole.
  return text.split(/(?<=[.!?])\s+/).slice(0, sentences).join(" ").trim();
}
