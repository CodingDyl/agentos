import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS } from "./voice-model";

/**
 * Records the microphone until stopped, or until you stop talking.
 *
 * `level` (0..1) is the live input loudness, for the visualiser. Silence
 * detection is deliberately simple: once speech has been heard, a second and a
 * half below the threshold ends the recording.
 *
 * Only getting the microphone can fail the recording. The level meter is a
 * nicety: if the browser will not give us one, recording still works, it just
 * ends when you press again (or at the time limit) instead of on silence.
 */

const SPEECH_LEVEL = 0.06;
const SILENCE_MS = 1500;

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
}

/** The best recorder the browser will give, falling back to its own default format. */
function createRecorder(media: MediaStream): MediaRecorder {
  const mimeType = preferredMimeType();
  if (mimeType) {
    try {
      return new MediaRecorder(media, { mimeType });
    } catch {
      // Fall through to the browser's default.
    }
  }
  return new MediaRecorder(media);
}

/** A function that reads the current input loudness, or undefined if metering is unavailable. */
function createMeter(media: MediaStream, keep: (context: AudioContext) => void): (() => number) | undefined {
  try {
    const context = new AudioContext();
    keep(context);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(media).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      return peak;
    };
  } catch {
    return undefined;
  }
}

export interface VoiceRecorder {
  isRecording: boolean;
  level: number;
  start: () => Promise<void>;
  /** Ends the recording and resolves with the audio (null if none was captured). */
  stop: () => Promise<Blob | null>;
  /** Ends the recording and throws it away. */
  cancel: () => void;
}

export function useVoiceRecorder(onAutoStop: (audio: Blob | null) => void): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const frame = useRef<number>(0);
  const maxTimer = useRef<number>(0);
  const audioContext = useRef<AudioContext | null>(null);
  const finish = useRef<((audio: Blob | null) => void) | null>(null);
  const discard = useRef(false);
  const autoStop = useRef(onAutoStop);

  useEffect(() => {
    autoStop.current = onAutoStop;
  }, [onAutoStop]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(frame.current);
    window.clearTimeout(maxTimer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
    setLevel(0);
    setIsRecording(false);
  }, []);

  useEffect(() => () => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    teardown();
  }, [teardown]);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const active = recorder.current;
        if (!active || active.state !== "recording") return resolve(null);
        finish.current = resolve;
        active.stop();
      }),
    [],
  );

  const start = useCallback(async () => {
    if (recorder.current?.state === "recording") return;

    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.current = media;
    chunks.current = [];
    discard.current = false;

    let active: MediaRecorder;
    try {
      active = createRecorder(media);
    } catch (error) {
      // Permission was granted; what failed is recording. Do not leave the
      // microphone (and the browser's recording light) on.
      teardown();
      throw error;
    }
    recorder.current = active;

    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    active.onstop = () => {
      const audio = discard.current || chunks.current.length === 0 ? null : new Blob(chunks.current, { type: active.mimeType });
      teardown();
      const resolve = finish.current;
      finish.current = null;
      if (resolve) resolve(audio);
      else if (!discard.current) autoStop.current(audio);
    };

    // The time limit does not depend on the meter, so it holds either way.
    maxTimer.current = window.setTimeout(() => {
      if (active.state === "recording") active.stop();
    }, MAX_RECORDING_MS);

    const meter = createMeter(media, (context) => {
      audioContext.current = context;
    });

    if (meter) {
      let heardSpeech = false;
      let quietSince = performance.now();

      const tick = () => {
        const peak = meter();
        setLevel(Math.min(1, peak * 2));

        const now = performance.now();
        if (peak > SPEECH_LEVEL) {
          heardSpeech = true;
          quietSince = now;
        }

        if (heardSpeech && now - quietSince > SILENCE_MS && active.state === "recording") {
          active.stop();
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    }

    active.start();
    setIsRecording(true);
  }, [teardown]);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    else teardown();
  }, [teardown]);

  return { isRecording, level, start, stop, cancel };
}
