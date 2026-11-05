import { Slider } from "@base-ui/react/slider";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatTimestamp } from "@shared/learning-types";
import { cn } from "@/lib/utils";
import { isoDuration, tapeScales } from "./cassette/model";

/**
 * A compact cassette used as an audio player.
 *
 * Pass `audioSrc` to play a file in an `<audio>` element, or pass the clock
 * and callbacks to drive it from somewhere else (Spotify). The reels are CSS
 * variables updated from a frame loop, so spinning does not re-render React.
 *
 * The shell follows the cassette player experiment at dqnamo.com.
 */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const REEL_DEGREES_PER_SECOND = 150;

export type CassetteCaptionTrack = {
  default?: boolean;
  label: string;
  src: string;
  srcLang: string;
};

type SharedProps = {
  /** Small caps line above the title. */
  archiveLabel?: string;
  catalogueNumber?: string;
  className?: string;
  sideLabel?: string;
  /** Opens the full player when the title is activated. */
  titleHref?: string;
  trackTitle?: string;
};

type FilePlayback = SharedProps & {
  audioSrc: string;
  captionTracks?: readonly CassetteCaptionTrack[];
  loop?: boolean;
  onPlaybackError?: (error: unknown) => void;
};

type ControlledPlayback = SharedProps & {
  audioSrc?: undefined;
  currentTime: number;
  disabled?: boolean;
  duration: number;
  isPlaying: boolean;
  muted?: boolean;
  onRestart?: () => void;
  onSeek: (seconds: number) => void;
  onToggleMute?: () => void;
  onTogglePlay: () => void;
};

export type CassettePlayerProps = FilePlayback | ControlledPlayback;

type Clock = {
  currentTime: number;
  disabled: boolean;
  duration: number;
  isPlaying: boolean;
  muted: boolean;
  muteDisabled: boolean;
  restart: () => void;
  seek: (seconds: number) => void;
  toggleMute: () => void;
  togglePlay: () => void;
};

export function CassettePlayer(props: CassettePlayerProps) {
  const file = useFilePlayback(props);
  const clock: Clock = "onTogglePlay" in props ? controlledClock(props) : file.clock;
  const archiveLabel = props.archiveLabel ?? "Archive";
  const sideLabel = props.sideLabel ?? "Side A";
  const catalogueNumber = props.catalogueNumber ?? "";
  const trackTitle = props.trackTitle ?? "Untitled";
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? clock.currentTime;
  const shellRef = useReelMotion(shown, clock.duration, clock.isPlaying && scrub === null);

  const max = Math.max(clock.duration, 0.01);
  const sliderValue = Math.min(Math.max(shown, 0), clock.duration > 0 ? clock.duration : 0);
  const restartDisabled = clock.disabled || shown < 0.35;

  return (
    <section aria-label={`${trackTitle} audio player`} className={cn("w-full", props.className)}>
      {file.audio}
      <div
        ref={shellRef}
        className={cn(
          "relative aspect-[1.58] w-full overflow-hidden rounded-[18px] border border-[#050505] [container-type:inline-size]",
          "bg-[linear-gradient(165deg,#373735_0%,#20201f_52%,#0e0e0d_100%)]",
          "shadow-[0_28px_48px_rgba(0,0,0,0.24),0_8px_16px_rgba(0,0,0,0.18),inset_0_2px_1px_rgba(255,255,255,0.2),inset_0_-3px_3px_rgba(0,0,0,0.74)]",
          "[--label-bg:#f7f4ee] [--label-ink:#1c1916] [--label-border:rgba(247,244,238,0.55)]",
          "[--label-kicker:rgba(28,25,22,0.72)] [--label-catalogue:rgba(28,25,22,0.55)]",
          "[--stripe-one:#16a34a] [--stripe-two:#0d9488] [--stripe-three:#2563eb]",
          "[--thumb-ring:#f7f4ee] [--reel-teeth:#1b1a18]",
          "dark:[--label-bg:#dc2626] dark:[--label-ink:#fff] dark:[--label-border:rgba(0,0,0,0.18)]",
          "dark:[--label-kicker:rgba(255,255,255,0.85)] dark:[--label-catalogue:rgba(255,255,255,0.7)]",
          "dark:[--stripe-one:#fff] dark:[--stripe-two:#fff] dark:[--stripe-three:#fff]",
          "dark:[--thumb-ring:#7f1d1d] dark:[--reel-teeth:#d6d3d1]",
        )}
        style={
          {
            "--reel-rotation": "0deg",
            "--left-tape-scale": "1",
            "--right-tape-scale": "0.58",
          } as CSSProperties
        }
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-[13px] border border-white/12 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.62)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        <Screw className="top-[4%] left-[2.6%]" />
        <Screw className="top-[4%] right-[2.6%]" />
        <Screw className="bottom-[4%] left-[2.6%]" />
        <Screw className="right-[2.6%] bottom-[4%]" />

        <div className="absolute top-[9.5%] right-[8.5%] bottom-[24%] left-[8.5%] flex flex-col overflow-hidden rounded-[9px] bg-[var(--label-bg)] px-[4%] pt-[4%] pb-[2%] text-[var(--label-ink)] shadow-[inset_0_0_12px_rgba(92,74,49,0.12)]">
          <div className="relative z-2 flex shrink-0 items-stretch justify-between gap-2">
            <div className="grid min-w-0 content-between gap-y-1.5">
              <span className="truncate font-mono text-[clamp(8px,2.4cqw,11px)] font-semibold tracking-[0.14em] text-[var(--label-kicker)] uppercase">{archiveLabel}</span>
              <TrackTitle title={trackTitle} href={props.titleHref} />
            </div>
            <div className="grid shrink-0 content-between justify-items-end gap-y-1.5 text-right">
              <span className="rounded-full bg-[var(--label-ink)] px-[0.55em] py-[0.28em] font-mono text-[clamp(8px,2.2cqw,11px)] font-semibold tracking-[0.08em] text-[var(--label-bg)] uppercase">
                {sideLabel}
              </span>
              {catalogueNumber ? (
                <span className="font-mono text-[clamp(7px,2cqw,10px)] tracking-[0.08em] text-[var(--label-catalogue)] uppercase">{catalogueNumber}</span>
              ) : null}
            </div>
          </div>

          <div className="relative z-1 mt-[3%] min-h-0 flex-1">
            <div aria-hidden="true" className="absolute inset-x-0 top-1/2 grid h-[62%] -translate-y-1/2 grid-rows-3 gap-y-1">
              <span className="bg-[var(--stripe-one)]" />
              <span className="bg-[var(--stripe-two)]" />
              <span className="bg-[var(--stripe-three)]" />
            </div>
            <Window />
          </div>

          <div className="relative z-5 shrink-0">
            <Slider.Root
              min={0}
              max={max}
              step={0.01}
              value={sliderValue}
              disabled={clock.disabled || clock.duration <= 0}
              onValueChange={(value) => setScrub(value)}
              onValueCommitted={(value) => {
                setScrub(null);
                clock.seek(value);
              }}
            >
              <Slider.Control className="flex h-5 w-full cursor-pointer touch-none items-center data-disabled:cursor-default">
                <Slider.Track className="relative h-[3px] w-full rounded-full bg-[color-mix(in_srgb,var(--label-ink)_28%,transparent)]">
                  <Slider.Indicator className="h-full rounded-full bg-[var(--label-ink)]" />
                  <Slider.Thumb
                    getAriaLabel={() => `Seek through ${trackTitle}`}
                    getAriaValueText={() => `${formatTimestamp(shown)} of ${formatTimestamp(clock.duration)}`}
                    className="size-[13px] rounded-full border-2 border-[var(--thumb-ring)] bg-white shadow-[0_1px_4px_rgba(37,33,29,0.38)] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--label-ink)]"
                  />
                </Slider.Track>
              </Slider.Control>
            </Slider.Root>
            <div className="flex items-baseline justify-between font-mono text-[clamp(9px,2.4cqw,12px)] tabular-nums">
              <span>
                <span className="sr-only">Elapsed time </span>
                <time dateTime={isoDuration(shown)}>{formatTimestamp(shown)}</time>
              </span>
              <span>
                <span className="sr-only">Total time </span>
                <time dateTime={isoDuration(clock.duration)}>{formatTimestamp(clock.duration)}</time>
              </span>
            </div>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] border-4 border-[var(--label-border)]" />
        </div>

        <div className="absolute right-[22%] bottom-[3.2%] left-[22%] z-4 grid h-[16%] grid-cols-[1fr_auto_1fr] place-items-center gap-x-[clamp(4px,1.6cqw,10px)] bg-[color-mix(in_srgb,#63635e_22%,transparent)] px-[10%] shadow-[inset_0_3px_8px_rgba(0,0,0,0.5)] [clip-path:polygon(12%_0,88%_0,100%_100%,0_100%)]">
          <TransportButton label="Restart track" disabled={restartDisabled} onClick={clock.restart} className="w-[clamp(18px,6.4cqw,32px)] border-[#82827c] bg-[#63635e] hover:bg-[#7c7b74]">
            <RotateCcw className="size-[46%]" strokeWidth={2.25} />
          </TransportButton>
          <TransportButton
            label={clock.isPlaying ? `Pause ${trackTitle}` : `Play ${trackTitle}`}
            disabled={clock.disabled}
            onClick={clock.togglePlay}
            className="w-[clamp(22px,8cqw,43px)] border-[#bcbbb5]/50 bg-[#8d8d86] shadow-[0_3px_8px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-[#82827c]"
          >
            {clock.isPlaying ? <Pause className="size-[46%]" fill="currentColor" strokeWidth={0} /> : <Play className="size-[46%] translate-x-px" fill="currentColor" strokeWidth={0} />}
          </TransportButton>
          <TransportButton
            label={clock.muted ? "Unmute" : "Mute"}
            disabled={clock.disabled || clock.muteDisabled}
            onClick={clock.toggleMute}
            className="w-[clamp(18px,6.4cqw,32px)] border-[#82827c] bg-[#63635e] hover:bg-[#7c7b74]"
          >
            {clock.muted ? <VolumeX className="size-[48%]" strokeWidth={2.25} /> : <Volume2 className="size-[48%]" strokeWidth={2.25} />}
          </TransportButton>
        </div>
      </div>
    </section>
  );
}

function controlledClock(props: ControlledPlayback): Clock {
  return {
    currentTime: props.currentTime,
    duration: props.duration,
    isPlaying: props.isPlaying,
    muted: props.muted ?? false,
    disabled: props.disabled ?? false,
    muteDisabled: !props.onToggleMute,
    togglePlay: props.onTogglePlay,
    seek: props.onSeek,
    restart: props.onRestart ?? (() => props.onSeek(0)),
    toggleMute: props.onToggleMute ?? (() => undefined),
  };
}

function useFilePlayback(props: CassettePlayerProps): { audio: ReactNode; clock: Clock } {
  const src = "audioSrc" in props ? props.audioSrc : undefined;
  const loop = "loop" in props ? props.loop : undefined;
  const tracks = "captionTracks" in props ? props.captionTracks : undefined;
  const onError = "onPlaybackError" in props ? props.onPlaybackError : undefined;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  };

  return {
    audio: src ? (
      <audio ref={audioRef} className="sr-only" loop={loop ?? false} preload="metadata" src={src}>
        {tracks?.map((track) => (
          <track key={`${track.srcLang}:${track.src}`} default={track.default} kind="captions" label={track.label} src={track.src} srcLang={track.srcLang} />
        ))}
      </audio>
    ) : null,
    clock: {
      currentTime,
      duration,
      isPlaying,
      muted,
      disabled: !src,
      muteDisabled: false,
      togglePlay: () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play().catch((error: unknown) => onError?.(error));
        else audio.pause();
      },
      seek,
      restart: () => seek(0),
      toggleMute: () => setMuted((value) => !value),
    },
  };
}

/** Writes reel rotation and spool size onto the shell. Playback time is extrapolated between React renders. */
function useReelMotion(currentTime: number, duration: number, spinning: boolean) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = performance.now();
    let frame = 0;
    const paint = (now: number) => {
      const elapsed = spinning ? Math.max(0, (now - startedAt) / 1000) : 0;
      const time = currentTime + elapsed;
      const scales = tapeScales(duration > 0 ? time / duration : 0);
      node.style.setProperty("--left-tape-scale", scales.left.toFixed(4));
      node.style.setProperty("--right-tape-scale", scales.right.toFixed(4));
      if (!reduce) {
        const rotation = ((time * REEL_DEGREES_PER_SECOND) % 360 + 360) % 360;
        node.style.setProperty("--reel-rotation", `${rotation.toFixed(2)}deg`);
      }
      if (spinning) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [currentTime, duration, spinning]);

  return shellRef;
}

function TrackTitle({ title, href }: { title: string; href?: string }) {
  const className = "block truncate font-sans text-[clamp(12px,4.6cqw,20px)] leading-none font-semibold tracking-[-0.04em]";
  if (!href) return <span className={className}>{title}</span>;
  return (
    <Link to={href} className={cn(className, "rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--label-ink)]")}>
      {title}
    </Link>
  );
}

function Screw({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute z-3 aspect-square w-[3.3%] rounded-full border border-[#060606]",
        "bg-[radial-gradient(circle_at_36%_30%,#5f5f5c,#30302e_48%,#171716_78%)]",
        "shadow-[inset_0_1px_1px_rgba(255,255,255,0.26),0_1px_1px_rgba(0,0,0,0.38)]",
        className,
      )}
    >
      <span className="absolute top-1/2 right-[18%] left-[18%] h-[14%] -translate-y-1/2 rotate-45 rounded-full bg-[#1d1d1b]" />
      <span className="absolute top-1/2 right-[18%] left-[18%] h-[14%] -translate-y-1/2 -rotate-45 rounded-full bg-[#1d1d1b]" />
    </div>
  );
}

function Window() {
  return (
    <div className="absolute inset-x-[17%] inset-y-0 overflow-hidden rounded-full bg-[#12110f] shadow-[0_0_0_4px_var(--label-border),inset_0_3px_8px_rgba(0,0,0,0.58)] [container-type:size]">
      {/* Oversized discs, clipped by the window, so each spool grows as tape winds onto it. */}
      <Tape className="left-[50cqh] scale-[var(--left-tape-scale)]" />
      <Tape className="left-[calc(100%-50cqh)] scale-[var(--right-tape-scale)]" />
      <div aria-hidden="true" className="absolute top-[16%] right-[30%] bottom-[16%] left-[30%] z-2 flex items-center justify-evenly rounded-[3px] border-2 border-[#11100f] bg-[#1c1b18] shadow-[inset_0_2px_5px_rgba(0,0,0,0.72)]">
        {["a", "b", "c", "d", "e"].map((mark) => (
          <span key={mark} className="h-[46%] w-px bg-[rgba(224,215,195,0.32)]" />
        ))}
      </div>
      <Reel className="left-[50cqh]" />
      <Reel className="left-[calc(100%-50cqh)]" />
    </div>
  );
}

function Tape({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute top-1/2 aspect-square h-[148cqh] -translate-x-1/2 -translate-y-1/2 rounded-full will-change-transform",
        "bg-[repeating-radial-gradient(circle,#0a0908_0_1.5px,#241c16_1.5px_3px)]",
        "shadow-[inset_0_0_8px_rgba(0,0,0,0.65)]",
        className,
      )}
    />
  );
}

function Reel({ className }: { className: string }) {
  const teeth = [0, 60, 120, 180, 240, 300];
  return (
    <div className={cn("absolute top-1/2 z-3 aspect-square w-[78cqh] -translate-x-1/2 -translate-y-1/2", className)}>
      <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 origin-center rotate-[var(--reel-rotation)] will-change-transform motion-reduce:rotate-0">
        <circle cx="50" cy="50" r="46" className="fill-[#f4f1ea]" />
        {teeth.map((angle) => (
          <path key={angle} d="M46 4h8v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z" transform={`rotate(${angle} 50 50)`} className="fill-[var(--reel-teeth)]" />
        ))}
        <circle cx="50" cy="50" r="16" className="fill-[#1b1a18]" />
        <circle cx="50" cy="50" r="6" className="fill-[#f4f1ea]" />
      </svg>
    </div>
  );
}

function TransportButton({ label, disabled, onClick, className, children }: { label: string; disabled?: boolean; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid aspect-square cursor-pointer place-items-center rounded-full border text-[#fdfdfc]",
        "shadow-[0_2px_5px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.2)]",
        "transition-[background-color,transform] duration-150 active:scale-[0.96]",
        "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-white",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        className,
      )}
    >
      {children}
    </button>
  );
}
