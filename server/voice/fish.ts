import type { VoiceFailureReason } from "../../shared/voice-types";
import { authorize } from "../connectors/policy";
import { encodeMsgpack } from "./msgpack";

/**
 * The only place the Fish Audio key exists. Read from the server environment,
 * never sent to the browser, never echoed in an error.
 *
 * The request shapes follow Fish Audio's official Python SDK (fish-audio-sdk
 * 1.3.0): both `POST /v1/tts` and `POST /v1/asr` are sent as
 * `application/msgpack`, and `/v1/asr` takes the audio as a binary field.
 * The bodies below carry the same fields, with the same defaults, as the SDK's
 * own request models. Everything Fish-specific stays in this file.
 */

const DEFAULT_BASE_URL = "https://api.fish.audio";
const DEFAULT_MODEL = "s1";
/** Jarvis, from the Fish Audio model page. A public id, not a secret. */
const DEFAULT_VOICE_ID = "05b36da8574341d0803391491850db20";
const TTS_TIMEOUT_MS = 30_000;
const ASR_TIMEOUT_MS = 30_000;
/** How much of Fish's own error text is passed on. Enough to diagnose, not a wall. */
const ERROR_DETAIL_CHARS = 200;

export class VoiceError extends Error {
  constructor(
    message: string,
    readonly reason: VoiceFailureReason,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

function apiKey(): string | undefined {
  return process.env.FISH_API_KEY?.trim() || undefined;
}

export function isFishConfigured(): boolean {
  return apiKey() !== undefined;
}

function baseUrl(): string {
  return (process.env.FISH_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function voiceId(): string {
  return process.env.FISH_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
}

/** What Fish said was wrong, in a line: its `message`/`detail` if it sent JSON, else the raw text. */
async function readErrorDetail(response: Response): Promise<string> {
  const raw = (await response.text().catch(() => "")).trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as { message?: unknown; detail?: unknown; error?: unknown };
    const field = [parsed.message, parsed.detail, parsed.error].find((value) => typeof value === "string" && value.length > 0);
    if (typeof field === "string") return field.slice(0, ERROR_DETAIL_CHARS);
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return raw.replace(/\s+/g, " ").slice(0, ERROR_DETAIL_CHARS);
}

async function fishFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const key = apiKey();
  if (!key) {
    throw new VoiceError("FISH_API_KEY is not set in .env.", "not-configured");
  }

  // Jarvis speaks and listens because a person asked; the Connectors switch
  // (Jarvis's own voice switch) and each capability's policy still apply.
  const decision = authorize(path === "/v1/asr" ? "fish.speech_to_text" : "fish.text_to_speech", { initiator: "person" });
  if (!decision.allowed) throw new VoiceError(decision.reason, "not-configured");

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new VoiceError("Could not reach Fish Audio.", "failed");
  }

  if (response.status === 401 || response.status === 403) {
    throw new VoiceError("Fish Audio rejected the API key.", "unauthorized");
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    // Logged where the operator can see it, as well as returned: the status
    // alone rarely says what Fish objected to.
    console.error(`[agentos] Fish Audio ${path} responded ${response.status}${detail ? `: ${detail}` : ""}`);
    throw new VoiceError(`Fish Audio responded with ${response.status}${detail ? `: ${detail}` : ""}.`, "failed");
  }

  return response;
}

/** The SDK's own TTS request, field for field, with the SDK's defaults. */
function ttsBody(text: string) {
  return {
    text,
    chunk_length: 200,
    format: "mp3",
    sample_rate: null,
    mp3_bitrate: 128,
    opus_bitrate: 32,
    references: [],
    reference_id: voiceId(),
    normalize: true,
    latency: "balanced",
    prosody: null,
    top_p: 0.7,
    temperature: 0.7,
  };
}

/** Text to mp3 bytes, in the Jarvis voice. */
export async function synthesise(text: string): Promise<Buffer> {
  const response = await fishFetch(
    "/v1/tts",
    {
      method: "POST",
      headers: { "Content-Type": "application/msgpack", model: process.env.FISH_MODEL?.trim() || DEFAULT_MODEL },
      body: new Uint8Array(encodeMsgpack(ttsBody(text))),
    },
    TTS_TIMEOUT_MS,
  );

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new VoiceError("Fish Audio returned no audio.", "failed");
  return audio;
}

/**
 * Recorded audio to text. `language: null` lets Fish work out the language;
 * timestamps are not wanted, so they are switched off.
 */
export async function transcribe(audio: Buffer): Promise<string> {
  const response = await fishFetch(
    "/v1/asr",
    {
      method: "POST",
      headers: { "Content-Type": "application/msgpack" },
      body: new Uint8Array(encodeMsgpack({ audio: new Uint8Array(audio), language: null, ignore_timestamps: true })),
    },
    ASR_TIMEOUT_MS,
  );

  let payload: { text?: unknown };
  try {
    payload = (await response.json()) as { text?: unknown };
  } catch {
    throw new VoiceError("Fish Audio returned an unreadable transcript.", "failed");
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) throw new VoiceError("Nothing was heard.", "empty");
  return text;
}
