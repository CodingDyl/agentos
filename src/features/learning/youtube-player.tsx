import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { saveProgress } from "@/lib/agentos/learning";

/**
 * A saved video, played through YouTube's own embedded player.
 *
 * The IFrame Player API is what lets AgentOS read the playback position — to
 * resume where the person left off, and to stamp a captured learning with
 * the moment it was captured. The privacy-enhanced host is used, and the
 * video is only ever streamed by YouTube; nothing is downloaded.
 *
 * Progress is saved every few seconds while playing, on pause, at the end,
 * and when the player goes away (with `keepalive`, so leaving the page still
 * records where it stopped).
 */

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: () => void; onStateChange?: (event: { data: number }) => void; onError?: (event: { data: number }) => void };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const PAUSED = 2;
const ENDED = 0;
const SAVE_EVERY_MS = 5_000;

let apiLoading: Promise<YTNamespace> | undefined;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiLoading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiLoading = undefined;
      reject(new Error("YouTube's player could not be loaded. Are you online?"));
    };
    document.head.appendChild(script);
  });
  return apiLoading;
}

export interface YouTubePlayerHandle {
  /** Seconds into the video, or undefined before it is ready. */
  currentTime(): number | undefined;
  seekTo(seconds: number): void;
  pause(): void;
  play(): void;
  isPlaying(): boolean;
}

export interface YouTubePlayerProps {
  sourceId: string;
  videoId: string;
  startSeconds: number;
  title: string;
  /** Bumped to seek to `startSeconds` again for the same video (opening a learning's timestamp). */
  seekKey?: string;
  className?: string;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(function YouTubePlayer(
  { sourceId, videoId, startSeconds, title, seekKey, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | undefined>(undefined);
  const ready = useRef(false);
  const current = useRef({ sourceId, videoId });
  const [error, setError] = useState<string>();

  const save = (keepalive = false) => {
    const instance = player.current;
    if (!instance || !ready.current) return;
    const position = instance.getCurrentTime();
    const duration = instance.getDuration();
    if (Number.isFinite(position) && position > 0) {
      void saveProgress(current.current.sourceId, position, Number.isFinite(duration) && duration > 0 ? duration : undefined, keepalive);
    }
  };

  useImperativeHandle(ref, () => ({
    currentTime: () => (player.current && ready.current ? player.current.getCurrentTime() : undefined),
    seekTo: (seconds) => player.current?.seekTo(seconds, true),
    pause: () => player.current?.pauseVideo(),
    play: () => player.current?.playVideo(),
    isPlaying: () => player.current?.getPlayerState() === PLAYING,
  }));

  // One player for the life of the component; later videos load into it.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    loadApi()
      .then((YT) => {
        if (cancelled || !host.current) return;
        const mount = document.createElement("div");
        host.current.replaceChildren(mount);
        player.current = new YT.Player(mount, {
          videoId: current.current.videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { start: startSeconds, rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => {
              ready.current = true;
            },
            onStateChange: ({ data }) => {
              if (data === PLAYING) {
                timer ??= setInterval(() => save(), SAVE_EVERY_MS);
              } else {
                if (timer) clearInterval(timer);
                timer = undefined;
                if (data === PAUSED || data === ENDED) save();
              }
            },
            onError: ({ data }) =>
              setError(data === 101 || data === 150 ? "The owner of this video doesn't allow it to play outside YouTube. Open it on YouTube instead." : "YouTube couldn't play this video."),
          },
        });
      })
      .catch((failure: Error) => setError(failure.message));

    const onLeave = () => save(true);
    window.addEventListener("pagehide", onLeave);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onLeave);
      if (timer) clearInterval(timer);
      save(true);
      player.current?.destroy();
      player.current = undefined;
      ready.current = false;
    };
    // The player is created once; video changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different video, or a request to jump to a moment in this one.
  useEffect(() => {
    const instance = player.current;
    if (!instance || !ready.current) {
      current.current = { sourceId, videoId };
      return;
    }
    if (current.current.videoId !== videoId) {
      save();
      current.current = { sourceId, videoId };
      setError(undefined);
      instance.loadVideoById({ videoId, startSeconds });
    } else {
      instance.seekTo(startSeconds, true);
      instance.playVideo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, sourceId, seekKey]);

  return (
    <div className={className}>
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <div ref={host} className="absolute inset-0 [&>iframe]:size-full" aria-label={`Video: ${title}`} />
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error}
        </p>
      ) : null}
    </div>
  );
});
