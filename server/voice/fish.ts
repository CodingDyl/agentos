import type { VoiceFailureReason } from "../../shared/voice-types";

/**
 * The only place the Fish Audio key exists. Read from the server environment,
 * never sent to the browser, never echoed in an error.
 *
 * UNVERIFIED against live Fish Audio: written from the public API shape
 * (`POST /v1/tts`, `POST /v1/asr`). If a call fails with `failed`, check the
 * paths and fields here first; they are deliberately confined to this file.
 */

const DEFAULT_BASE_URL = "https://api.fish.audio";
const DEFAULT_MODEL = "s1";
/** Jarvis, from the Fish Audio model page. A public id, not a secret. */
const DEFAULT_VOICE_ID = "05b36da8574341d0803391491850db20";
const TTS_TIMEOUT_MS = 30_000;
const ASR_TIMEOUT_MS = 30_000;

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

async function fishFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const key = apiKey();
  if (!key) {
    throw new VoiceError("FISH_API_KEY is not set in .env.", "not-configured");
  }

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
    throw new VoiceError(`Fish Audio responded with ${response.status}.`, "failed");
  }

  return response;
}

/** Text to mp3 bytes, in the Jarvis voice. */
export async function synthesise(text: string): Promise<Buffer> {
  const response = await fishFetch(
    "/v1/tts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", model: process.env.FISH_MODEL?.trim() || DEFAULT_MODEL },
      body: JSON.stringify({ text, reference_id: voiceId(), format: "mp3", latency: "normal" }),
    },
    TTS_TIMEOUT_MS,
  );

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new VoiceError("Fish Audio returned no audio.", "failed");
  return audio;
}

/** Recorded audio to text. */
export async function transcribe(audio: Buffer, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audio)], { type: mimeType }), "speech");
  form.append("ignore_timestamps", "true");

  const response = await fishFetch("/v1/asr", { method: "POST", body: form }, ASR_TIMEOUT_MS);

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
