import {
  JARVIS_PROFILE_JSON_SCHEMA,
  JarvisRequestProfileSchema,
  type JarvisRequestProfile,
} from "../../shared/jarvis-routing-types";
import { extractJson } from "../hermes/worker-review";
import type { OllamaChatMessage } from "../workers/providers/ollama-client";
import type { JarvisConversation } from "./jarvis-conversation-store";
import { JarvisModelError, type JarvisModelClient } from "./jarvis-model-client";
import type { JarvisModelRef, JarvisRoutingConfig } from "./jarvis-routing-config";
import type { JarvisWorkerRegistry } from "./jarvis-worker-registry";

/**
 * Jev's one model call per request: read the request, and either answer it
 * or say where it should go.
 *
 * The answer is checked twice over: zod for shape and internal consistency,
 * then the registry for the worker it names. An invalid reply gets exactly one
 * correction prompt; after that the fallback model is tried once; after that
 * the request fails with a reason. An invalid profile never reaches routing.
 */

/** Room for a short direct answer, or a longer one when asked "in detail". */
const PROFILE_TOKENS = 900;

export type ProfileOutcome =
  | {
      ok: true;
      profile: JarvisRequestProfile;
      model: string;
      decidedBy: "quick_model" | "fallback_model";
      /** Model calls made, including the correction retry and the fallback. */
      calls: number;
    }
  | { ok: false; reason: string; calls: number };

export interface ProfileRequest {
  message: string;
  conversation: JarvisConversation;
  registry: JarvisWorkerRegistry;
  config: JarvisRoutingConfig;
  models: JarvisModelClient;
  now?: Date;
}

export function buildProfilerSystemPrompt(request: Pick<ProfileRequest, "registry" | "config" | "conversation" | "now">): string {
  const now = request.now ?? new Date();
  const outputs = request.conversation.outputs.length
    ? request.conversation.outputs.map((output) => `- ${output.id}: ${output.kind} "${output.title}"`).join("\n")
    : "- none yet";

  return [
    "You are Jev, the request router inside Jarvis, a personal assistant. Read the user's latest message and reply with ONE JSON object and nothing else.",
    `It is ${now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Jarvis addresses the user as "${request.config.address}".`,
    "",
    "intent, pick one:",
    '- chat: greetings, thanks, small talk ("Good morning Jarvis").',
    '- answer: a question you can answer from general knowledge, no tools and no private data ("What is a webhook?").',
    '- retrieve: needs data from the user\'s systems or current/live information ("Which invoices are overdue?", "what\'s the weather").',
    '- task: produce something without changing any external system ("Draft a client proposal", "make it shorter").',
    '- act: changes data or communicates externally ("Send the proposal", "delete that event").',
    "",
    "Rules:",
    '- chat, or a simple answer: execution_policy "answer_directly", response_model "local_fast", and put the reply in direct_response. Chat replies are one or two short sentences in a calm, capable butler voice. Answers are brief (two to four sentences) unless the user asks for detail, then as long as needed.',
    '- A question needing deep reasoning, careful technical depth, maths or multi-step analysis: complexity "high", response_model "strong", execution_policy "delegate", target_worker null, direct_response null.',
    '- retrieve, task or act: execution_policy "delegate", target_worker = one worker id from the list below, direct_response null. Put the details the worker needs in inputs. Never invent data: you cannot see the user\'s systems.',
    '- If no listed worker fits, still delegate with target_worker null.',
    '- Only if missing information would materially change the outcome (for example, which of two drafts, or an email address for sending): needs_clarification true, execution_policy "clarify", and ONE short, specific clarification_question. Do not ask about things a sensible default covers.',
    '- If the message asks for two things in sequence, one of which is an act (e.g. "draft a proposal and send it"), clarify instead: ask whether to draft it first for review.',
    "- \"it\", \"that\", \"the draft\" refer to outputs below. Set inputs.output_id to the id you mean; if you cannot tell which, clarify.",
    "- Never claim an action was done. You only decide.",
    "",
    "Workers:",
    request.registry.describeForPrompt(),
    "",
    "Outputs Jarvis made in this conversation:",
    outputs,
    "",
    "JSON fields: intent, complexity (low|medium|high), requires_tools, requires_current_information, needs_clarification, clarification_question (string|null), target_worker (string|null), response_model (local_fast|strong), execution_policy (answer_directly|delegate|clarify), inputs (object of strings), direct_response (string|null).",
  ].join("\n");
}

function historyMessages(conversation: JarvisConversation): OllamaChatMessage[] {
  return conversation.turns.slice(-8).map((turn) => ({ role: turn.role, content: turn.text }));
}

export type ProfileValidation = { ok: true; profile: JarvisRequestProfile } | { ok: false; issues: string };

/** Shape, consistency, and a worker that exists and can take this intent. */
export function validateProfile(raw: string, registry: JarvisWorkerRegistry): ProfileValidation {
  const json = extractJson(raw);
  if (json === undefined || json === null || typeof json !== "object") return { ok: false, issues: "The reply was not a JSON object." };

  const parsed = JarvisRequestProfileSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") };
  }

  const profile = parsed.data;
  if (profile.target_worker !== null) {
    const worker = registry.get(profile.target_worker);
    if (!worker) {
      return { ok: false, issues: `target_worker "${profile.target_worker}" is not a registered worker. Use one of: ${registry.list().map((entry) => entry.id).join(", ")}, or null.` };
    }
    if (profile.execution_policy === "delegate" && !worker.intents.includes(profile.intent)) {
      return { ok: false, issues: `${worker.id} does not handle "${profile.intent}" requests.` };
    }
  }
  return { ok: true, profile };
}

async function askModel(
  ref: JarvisModelRef,
  messages: OllamaChatMessage[],
  request: ProfileRequest,
): Promise<string> {
  return request.models.chat(ref, messages, {
    jsonSchema: JARVIS_PROFILE_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: PROFILE_TOKENS,
    timeoutMs: request.config.profileTimeoutMs,
    temperature: 0.2,
  });
}

/** Profile with one model: one call, plus one correction call if the first is invalid. */
async function profileWith(
  ref: JarvisModelRef,
  messages: OllamaChatMessage[],
  request: ProfileRequest,
): Promise<{ ok: true; profile: JarvisRequestProfile; calls: number } | { ok: false; reason: string; calls: number; unavailable: boolean }> {
  let first: string;
  try {
    first = await askModel(ref, messages, request);
  } catch (error) {
    const unavailable = error instanceof JarvisModelError && (error.kind === "offline" || error.kind === "model_missing");
    return { ok: false, reason: error instanceof Error ? error.message : "The model failed.", calls: 1, unavailable };
  }

  const checked = validateProfile(first, request.registry);
  if (checked.ok) return { ok: true, profile: checked.profile, calls: 1 };

  const correction: OllamaChatMessage[] = [
    ...messages,
    { role: "assistant", content: first.slice(0, 2_000) },
    {
      role: "user",
      content: `That reply is invalid: ${checked.issues}. Reply again with only the corrected JSON object for my previous message, following every rule.`,
    },
  ];
  let second: string;
  try {
    second = await askModel(ref, correction, request);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The model failed.", calls: 2, unavailable: false };
  }

  const rechecked = validateProfile(second, request.registry);
  return rechecked.ok
    ? { ok: true, profile: rechecked.profile, calls: 2 }
    : { ok: false, reason: `It returned an invalid routing decision twice (${rechecked.issues}).`, calls: 2, unavailable: false };
}

export async function profileRequest(request: ProfileRequest): Promise<ProfileOutcome> {
  const quick = request.config.quick;
  if (!quick) return { ok: false, reason: "No quick model is configured (JARVIS_QUICK_MODEL).", calls: 0 };

  const messages: OllamaChatMessage[] = [
    { role: "system", content: buildProfilerSystemPrompt(request) },
    ...historyMessages(request.conversation),
    { role: "user", content: request.message },
  ];

  const primary = await profileWith(quick, messages, request);
  if (primary.ok) return { ok: true, profile: primary.profile, model: quick.model, decidedBy: "quick_model", calls: primary.calls };

  const fallback = request.config.fallback;
  if (!fallback || fallback.model === quick.model) {
    return {
      ok: false,
      reason: primary.unavailable
        ? `${primary.reason} No fallback model is configured (JARVIS_FALLBACK_MODEL).`
        : `${quick.model}: ${primary.reason}`,
      calls: primary.calls,
    };
  }

  const secondary = await profileWith(fallback, messages, request);
  if (secondary.ok) {
    return { ok: true, profile: secondary.profile, model: fallback.model, decidedBy: "fallback_model", calls: primary.calls + secondary.calls };
  }
  return { ok: false, reason: `${quick.model}: ${primary.reason} Fallback ${fallback.model}: ${secondary.reason}`, calls: primary.calls + secondary.calls };
}
