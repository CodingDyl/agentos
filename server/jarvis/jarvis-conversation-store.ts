import { randomUUID } from "node:crypto";
import type { JarvisConversationOutput } from "../../shared/jarvis-routing-types";

/**
 * What Jarvis remembers of one conversation: the last few turns, the things
 * it produced, and an action waiting for your confirmation.
 *
 * In memory, bounded, and forgotten after two idle hours, which matches the
 * browser side (a reload starts a new conversation). Hermes keeps its own
 * history for what is handed to it; this is only what Jev needs to resolve
 * "make it shorter" and "send it" to the right thing.
 */

export interface JarvisTurn {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** The output this turn produced, so "it" can point at what was just made. */
  outputId?: string;
}

/**
 * An action a worker has prepared but not executed. Only a deterministic
 * "confirm" from you executes it; the model has no path to it.
 */
export interface JarvisPendingAction {
  id: string;
  workerId: string;
  summary: string;
  inputs: Record<string, string>;
  outputId?: string;
  expiresAt: number;
}

export interface JarvisConversation {
  id: string;
  turns: JarvisTurn[];
  outputs: JarvisConversationOutput[];
  pendingAction?: JarvisPendingAction;
  updatedAt: number;
}

const MAX_TURNS = 12;
const MAX_OUTPUTS = 10;
const MAX_CONVERSATIONS = 50;
const IDLE_MS = 2 * 60 * 60 * 1000;
/** A long turn is cut in history: a whole proposal re-sent on every request costs latency. */
const MAX_TURN_CHARS = 1_200;
export const PENDING_ACTION_MS = 5 * 60 * 1000;

export class JarvisConversationStore {
  private readonly conversations = new Map<string, JarvisConversation>();

  constructor(private readonly now: () => number = Date.now) {}

  get(id: string): JarvisConversation {
    this.evict();
    let conversation = this.conversations.get(id);
    if (!conversation) {
      conversation = { id, turns: [], outputs: [], updatedAt: this.now() };
      this.conversations.set(id, conversation);
    }
    if (conversation.pendingAction && conversation.pendingAction.expiresAt <= this.now()) conversation.pendingAction = undefined;
    conversation.updatedAt = this.now();
    return conversation;
  }

  addTurn(id: string, turn: Omit<JarvisTurn, "at">): void {
    const conversation = this.get(id);
    conversation.turns.push({ ...turn, text: turn.text.slice(0, MAX_TURN_CHARS), at: new Date(this.now()).toISOString() });
    if (conversation.turns.length > MAX_TURNS) conversation.turns.splice(0, conversation.turns.length - MAX_TURNS);
  }

  addOutput(id: string, output: Omit<JarvisConversationOutput, "id" | "createdAt">): JarvisConversationOutput {
    const conversation = this.get(id);
    const saved: JarvisConversationOutput = { ...output, id: `out_${randomUUID().slice(0, 8)}`, createdAt: new Date(this.now()).toISOString() };
    conversation.outputs.push(saved);
    if (conversation.outputs.length > MAX_OUTPUTS) conversation.outputs.splice(0, conversation.outputs.length - MAX_OUTPUTS);
    return saved;
  }

  replaceOutput(id: string, outputId: string, text: string): JarvisConversationOutput | undefined {
    const output = this.get(id).outputs.find((entry) => entry.id === outputId);
    if (output) output.text = text;
    return output;
  }

  setPendingAction(id: string, action: Omit<JarvisPendingAction, "id" | "expiresAt">): JarvisPendingAction {
    const pending: JarvisPendingAction = { ...action, id: randomUUID(), expiresAt: this.now() + PENDING_ACTION_MS };
    this.get(id).pendingAction = pending;
    return pending;
  }

  clearPendingAction(id: string): void {
    this.get(id).pendingAction = undefined;
  }

  private evict(): void {
    const cutoff = this.now() - IDLE_MS;
    for (const [key, conversation] of this.conversations) {
      if (conversation.updatedAt < cutoff) this.conversations.delete(key);
    }
    while (this.conversations.size >= MAX_CONVERSATIONS) {
      const oldest = [...this.conversations.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.conversations.delete(oldest.id);
    }
  }
}

export type ResolvedReference =
  | { kind: "resolved"; output: JarvisConversationOutput }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: JarvisConversationOutput[] };

/**
 * Which output "it" means. An id the model named wins if it exists here.
 * Otherwise: the only output, or the one the previous reply produced. Anything
 * else is ambiguous and is asked about, never guessed.
 */
export function resolveOutputReference(conversation: JarvisConversation, namedId: unknown): ResolvedReference {
  if (typeof namedId === "string") {
    const named = conversation.outputs.find((output) => output.id === namedId);
    if (named) return { kind: "resolved", output: named };
  }
  if (conversation.outputs.length === 0) return { kind: "none" };
  if (conversation.outputs.length === 1) return { kind: "resolved", output: conversation.outputs[0] };

  const lastReply = [...conversation.turns].reverse().find((turn) => turn.role === "assistant");
  const justMade = lastReply?.outputId ? conversation.outputs.find((output) => output.id === lastReply.outputId) : undefined;
  if (justMade) return { kind: "resolved", output: justMade };

  return { kind: "ambiguous", candidates: conversation.outputs.slice(-3) };
}
