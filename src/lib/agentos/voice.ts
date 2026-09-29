import { VoiceStatusSchema, type VoiceStatus } from "@shared/voice-types";

/**
 * The browser's side of voice. Audio goes to the server and comes back as
 * audio; the Fish Audio key never exists here.
 */

export class VoiceRequestError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "VoiceRequestError";
  }
}

async function failureFrom(response: Response): Promise<VoiceRequestError> {
  const body = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null;
  return new VoiceRequestError(body?.error ?? "Voice failed.", body?.reason ?? "failed");
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new VoiceRequestError("The AgentOS data adapter is not responding. Is it running?", "offline");
  }
  if (!response.ok) throw await failureFrom(response);
  return response;
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  const parsed = VoiceStatusSchema.safeParse(await (await call("/api/voice/status")).json());
  if (!parsed.success) throw new VoiceRequestError("Voice status was unreadable.", "failed");
  return parsed.data;
}

export async function setVoiceEnabled(enabled: boolean): Promise<VoiceStatus> {
  const response = await call("/api/voice/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return VoiceStatusSchema.parse(await response.json());
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  const response = await call("/api/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
  });
  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new VoiceRequestError("Nothing was heard.", "empty");
  }
  return body.text;
}

/** Hermes' reply as Jarvis audio. */
export async function speakText(text: string): Promise<Blob> {
  const response = await call("/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return response.blob();
}
