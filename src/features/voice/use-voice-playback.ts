import { useCallback, useEffect, useRef, useState } from "react";

/** Plays Jarvis's audio, and lets you stop it. */
export function useVoicePlayback(onEnded: () => void) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const ended = useRef(onEnded);

  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  const release = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setIsPlaying(false);
  }, []);

  useEffect(() => release, [release]);

  const stop = useCallback(() => {
    if (!audio.current) return;
    release();
    ended.current();
  }, [release]);

  /** Rejects when the browser refuses to play, so the caller can fall back to text. */
  const play = useCallback(
    async (blob: Blob) => {
      release();
      const element = new Audio();
      url.current = URL.createObjectURL(blob);
      element.src = url.current;
      element.onended = () => {
        release();
        ended.current();
      };
      audio.current = element;
      setIsPlaying(true);
      try {
        await element.play();
      } catch (error) {
        release();
        throw error;
      }
    },
    [release],
  );

  return { isPlaying, play, stop };
}
