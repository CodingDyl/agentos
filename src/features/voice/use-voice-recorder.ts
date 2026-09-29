import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS } from "./voice-model";

/**
 * Records the microphone until stopped, or until you stop talking.
 *
 * `level` (0..1) is the live input loudness, for the visualiser. Silence
 * detection is deliberately simple: once speech has been heard, a second and a
 * half below the threshold ends the recording.
 */

const SPEECH_LEVEL = 0.06;
const SILENCE_MS = 1500;

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
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
  const audioContext = useRef<AudioContext | null>(null);
  const finish = useRef<((audio: Blob | null) => void) | null>(null);
  const discard = useRef(false);
  const autoStop = useRef(onAutoStop);

  useEffect(() => {
    autoStop.current = onAutoStop;
  }, [onAutoStop]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(frame.current);
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

    const mimeType = preferredMimeType();
    const active = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
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

    const context = new AudioContext();
    audioContext.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(media).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const startedAt = performance.now();
    let heardSpeech = false;
    let quietSince = performance.now();

    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      setLevel(Math.min(1, peak * 2));

      const now = performance.now();
      if (peak > SPEECH_LEVEL) {
        heardSpeech = true;
        quietSince = now;
      }

      const silentLongEnough = heardSpeech && now - quietSince > SILENCE_MS;
      if ((silentLongEnough || now - startedAt > MAX_RECORDING_MS) && active.state === "recording") {
        active.stop();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    active.start();
    setIsRecording(true);
    frame.current = requestAnimationFrame(tick);
  }, [teardown]);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    else teardown();
  }, [teardown]);

  return { isRecording, level, start, stop, cancel };
}
