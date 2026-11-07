import { createContext, useContext } from "react";
import type { SpotifyPlayback, SpotifyStatus } from "@shared/learning-types";
import type { SpotifyCommand } from "@/lib/agentos/learning";

export type InAppState = "off" | "loading" | "ready" | "error";

export interface SpotifyControls {
  status?: SpotifyStatus;
  /** Configured, signed in and switched on. */
  ready: boolean;
  playback?: SpotifyPlayback;
  command: (command: SpotifyCommand) => void;
  pending: boolean;
  error?: string;
  clearError: () => void;
  inApp: { state: InAppState; deviceId?: string; error?: string };
  startInApp: () => void;
  stopInApp: () => void;
}

export const SpotifyContext = createContext<SpotifyControls | undefined>(undefined);

export function useSpotify(): SpotifyControls {
  const controls = useContext(SpotifyContext);
  if (!controls) throw new Error("useSpotify must be used inside SpotifyProvider");
  return controls;
}

/** Same, but `undefined` outside the provider (the design system page, tests). */
export function useOptionalSpotify(): SpotifyControls | undefined {
  return useContext(SpotifyContext);
}
