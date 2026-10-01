import { Music, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSpotifyPlaylists } from "@/lib/agentos/learning";
import { useFocusSession } from "./focus-session-context";
import { formatElapsed, interpolatedProgress } from "./learning-model";
import { useOptionalSpotify } from "./spotify-context-value";

/**
 * The shell's media corner: the focus session, when one is running, and a
 * small Spotify player while something is playing. Rendered in the sidebar of
 * every page from one place above the routes, so neither resets on navigation.
 */

const ICON_BUTTON =
  "os-focus-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-os-muted transition-colors hover:bg-os-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export function MediaDock() {
  const spotify = useOptionalSpotify();
  const focus = useFocusSession();
  const playback = spotify?.playback;
  const showPlayer = Boolean(spotify?.ready && playback?.track);

  if (!focus?.session && !showPlayer) return null;

  return (
    <div className="space-y-2 border-t border-os-border p-3">
      {focus?.session ? <FocusCard /> : null}
      {showPlayer ? <MiniPlayer /> : null}
    </div>
  );
}

function FocusCard() {
  const focus = useFocusSession()!;
  const spotify = useOptionalSpotify();
  const session = focus.session!;
  const now = useNow(1000, true);
  const playlists = useSpotifyPlaylists(Boolean(spotify?.ready));

  const chooseMusic = (uri: string) => {
    if (!uri) {
      focus.setMusic(undefined);
      return;
    }
    const playlist = playlists.data?.playlists.find((entry) => entry.uri === uri);
    focus.setMusic({ uri, name: playlist?.name ?? "Playlist" });
    spotify?.command({ kind: "play", request: { contextUri: uri, deviceId: spotify.inApp.deviceId } });
  };

  const end = () => {
    // Music the session started stops with it; music that was already on is left alone.
    if (session.music && spotify?.playback?.isPlaying && spotify.playback.contextUri === session.music.uri) spotify.command({ kind: "pause" });
    focus.end();
  };

  return (
    <section aria-label="Focus session" className="rounded-md border border-os-border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <Link
          to={`/workspaces/${encodeURIComponent(session.project)}${session.taskId ? `?tab=tasks&task=${encodeURIComponent(session.taskId)}` : ""}`}
          className="os-focus-ring min-w-0 truncate text-[12.5px] text-foreground hover:underline"
          title="Focus session"
        >
          {session.projectName ?? session.project}
          {session.taskId ? <span className="text-os-muted"> · {session.taskId}</span> : null}
        </Link>
        <span className="font-mono text-[13px] tabular-nums text-foreground" aria-label="Elapsed">
          {formatElapsed(now - new Date(session.startedAt).getTime())}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {spotify?.ready ? (
          <select
            value={session.music?.uri ?? ""}
            onChange={(event) => chooseMusic(event.target.value)}
            aria-label="Music"
            className="os-focus-ring min-w-0 flex-1 truncate rounded-md border border-os-border bg-os-surface px-1.5 py-0.5 text-[12px] text-foreground"
          >
            <option value="">No music</option>
            {session.music && !playlists.data?.playlists.some((entry) => entry.uri === session.music?.uri) ? (
              <option value={session.music.uri}>{session.music.name}</option>
            ) : null}
            {(playlists.data?.playlists ?? []).map((playlist) => (
              <option key={playlist.id} value={playlist.uri}>
                {playlist.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="os-meta flex-1 text-os-subtle">Focus</span>
        )}
        <button type="button" onClick={end} className="os-focus-ring os-meta inline-flex min-h-7 shrink-0 cursor-pointer items-center rounded-md border border-os-border px-2 text-foreground hover:bg-os-surface-raised">
          End session
        </button>
      </div>
    </section>
  );
}

function MiniPlayer() {
  const spotify = useOptionalSpotify()!;
  const playback = spotify.playback!;
  const track = playback.track!;
  const now = useNow(1000, playback.isPlaying);
  const position = interpolatedProgress(playback, now);
  const share = track.durationMs ? position / track.durationMs : 0;

  return (
    <section aria-label="Now playing" className="rounded-md border border-os-border px-3 py-2">
      <div className="flex items-center gap-2">
        {track.imageUrl ? (
          <img src={track.imageUrl} alt="" className="size-8 shrink-0 rounded-sm object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Music className="size-4 shrink-0 text-os-muted" strokeWidth={1.75} aria-hidden="true" />
        )}
        <Link to="/learning?tab=spotify" className="os-focus-ring min-w-0 flex-1" title={`${track.name} — ${track.artists.join(", ")}`}>
          <span className="block truncate text-[12.5px] text-foreground">♫ {track.name}</span>
          <span className="block truncate text-[11.5px] text-os-muted">{track.artists.join(", ")}</span>
        </Link>
      </div>
      <div className="mt-1.5 h-0.5 w-full bg-os-border" aria-hidden="true">
        <div className="h-full bg-foreground" style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-center gap-1">
        <button type="button" className={ICON_BUTTON} aria-label="Previous" onClick={() => spotify.command({ kind: "previous" })}>
          <SkipBack className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={cn(ICON_BUTTON, "text-foreground")}
          aria-label={playback.isPlaying ? "Pause" : "Play"}
          onClick={() => spotify.command({ kind: playback.isPlaying ? "pause" : "play" })}
        >
          {playback.isPlaying ? <Pause className="size-4" strokeWidth={1.75} /> : <Play className="size-4" strokeWidth={1.75} />}
        </button>
        <button type="button" className={ICON_BUTTON} aria-label="Next" onClick={() => spotify.command({ kind: "next" })}>
          <SkipForward className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {spotify.error ? (
        <p role="alert" className="mt-1 flex items-start gap-1 text-[11.5px] leading-4 text-os-danger">
          <span className="min-w-0 flex-1">{spotify.error}</span>
          <button type="button" onClick={spotify.clearError} aria-label="Dismiss" className="os-focus-ring cursor-pointer">
            <X className="size-3" />
          </button>
        </p>
      ) : null}
    </section>
  );
}
