import { ollamaSettings } from "../ai-stack/settings";
import { DEFAULT_OLLAMA_BASE_URL } from "../route-policy/ollama-config";

/**
 * Which models Jev uses, read from the environment on every request so a
 * changed `.env` applies after a restart and tests can pass their own.
 *
 *   JARVIS_QUICK_MODEL     Ollama model that profiles every request and answers
 *                          simple ones. Unset: Jev routing is off and Jarvis
 *                          behaves as before (small talk locally, the rest to Hermes).
 *   JARVIS_STRONG_MODEL    Where deeper tool-free questions and drafting go: an
 *                          Ollama model name, or `hermes` (the default).
 *   JARVIS_FALLBACK_MODEL  Ollama model that profiles when the quick model is
 *                          down or twice returns an invalid profile. Optional.
 *   JARVIS_ADDRESS         How Jarvis addresses you in quick answers. Default `sir`.
 *
 * Ollama itself is reached at the address configured in Operations → AI Stack
 * (the same one the route policy uses), defaulting to 127.0.0.1:11434.
 */

export type JarvisModelRef = { runtime: "ollama"; model: string } | { runtime: "hermes"; model: "hermes" };

export interface JarvisRoutingConfig {
  ollamaBaseUrl: string;
  quick?: JarvisModelRef & { runtime: "ollama" };
  strong: JarvisModelRef;
  fallback?: JarvisModelRef & { runtime: "ollama" };
  address: string;
  profileTimeoutMs: number;
  strongTimeoutMs: number;
  /** How long a request waits for delegated work before answering "working on it". */
  inlineWaitMs: number;
}

const MODEL_NAME = /^[A-Za-z0-9][\w.:/-]{0,127}$/;

function ollamaModel(value: string | undefined): (JarvisModelRef & { runtime: "ollama" }) | undefined {
  const name = value?.trim();
  return name && MODEL_NAME.test(name) ? { runtime: "ollama", model: name } : undefined;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function jarvisRoutingConfig(env: NodeJS.ProcessEnv = process.env): JarvisRoutingConfig {
  const strongName = env.JARVIS_STRONG_MODEL?.trim();
  const strong: JarvisModelRef =
    !strongName || strongName.toLowerCase() === "hermes" ? { runtime: "hermes", model: "hermes" } : (ollamaModel(strongName) ?? { runtime: "hermes", model: "hermes" });

  return {
    // Deliberately no separate URL setting: the AI Stack one is already
    // checked to be this machine, so Jarvis text never leaves it by accident.
    ollamaBaseUrl: ollamaSettings()?.baseUrl || DEFAULT_OLLAMA_BASE_URL,
    quick: ollamaModel(env.JARVIS_QUICK_MODEL),
    strong,
    fallback: ollamaModel(env.JARVIS_FALLBACK_MODEL),
    address: env.JARVIS_ADDRESS?.trim().slice(0, 40) || "sir",
    profileTimeoutMs: positive(env.JARVIS_PROFILE_TIMEOUT_MS, 20_000),
    strongTimeoutMs: positive(env.JARVIS_STRONG_TIMEOUT_MS, 120_000),
    inlineWaitMs: positive(env.JARVIS_INLINE_WAIT_MS, 1_500),
  };
}

export function describeModel(ref: JarvisModelRef): string {
  return ref.runtime === "hermes" ? "hermes" : ref.model;
}
