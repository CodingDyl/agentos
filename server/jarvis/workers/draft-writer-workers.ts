import type { JarvisWorker, JarvisWorkerContext } from "../jarvis-worker-registry";

/**
 * Writing that stays on this machine until you say otherwise: proposals,
 * emails, notes. Drafting never sends, posts or saves anywhere external; the
 * draft is kept in the conversation so "make it shorter" and "send it" can
 * find it.
 *
 * The writing is done by the configured strong model. A draft is a new thing
 * each time, so a failed run is safe to repeat.
 */

const DRAFT_TOKENS = 1_500;
const NO_FILLER =
  "Write in plain, specific language. No placeholders like [Client Name] unless the detail is genuinely unknown, in which case leave one clearly marked placeholder. Reply with the text only: no preamble, no commentary after it.";

function brief(context: JarvisWorkerContext): string {
  const details = Object.entries(context.inputs)
    .filter(([key, value]) => key !== "output_id" && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`);
  return [`Request: ${context.message}`, ...(details.length ? ["", "Details:", ...details] : [])].join("\n");
}

function titleFor(context: JarvisWorkerContext): string {
  const topic = typeof context.inputs.topic === "string" && context.inputs.topic.trim() ? context.inputs.topic.trim() : context.message.trim();
  const title = topic.replace(/^(please\s+)?(draft|write|create|prepare)\s+(me\s+)?(a|an|the)?\s*/i, "");
  const cleaned = title.charAt(0).toUpperCase() + title.slice(1);
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned || "Draft";
}

function modelFailure(error: unknown): string {
  return error instanceof Error ? error.message : "The writing model failed.";
}

export const draftWriterWorker: JarvisWorker = {
  id: "writer.draft",
  name: "Draft writer",
  description: "Drafts new text (a client proposal, an email, a summary, notes). Only drafts: never sends or saves anywhere outside AgentOS.",
  capabilities: ["write:draft"],
  intents: ["task"],
  requiredInputs: [{ name: "topic", description: "What to draft, e.g. 'proposal for Acme's website rebuild'" }],
  optionalInputs: [
    { name: "audience", description: "Who it is for" },
    { name: "length", description: "short, medium or long" },
  ],
  safeRetry: true,
  async run(context) {
    let text: string;
    try {
      text = await context.models.chat(
        context.config.strong,
        [
          { role: "system", content: `You draft text for a busy professional. ${NO_FILLER}` },
          { role: "user", content: brief(context) },
        ],
        { maxTokens: DRAFT_TOKENS, timeoutMs: context.config.strongTimeoutMs, temperature: 0.5 },
      );
    } catch (error) {
      return { status: "failed", reply: `I couldn't write the draft: ${modelFailure(error)} Nothing was saved or sent.` };
    }

    const output = context.store.addOutput(context.conversationId, { kind: "draft", title: titleFor(context), text: text.trim(), workerId: "writer.draft" });
    return {
      status: "completed",
      reply: `Draft ready: ${output.title}. It's on screen. Nothing has been sent. Tell me what to change, or say send it to someone.`,
      display: output.text,
      output,
    };
  },
};

export const draftReviserWorker: JarvisWorker = {
  id: "writer.revise",
  name: "Draft reviser",
  description: "Changes a draft Jarvis already wrote in this conversation (shorter, more formal, add a section). Never sends.",
  capabilities: ["write:draft"],
  intents: ["task"],
  requiredInputs: [{ name: "output_id", description: "The draft to change", source: "output_reference" }],
  optionalInputs: [{ name: "instruction", description: "What to change, e.g. 'make it shorter'" }],
  safeRetry: true,
  async run(context) {
    const draft = context.output;
    if (!draft) return { status: "needs_input", reply: "Which draft should I change?" };
    const instruction = typeof context.inputs.instruction === "string" && context.inputs.instruction.trim() ? context.inputs.instruction.trim() : context.message;

    let text: string;
    try {
      text = await context.models.chat(
        context.config.strong,
        [
          { role: "system", content: `You revise a draft exactly as asked and keep everything else. ${NO_FILLER}` },
          { role: "user", content: `Change requested: ${instruction}\n\n--- DRAFT ---\n${draft.text}` },
        ],
        { maxTokens: DRAFT_TOKENS, timeoutMs: context.config.strongTimeoutMs, temperature: 0.3 },
      );
    } catch (error) {
      return { status: "failed", reply: `I couldn't revise the draft: ${modelFailure(error)} The previous version is unchanged.` };
    }

    const updated = context.store.replaceOutput(context.conversationId, draft.id, text.trim()) ?? draft;
    return { status: "completed", reply: `Updated: ${updated.title}. It's on screen. Nothing has been sent.`, display: updated.text, output: updated };
  },
};
