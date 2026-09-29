import { useCallback, useEffect, useRef, useState } from "react";

/** Plays one piece of Jarvis's audio at a time, and lets you stop it. */
export function useVoicePlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const settle = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setIsPlaying(false);
    const pending = settle.current;
    settle.current = null;
    pending?.();
  }, []);

  useEffect(() => release, [release]);

  /**
   * Resolves when the audio ends or is stopped. Rejects when the browser
   * refuses to play, so the caller can fall back to text.
   */
  const play = useCallback(
    (blob: Blob) =>
      new Promise<void>((resolve, reject) => {
        release();
        const element = new Audio();
        url.current = URL.createObjectURL(blob);
        element.src = url.current;
        element.onended = release;
        audio.current = element;
        settle.current = resolve;
        setIsPlaying(true);
        element.play().catch((error: unknown) => {
          settle.current = null;
          release();
          reject(error);
        });
      }),
    [release],
  );

  return { isPlaying, play, stop: release };
}
