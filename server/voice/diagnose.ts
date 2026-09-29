import { isFishConfigured, synthesise, transcribe, VoiceError } from "./fish";
import { isVoiceEnabled } from "./settings";

/**
 * Asks Fish Audio directly whether each half of voice works, and how fast.
 *
 * When "no sound comes back", the fault is in one of four places (the browser,
 * Hermes, Fish speaking, Fish listening), and guessing costs hours. This takes
 * Hermes and the browser out: it speaks one short line, and transcribes one
 * second of silence, and reports what Fish said, with timings. It spends a
 * fraction of a cent of Fish credit each time it is run.
 */

export interface StepResult {
  ok: boolean;
  ms: number;
  /** What Fish answered with, when it did not work. */
  error?: string;
  /** Audio bytes returned by text to speech. */
  bytes?: number;
  note?: string;
}

export interface VoiceDiagnosis {
  enabled: boolean;
  configured: boolean;
  tts?: StepResult;
  asr?: StepResult;
}

/** One second of 16 kHz mono silence, as WAV. */
function silentWav(): Buffer {
  const samples = 16_000;
  const data = samples * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + data, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data, 40);
  return wav;
}

async function timed(step: () => Promise<Omit<StepResult, "ms">>): Promise<StepResult> {
  const started = performance.now();
  try {
    const result = await step();
    return { ...result, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error instanceof VoiceError ? `${error.reason}: ${error.message}` : error instanceof Error ? error.message : "unknown error",
    };
  }
}

export async function diagnoseVoice(): Promise<VoiceDiagnosis> {
  const base = { enabled: isVoiceEnabled(), configured: isFishConfigured() };
  if (!base.configured) return base;

  const [tts, asr] = await Promise.all([
    timed(async () => {
      const audio = await synthesise("Good morning, sir. Voice check.");
      return { ok: true, bytes: audio.length };
    }),
    timed(async () => {
      try {
        await transcribe(silentWav());
        return { ok: true, note: "Fish accepted the audio and returned text." };
      } catch (error) {
        // Silence has nothing to transcribe. Fish answering "nothing heard" proves
        // the request reached it and the audio was readable.
        if (error instanceof VoiceError && error.reason === "empty") {
          return { ok: true, note: "Fish accepted the audio; there was nothing to hear, as expected." };
        }
        throw error;
      }
    }),
  ]);

  return { ...base, tts, asr };
}
