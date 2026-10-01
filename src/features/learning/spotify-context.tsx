import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpotifyPlayback } from "@shared/learning-types";
import {
  fetchSpotifySdkToken,
  sendSpotifyCommand,
  spotifyKey,
  useSpotifyCommand,
  useSpotifyPlayback,
  useSpotifyStatus,
  type SpotifyCommand,
} from "@/lib/agentos/learning";
import { playbackPollMs } from "./learning-model";
import { SpotifyContext, type SpotifyControls } from "./spotify-context-value";

/**
 * Spotify for the whole app.
 *
 * Mounted above the routes, so what's playing — and, when chosen, the in-app
 * player itself — survives moving between AgentOS pages. Nothing here talks
 * to Spotify directly: every read and command goes through `/api/spotify`.
 *
 * "Play in AgentOS" loads Spotify's own Web Playback SDK, which registers
 * this window as a Spotify device. It is loaded only when asked for, and the
 * token it needs is fetched inside the SDK's callback and kept nowhere else.
 */

// -------------------------------------------------- the Web Playback SDK

interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, callback: (payload: { device_id?: string; message?: string }) => void): boolean;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume?: number }) => SdkPlayer;
    };
  }
}

let sdkLoading: Promise<void> | undefined;

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => {
      sdkLoading = undefined;
      reject(new Error("Spotify's player could not be loaded. Are you online?"));
    };
    document.head.appendChild(script);
  });
  return sdkLoading;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const status = useSpotifyStatus();
  const ready = Boolean(status.data?.configured && status.data.connected && status.data.enabled);
  const visible = useDocumentVisible();

  const [inApp, setInApp] = useState<SpotifyControls["inApp"]>({ state: "off" });
  const player = useRef<SdkPlayer | undefined>(undefined);

  const inAppReady = inApp.state === "ready";
  const playback = useSpotifyPlayback(ready, (playing) => playbackPollMs({ visible, playing, inApp: inAppReady }));
  const current = playback.data?.playback ?? undefined;

  const mutation = useSpotifyCommand();
  const [error, setError] = useState<string>();

  const command = useCallback(
    (next: SpotifyCommand) => {
      setError(undefined);
      // Optimistic for the two buttons pressed most, so the icon flips at once.
      if (next.kind === "pause" || next.kind === "play") {
        client.setQueryData<{ playback: SpotifyPlayback | null }>([...spotifyKey(), "player"], (previous) =>
          previous?.playback ? { playback: { ...previous.playback, isPlaying: next.kind === "play" } } : previous,
        );
      }
      mutation.mutate(next, { onError: (failure) => setError(failure.message) });
    },
    [client, mutation],
  );

  const stopInApp = useCallback(() => {
    player.current?.disconnect();
    player.current = undefined;
    setInApp({ state: "off" });
  }, []);

  const startInApp = useCallback(() => {
    if (player.current) return;
    setInApp({ state: "loading" });
    loadSdk()
      .then(() => {
        if (!window.Spotify) throw new Error("Spotify's player did not start.");
        const sdk = new window.Spotify.Player({
          name: "AgentOS",
          volume: 0.6,
          // Asked for each time the SDK needs one; never stored here.
          getOAuthToken: (callback) => {
            fetchSpotifySdkToken().then(callback, (failure: Error) => setInApp({ state: "error", error: failure.message }));
          },
        });
        const failed = (message: string) => {
          sdk.disconnect();
          player.current = undefined;
          setInApp({ state: "error", error: message });
        };
        sdk.addListener("ready", ({ device_id: deviceId }) => {
          setInApp({ state: "ready", deviceId });
          if (deviceId) {
            // Move playback here, keeping whatever was playing.
            sendSpotifyCommand({ kind: "transfer", deviceId, play: true }).catch((failure: Error) => setError(failure.message));
          }
        });
        sdk.addListener("not_ready", () => setInApp((state) => ({ ...state, state: "loading" })));
        sdk.addListener("initialization_error", ({ message }) => failed(message ?? "This browser can't play Spotify (it needs encrypted media support)."));
        sdk.addListener("authentication_error", ({ message }) => failed(message ?? "Spotify didn't accept the sign-in. Reconnect Spotify."));
        sdk.addListener("account_error", () => failed("Playing inside AgentOS needs Spotify Premium."));
        sdk.addListener("player_state_changed", () => void client.invalidateQueries({ queryKey: [...spotifyKey(), "player"] }));
        player.current = sdk;
        return sdk.connect().then((connected) => {
          if (!connected) failed("Spotify's player could not connect.");
        });
      })
      .catch((failure: Error) => setInApp({ state: "error", error: failure.message }));
  }, [client]);

  // Signing out or switching Spotify off ends the in-app device.
  useEffect(() => {
    if (!ready && player.current) stopInApp();
  }, [ready, stopInApp]);

  useEffect(() => () => player.current?.disconnect(), []);

  const playbackError = playback.error?.message;
  const controls = useMemo<SpotifyControls>(
    () => ({
      status: status.data,
      ready,
      playback: current,
      command,
      pending: mutation.isPending,
      error: error ?? playbackError,
      clearError: () => setError(undefined),
      inApp,
      startInApp,
      stopInApp,
    }),
    [command, current, error, inApp, mutation.isPending, playbackError, ready, startInApp, status.data, stopInApp],
  );

  return <SpotifyContext.Provider value={controls}>{children}</SpotifyContext.Provider>;
}
