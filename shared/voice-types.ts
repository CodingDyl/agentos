import { z } from "zod";

/**
 * What the browser may know about voice. Never the Fish Audio key: only
 * whether one is set.
 */
export const VoiceStatusSchema = z.object({
  /** The operator's own switch. Off means the mic and playback are hidden. */
  enabled: z.boolean(),
  /** A Fish Audio key exists on the server. */
  configured: z.boolean(),
});

export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const VoiceSettingsInputSchema = z.object({ enabled: z.boolean() });

export const VoiceSpeakInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

export type VoiceFailureReason = "not-configured" | "switched-off" | "unauthorized" | "failed" | "empty";

/**
 * How Hermes should sound when you *speak* to Jarvis. Sent ahead of spoken
 * messages only, so typed work on the Agent page keeps its normal voice.
 */
export const SPOKEN_STYLE =
  "(Spoken to Jarvis by voice. Reply as Jarvis: warm, quick, a touch of dry wit, and address me as sir. " +
  "Talk the way a person speaks: one to three short sentences unless I ask for detail, no markdown, lists or headings. " +
  "If you did something, say what in plain words.)";
