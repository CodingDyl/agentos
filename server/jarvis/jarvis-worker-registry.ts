import type { JarvisConversationOutput, JarvisProfileInputs, JarvisRequestIntent } from "../../shared/jarvis-routing-types";
import type { JarvisConversation, JarvisConversationStore } from "./jarvis-conversation-store";
import type { JarvisModelClient } from "./jarvis-model-client";
import type { JarvisRoutingConfig } from "./jarvis-routing-config";

/**
 * The workers Jev may delegate to.
 *
 * A worker id from the model is accepted only if it is registered here and
 * the worker supports the request's intent. Each entry describes itself
 * (capabilities, intents, required inputs) and that description is what the
 * quick model is shown, so the registry is also the routing prompt's source
 * of truth.
 */

export interface JarvisWorkerInput {
  name: string;
  description: string;
  /**
   * `output_reference` inputs are not typed by you: they are resolved from
   * what Jarvis produced earlier ("it", "the draft"), or asked about.
   */
  source?: "request" | "output_reference";
}

export interface JarvisWorkerContext {
  conversationId: string;
  /** Exactly what you said. */
  message: string;
  inputs: JarvisProfileInputs;
  conversation: JarvisConversation;
  store: JarvisConversationStore;
  models: JarvisModelClient;
  config: JarvisRoutingConfig;
  /** Set when the worker declared an `output_reference` input and it resolved. */
  output?: JarvisConversationOutput;
}

export type JarvisWorkerStatus = "completed" | "failed" | "needs_input" | "awaiting_confirmation";

export interface JarvisWorkerResult {
  status: JarvisWorkerStatus;
  /** Short, speakable. */
  reply: string;
  /** Longer text to show and not read aloud. */
  display?: string;
  output?: JarvisConversationOutput;
}

export interface JarvisWorker {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  intents: JarvisRequestIntent[];
  requiredInputs: JarvisWorkerInput[];
  optionalInputs?: JarvisWorkerInput[];
  /** Whether a failed run may be repeated without risk of doing something twice. */
  safeRetry: boolean;
  /**
   * Handed to Hermes through the browser's existing agent-run flow instead of
   * run here. Hermes then applies its own skills and approvals.
   */
  handoff?: boolean;
  /** Whether it can take work right now. Absent means always. */
  available?(): { ok: true } | { ok: false; reason: string };
  run?(context: JarvisWorkerContext): Promise<JarvisWorkerResult>;
  /**
   * Runs an action you have confirmed. Reached only from the deterministic
   * confirmation path, never from a model's profile.
   */
  executeConfirmed?(context: JarvisWorkerContext & { pendingInputs: Record<string, string> }): Promise<JarvisWorkerResult>;
}

export class JarvisWorkerRegistry {
  private readonly workers = new Map<string, JarvisWorker>();

  register(worker: JarvisWorker): this {
    if (this.workers.has(worker.id)) throw new Error(`Jarvis worker ${worker.id} is registered twice.`);
    if (!worker.handoff && !worker.run) throw new Error(`Jarvis worker ${worker.id} has no run().`);
    this.workers.set(worker.id, worker);
    return this;
  }

  get(id: string | null | undefined): JarvisWorker | undefined {
    return id ? this.workers.get(id) : undefined;
  }

  list(): JarvisWorker[] {
    return [...this.workers.values()];
  }

  /** The registry as the quick model sees it. */
  describeForPrompt(): string {
    return this.list()
      .map((worker) => {
        const inputs = [
          ...worker.requiredInputs.filter((input) => input.source !== "output_reference").map((input) => `${input.name} (required): ${input.description}`),
          ...(worker.optionalInputs ?? []).map((input) => `${input.name} (optional): ${input.description}`),
        ];
        const reference = worker.requiredInputs.some((input) => input.source === "output_reference")
          ? " Works on something Jarvis made earlier; set inputs.output_id when you know which."
          : "";
        return `- ${worker.id} [${worker.intents.join(", ")}]: ${worker.description}${reference}${inputs.length ? ` Inputs: ${inputs.join("; ")}.` : ""}`;
      })
      .join("\n");
  }
}
