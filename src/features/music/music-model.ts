/**
 * How often to ask Spotify what's playing. Often while music plays on a
 * visible screen (the mini-player shows progress), rarely otherwise: Spotify
 * rate-limits, and an idle AgentOS should not be chatty.
 */
export function playbackPollMs(input: { visible: boolean; playing: boolean; inApp: boolean }): number {
  if (!input.visible) return 30_000;
  if (input.inApp) return 10_000;
  return input.playing ? 4_000 : 15_000;
}

/** The progress to show now, moved on from when it was read while playing. */
export function interpolatedProgress(playback: { isPlaying: boolean; progressMs: number; readAt: string; track?: { durationMs: number } }, now: number): number {
  const elapsed = playback.isPlaying ? Math.max(0, now - new Date(playback.readAt).getTime()) : 0;
  const position = playback.progressMs + elapsed;
  return playback.track?.durationMs ? Math.min(position, playback.track.durationMs) : position;
}
