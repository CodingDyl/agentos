import { createContext, useContext } from "react";

export interface FocusSession {
  project: string;
  projectName?: string;
  taskId?: string;
  startedAt: string;
  /** A Spotify playlist or album the session started, when one was chosen. */
  music?: { uri: string; name: string };
}

export interface FocusControls {
  session?: FocusSession;
  start: (input: { project: string; projectName?: string; taskId?: string }) => void;
  setMusic: (music: FocusSession["music"]) => void;
  end: () => void;
}

export const FocusContext = createContext<FocusControls | undefined>(undefined);

/** The running focus session, or `undefined` outside the provider. */
export function useFocusSession(): FocusControls | undefined {
  return useContext(FocusContext);
}
