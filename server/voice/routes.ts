import express from "express";
import { VoiceSettingsInputSchema, VoiceSpeakInputSchema, type VoiceStatus } from "../../shared/voice-types";
import { isFishConfigured, synthesise, transcribe, VoiceError } from "./fish";
import { isVoiceEnabled, setVoiceEnabled } from "./settings";
import { toSpeechText } from "./speech-text";

/**
 * Voice is transport only: it turns speech into text and text into speech.
 * The words go to Hermes through the existing `/api/agent/runs` flow, so there
 * is no voice memory, no voice task store, and no voice approval path.
 */
export const voiceRouter = express.Router();

function status(): VoiceStatus {
  return { enabled: isVoiceEnabled(), configured: isFishConfigured() };
}

function fail(response: express.Response, error: unknown): void {
  if (error instanceof VoiceError) {
    const code = error.reason === "not-configured" || error.reason === "switched-off" ? 503 : error.reason === "empty" ? 422 : 502;
    response.status(code).json({ error: error.message, reason: error.reason });
    return;
  }
  console.error("[agentos] voice request failed:", error);
  response.status(502).json({ error: "Voice failed.", reason: "failed" });
}

function requireEnabled(): void {
  if (!isVoiceEnabled()) throw new VoiceError("Voice is switched off.", "switched-off");
}

voiceRouter.get("/status", (_request, response) => {
  response.json(status());
});

voiceRouter.put("/settings", (request, response) => {
  const parsed = VoiceSettingsInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "enabled must be true or false" });
    return;
  }
  setVoiceEnabled(parsed.data.enabled);
  response.json(status());
});

/** Raw recorded audio in, `{ text }` out. */
voiceRouter.post("/transcribe", express.raw({ type: () => true, limit: "10mb" }), async (request, response) => {
  try {
    requireEnabled();
    const audio = request.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw new VoiceError("No audio was received.", "empty");
    }
    response.json({ text: await transcribe(audio) });
  } catch (error) {
    fail(response, error);
  }
});

/**
 * Hermes' reply in, mp3 out. The text is condensed for speech here so every
 * client speaks the same thing; `X-Voice-Truncated` says whether it was cut.
 */
voiceRouter.post("/speak", async (request, response) => {
  try {
    requireEnabled();
    const parsed = VoiceSpeakInputSchema.safeParse(request.body);
    if (!parsed.success) throw new VoiceError("Text is required.", "empty");

    const speech = toSpeechText(parsed.data.text);
    if (!speech.text) throw new VoiceError("Nothing to say.", "empty");

    const audio = await synthesise(speech.text);
    response
      .set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Truncated": String(speech.truncated) })
      .send(audio);
  } catch (error) {
    fail(response, error);
  }
});
