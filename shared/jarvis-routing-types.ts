import { z } from "zod";

/**
 * Jev's routing of what is said to Jarvis.
 *
 * Every request is profiled once by a quick local model, and the profile
 * decides what happens next: answer it in the same call, ask one question,
 * send it to a stronger model, or hand it to a registered worker.
 *
 * The profile is model output, so it is data to be checked, never authority.
 * It can name a worker, but only a worker in the registry is accepted, and an
 * action still passes the same connector permission checks as a button press
 * would. Nothing in a profile can grant a permission.
 */

export const JARVIS_ROUTING_VERSION = "jarvis-routing/1";

/** What a request needs. Complexity and clarification are separate fields, not types. */
export const JarvisRequestIntentSchema = z.enum(["chat", "answer", "retrieve", "task", "act"]);
export const JarvisRequestComplexitySchema = z.enum(["low", "medium", "high"]);
export const JarvisResponseModelSchema = z.enum(["local_fast", "strong"]);
export const JarvisExecutionPolicySchema = z.enum(["answer_directly", "delegate", "clarify"]);

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

/** Values a worker reads. Flat and small: a worker never receives nested model output. */
export const JarvisProfileInputsSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
  .refine((inputs) => Object.keys(inputs).length <= 12, { message: "At most 12 inputs." });

/**
 * The quick model's reading of one request. Field names are snake_case
 * because this is the exact JSON the model is asked to produce.
 */
export const JarvisRequestProfileSchema = z
  .object({
    intent: JarvisRequestIntentSchema,
    complexity: JarvisRequestComplexitySchema,
    requires_tools: z.boolean(),
    requires_current_information: z.boolean(),
    needs_clarification: z.boolean(),
    clarification_question: nullableText(400),
    target_worker: nullableText(64),
    response_model: JarvisResponseModelSchema,
    execution_policy: JarvisExecutionPolicySchema,
    inputs: JarvisProfileInputsSchema,
    direct_response: nullableText(4000),
  })
  .strict()
  .superRefine((profile, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });

    if (profile.execution_policy === "clarify" || profile.needs_clarification) {
      if (!profile.clarification_question) issue("clarification_question", "A clarification needs its question.");
      if (profile.execution_policy !== "clarify") issue("execution_policy", "needs_clarification true means execution_policy \"clarify\".");
      return;
    }

    if (profile.execution_policy === "answer_directly") {
      if (profile.intent !== "chat" && profile.intent !== "answer") {
        issue("execution_policy", "Only chat and answer can be answered directly.");
      }
      if (profile.requires_tools || profile.requires_current_information) {
        issue("execution_policy", "A request needing tools or current information cannot be answered directly.");
      }
      if (profile.response_model !== "local_fast") issue("response_model", "answer_directly is the local_fast model's own answer.");
      if (!profile.direct_response) issue("direct_response", "answer_directly needs direct_response.");
    }

    if (profile.execution_policy === "delegate") {
      // A retrieve, task or act with no worker is valid: it means none fits,
      // and the router says so rather than guessing one.
      const toolFree = (profile.intent === "chat" || profile.intent === "answer") && !profile.requires_tools && !profile.requires_current_information;
      if (toolFree && profile.response_model !== "strong" && !profile.target_worker) {
        issue("response_model", "A tool-free question is delegated only to the strong model.");
      }
    }
  });

/** One thing Jarvis produced in this conversation, so "make it shorter" and "send it" can find it. */
export const JarvisConversationOutputSchema = z.object({
  id: z.string(),
  kind: z.enum(["draft"]),
  title: z.string(),
  text: z.string(),
  createdAt: z.string(),
  /** The worker that wrote it. */
  workerId: z.string(),
});

export const JarvisConverseRequestSchema = z.object({
  /** Made by the browser once per Jarvis session. Not a secret: it only keys short-lived state. */
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  message: z.string().trim().min(1).max(4000),
});

/**
 * What happened to one request.
 *
 * - `answered`               Jarvis answered (quick model, or the strong model in time).
 * - `clarify`                One focused question; nothing ran.
 * - `delegated`              A worker or the strong model is working; poll `job`.
 * - `awaiting_confirmation`  An action is ready and waits for you to say confirm.
 * - `handoff`                Handed to Hermes through the existing agent run flow.
 * - `unsupported`            No registered worker can do it. Says what is missing.
 * - `failed`                 Profiling or the work failed. Says why; nothing was executed.
 * - `not_configured`         Jev routing is off (no quick model set); the browser uses the old path.
 */
export const JarvisOutcomeSchema = z.enum([
  "answered",
  "clarify",
  "delegated",
  "awaiting_confirmation",
  "handoff",
  "unsupported",
  "failed",
  "not_configured",
]);

export const JarvisRouteSummarySchema = z.object({
  intent: JarvisRequestIntentSchema.optional(),
  complexity: JarvisRequestComplexitySchema.optional(),
  executionPolicy: JarvisExecutionPolicySchema.optional(),
  workerId: z.string().optional(),
  /** The model that produced the answer or the profile, e.g. `qwen3:4b`. */
  model: z.string().optional(),
  /** Who decided: the quick model, the fallback model, a deterministic confirmation, or nobody. */
  decidedBy: z.enum(["quick_model", "fallback_model", "confirmation", "none"]),
});

export const JarvisJobStatusSchema = z.enum(["running", "completed", "failed", "awaiting_confirmation", "needs_input"]);

export const JarvisJobSchema = z.object({
  id: z.string(),
  status: JarvisJobStatusSchema,
  workerId: z.string().optional(),
  model: z.string().optional(),
  /** What Jarvis says about it. Set once the job is no longer running. */
  reply: z.string().optional(),
  /** Longer text to show but not read aloud (a draft). */
  display: z.string().optional(),
  output: JarvisConversationOutputSchema.pick({ id: true, kind: true, title: true }).optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});

export const JarvisConverseResponseSchema = z.object({
  requestId: z.string(),
  conversationId: z.string(),
  outcome: JarvisOutcomeSchema,
  /** What Jarvis says. Short enough to speak. */
  reply: z.string(),
  /** Longer text shown under the reply, never spoken (a draft, a list). */
  display: z.string().optional(),
  route: JarvisRouteSummarySchema,
  job: JarvisJobSchema.optional(),
  /** Set on `handoff`: the request goes to Hermes as you said it, not as a model rewrote it. */
  handoff: z.object({ workerId: z.literal("hermes"), message: z.string() }).optional(),
});

export type JarvisRequestIntent = z.infer<typeof JarvisRequestIntentSchema>;
export type JarvisRequestComplexity = z.infer<typeof JarvisRequestComplexitySchema>;
export type JarvisRequestProfile = z.infer<typeof JarvisRequestProfileSchema>;
export type JarvisProfileInputs = z.infer<typeof JarvisProfileInputsSchema>;
export type JarvisConversationOutput = z.infer<typeof JarvisConversationOutputSchema>;
export type JarvisConverseRequest = z.infer<typeof JarvisConverseRequestSchema>;
export type JarvisOutcome = z.infer<typeof JarvisOutcomeSchema>;
export type JarvisRouteSummary = z.infer<typeof JarvisRouteSummarySchema>;
export type JarvisJobStatus = z.infer<typeof JarvisJobStatusSchema>;
export type JarvisJob = z.infer<typeof JarvisJobSchema>;
export type JarvisConverseResponse = z.infer<typeof JarvisConverseResponseSchema>;

/**
 * The JSON Schema handed to Ollama's structured output (`format`). Kept
 * beside the zod schema so the two are read together; zod remains the check.
 */
export const JARVIS_PROFILE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "complexity",
    "requires_tools",
    "requires_current_information",
    "needs_clarification",
    "clarification_question",
    "target_worker",
    "response_model",
    "execution_policy",
    "inputs",
    "direct_response",
  ],
  properties: {
    intent: { type: "string", enum: JarvisRequestIntentSchema.options },
    complexity: { type: "string", enum: JarvisRequestComplexitySchema.options },
    requires_tools: { type: "boolean" },
    requires_current_information: { type: "boolean" },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string", "null"] },
    target_worker: { type: ["string", "null"] },
    response_model: { type: "string", enum: JarvisResponseModelSchema.options },
    execution_policy: { type: "string", enum: JarvisExecutionPolicySchema.options },
    inputs: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } },
    direct_response: { type: ["string", "null"] },
  },
} as const;
