import { BookmarkPlus, Laptop, Music, Pause, Play, Plug, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatTimestamp, type SpotifyTrack } from "@shared/learning-types";
import { PaperButton, Tag } from "@/components/paper";
import { useImportSource, useSpotifyDevices, useSpotifyMusicLibrary, useSpotifyPlaylists } from "@/lib/agentos/learning";
import { cn } from "@/lib/utils";
import { LearningCapture } from "./learning-capture";
import { interpolatedProgress } from "./learning-model";
import { useSpotify } from "./spotify-context-value";

/**
 * Spotify inside Learning: what's playing, the controls, where it plays, and
 * the person's playlists and library to start something from.
 *
 * Playback continues on whatever device Spotify is using; "Play in AgentOS"
 * makes this window that device (Premium, and a browser that supports
 * Spotify's player). Everything goes through AgentOS's server.
 */

const ICON_BUTTON = "inline-flex size-10 cursor-pointer items-center justify-center text-paper-moss hover:bg-paper-linen disabled:cursor-not-allowed disabled:opacity-40";

function trackUrl(uri: string): string | undefined {
  const match = /^spotify:(track|episode):([A-Za-z0-9]+)$/.exec(uri);
  return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : undefined;
}

export function SpotifyPanel({ connectResult }: { connectResult?: string }) {
  const spotify = useSpotify();
  const status = spotify.status;

  if (!status) return <p className="text-[14px] text-paper-sage">Checking Spotify…</p>;

  if (!spotify.ready) {
    return (
      <section className="max-w-[62ch] border border-paper-mist bg-paper-white p-6">
        <h2 className="font-paper-display text-[21px] font-bold">Connect Spotify</h2>
        {connectResult && connectResult !== "connected" ? <p role="alert" className="mt-2 text-[14px] text-paper-flame-deep">{connectResult}</p> : null}
        <p className="mt-2 text-[14px] leading-6 text-paper-char">{status.detail ?? "Spotify isn't ready."}</p>
        <p className="mt-2 text-[13px] leading-5 text-paper-sage">
          AgentOS signs in on the server and keeps the credential there; the browser only ever talks to AgentOS. Playback control needs Spotify Premium.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {status.configured && !status.connected ? (
            <a href="/api/spotify/connect" className="inline-flex min-h-8 items-center gap-1.5 bg-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-white uppercase hover:bg-paper-moss">
              Sign in with Spotify
            </a>
          ) : null}
          <Link to="/connectors/spotify" className="inline-flex min-h-8 items-center gap-1.5 border-[1.5px] border-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen">
            <Plug className="size-3.5" strokeWidth={2} aria-hidden="true" /> Open in Connectors
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <NowPlaying />
      <Playlists />
      <MusicLibrary />
    </div>
  );
}

function NowPlaying() {
  const spotify = useSpotify();
  const playback = spotify.playback;
  const devices = useSpotifyDevices(true);
  const save = useImportSource();
  const [capturing, setCapturing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [volume, setVolume] = useState<number>();

  useEffect(() => {
    if (!playback?.isPlaying) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [playback?.isPlaying]);

  const track = playback?.track;
  const position = playback ? interpolatedProgress(playback, now) : 0;
  const shownVolume = volume ?? playback?.device?.volumePercent;

  return (
    <section aria-label="Now playing" className="border border-paper-mist bg-paper-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Now playing</p>
        <div className="flex items-center gap-2 text-[12.5px] text-paper-sage">
          {spotify.status?.account ? <span>{spotify.status.account}</span> : null}
          {spotify.status?.premium === false ? <Tag tone="marigold">Free — controls need Premium</Tag> : null}
        </div>
      </div>

      {track ? (
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {track.imageUrl ? <img src={track.imageUrl} alt="" className="size-24 object-cover" referrerPolicy="no-referrer" /> : <Music className="size-12 text-paper-sage" strokeWidth={1.5} />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-paper-display text-[24px] leading-tight font-bold">{track.name}</p>
            <p className="truncate text-[14px] text-paper-char">{[track.artists.join(", "), track.album].filter(Boolean).join(" · ")}</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="w-12 text-right font-mono text-[12px] text-paper-sage tabular-nums">{formatTimestamp(position / 1000)}</span>
              <input
                type="range"
                min={0}
                max={track.durationMs || 1}
                value={Math.min(position, track.durationMs || 1)}
                onChange={(event) => spotify.command({ kind: "seek", positionMs: Number(event.target.value) })}
                aria-label="Position"
                className="flex-1 accent-[var(--paper-blue)]"
              />
              <span className="w-12 font-mono text-[12px] text-paper-sage tabular-nums">{formatTimestamp(track.durationMs / 1000)}</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-paper-sage">Nothing is playing. Start a playlist below, or press play on any Spotify device.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={ICON_BUTTON} aria-label="Previous" onClick={() => spotify.command({ kind: "previous" })} disabled={!track}>
          <SkipBack className="size-5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={cn(ICON_BUTTON, "bg-paper-blue text-paper-white hover:bg-paper-moss")}
          aria-label={playback?.isPlaying ? "Pause" : "Play"}
          onClick={() => (playback?.isPlaying ? spotify.command({ kind: "pause" }) : spotify.command({ kind: "play", request: { deviceId: spotify.inApp.deviceId } }))}
        >
          {playback?.isPlaying ? <Pause className="size-5" strokeWidth={1.75} /> : <Play className="size-5" strokeWidth={1.75} />}
        </button>
        <button type="button" className={ICON_BUTTON} aria-label="Next" onClick={() => spotify.command({ kind: "next" })} disabled={!track}>
          <SkipForward className="size-5" strokeWidth={1.75} />
        </button>
        <label className="ml-2 flex items-center gap-2 text-paper-char">
          <Volume2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            value={shownVolume ?? 50}
            disabled={shownVolume === undefined}
            onChange={(event) => setVolume(Number(event.target.value))}
            onPointerUp={() => volume !== undefined && spotify.command({ kind: "volume", percent: volume })}
            onKeyUp={() => volume !== undefined && spotify.command({ kind: "volume", percent: volume })}
            aria-label="Volume"
            className="w-28 accent-[var(--paper-blue)]"
          />
        </label>
        <span className="flex-1" />
        {track ? (
          <>
            <PaperButton onClick={() => setCapturing(true)}>
              <BookmarkPlus className="size-3.5" strokeWidth={2} aria-hidden="true" /> Capture learning
            </PaperButton>
            {trackUrl(track.uri) ? (
              <PaperButton onClick={() => save.mutate({ url: trackUrl(track.uri)! })} disabled={save.isPending}>
                {save.isSuccess ? "Saved" : "Save to Learning"}
              </PaperButton>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-paper-mist pt-4 text-[13px]">
        <Laptop className="size-4 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-paper-char">Playing on</span>
        <select
          value={playback?.device?.id ?? ""}
          onChange={(event) => event.target.value && spotify.command({ kind: "transfer", deviceId: event.target.value, play: playback?.isPlaying })}
          aria-label="Device"
          className="border border-paper-ash bg-paper-white px-2 py-1 text-[13px]"
          onFocus={() => void devices.refetch()}
        >
          {!playback?.device ? <option value="">No active device</option> : null}
          {(devices.data?.devices ?? (playback?.device ? [playback.device] : [])).map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        {spotify.inApp.state === "ready" ? (
          <PaperButton variant="quiet" onClick={spotify.stopInApp}>
            Stop playing in AgentOS
          </PaperButton>
        ) : (
          <PaperButton variant="ghost" onClick={spotify.startInApp} disabled={spotify.inApp.state === "loading"}>
            {spotify.inApp.state === "loading" ? "Starting player…" : "Play in AgentOS"}
          </PaperButton>
        )}
        {spotify.inApp.error ? <span className="text-paper-flame-deep">{spotify.inApp.error}</span> : null}
      </div>

      {spotify.error ? (
        <p role="alert" className="mt-3 text-[13.5px] text-paper-flame-deep">
          {spotify.error}
        </p>
      ) : null}

      {capturing && track ? (
        <LearningCapture
          className="mt-5"
          context={{ sourceType: "spotify", sourceUrl: trackUrl(track.uri), sourceTitle: `${track.name} — ${track.artists.join(", ")}`, timestampSeconds: position / 1000 }}
          onDone={() => setCapturing(false)}
        />
      ) : null}
    </section>
  );
}

function Playlists() {
  const spotify = useSpotify();
  const playlists = useSpotifyPlaylists(true);
  const list = playlists.data?.playlists ?? [];

  return (
    <section aria-label="Playlists">
      <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Playlists</h2>
      {playlists.error ? <p className="mt-2 text-[13.5px] text-paper-flame-deep">{playlists.error.message}</p> : null}
      {playlists.isPending ? <p className="mt-2 text-[14px] text-paper-sage">Reading playlists…</p> : null}
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((playlist) => (
          <li key={playlist.id}>
            <button
              type="button"
              onClick={() => spotify.command({ kind: "play", request: { contextUri: playlist.uri, deviceId: spotify.inApp.deviceId } })}
              className="group block w-full cursor-pointer text-left"
            >
              <span className="block aspect-square overflow-hidden bg-paper-linen">
                {playlist.imageUrl ? <img src={playlist.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /> : null}
              </span>
              <span className="mt-1.5 block truncate text-[14px] font-medium group-hover:text-paper-blue">{playlist.name}</span>
              <span className="block truncate text-[12px] text-paper-sage">{playlist.trackCount !== undefined ? `${playlist.trackCount} tracks` : playlist.owner}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrackList({ title, tracks, onPlay }: { title: string; tracks: Array<SpotifyTrack & { playedAt?: string }>; onPlay: (uri: string) => void }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">{title}</h2>
      {tracks.length === 0 ? <p className="mt-2 text-[14px] text-paper-sage">Nothing here.</p> : null}
      <ul className="mt-2 divide-y divide-paper-mist">
        {tracks.slice(0, 10).map((track, index) => (
          <li key={`${track.uri}-${index}`}>
            <button type="button" onClick={() => onPlay(track.uri)} className="flex w-full cursor-pointer items-center gap-3 py-2 text-left hover:bg-paper-linen">
              {track.imageUrl ? <img src={track.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-9 object-cover" /> : <Music className="size-4 text-paper-sage" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{track.name}</span>
                <span className="block truncate text-[12px] text-paper-sage">{track.artists.join(", ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MusicLibrary() {
  const spotify = useSpotify();
  const library = useSpotifyMusicLibrary(true);
  const play = (uri: string) => spotify.command({ kind: "play", request: { uris: [uri], deviceId: spotify.inApp.deviceId } });

  if (library.error) return <p className="text-[13.5px] text-paper-flame-deep">{library.error.message}</p>;
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <TrackList title="Saved" tracks={library.data?.saved ?? []} onPlay={play} />
      <TrackList title="Recently played" tracks={library.data?.recent ?? []} onPlay={play} />
    </div>
  );
}
