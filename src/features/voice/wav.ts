/**
 * Recordings leave the browser as WAV.
 *
 * `MediaRecorder` produces WebM/Opus in Chrome and MP4 in Safari, and whether a
 * speech service reads those depends on its decoder. 16-bit mono WAV is the one
 * format every one of them reads. Speech needs nothing like the recorder's
 * 48 kHz, so it is also brought down to 16 kHz, which makes the upload about a
 * tenth of the size.
 *
 * The arithmetic is separate from the browser API so it can be tested.
 */

/** Enough for speech recognition, and what most models are trained on. */
export const SPEECH_SAMPLE_RATE = 16_000;

/** Averages channels into one. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];

  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

/** Linear-interpolation resampling: plenty for speech going to a recogniser. */
export function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const fraction = position - index;
    out[i] = samples[index] * (1 - fraction) + samples[next] * fraction;
  }
  return out;
}

/** 16-bit PCM mono WAV, header included. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/**
 * The recording as 16 kHz mono WAV. If the browser cannot decode its own
 * recording, the original is returned untouched: better to send what we have
 * than to fail before asking.
 */
export async function toSpeechWav(recording: Blob): Promise<Blob> {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const speech = resample(mixToMono(channels), decoded.sampleRate, SPEECH_SAMPLE_RATE);
    return new Blob([new Uint8Array(encodeWav(speech, SPEECH_SAMPLE_RATE))], { type: "audio/wav" });
  } catch {
    return recording;
  } finally {
    void context?.close().catch(() => undefined);
  }
}
