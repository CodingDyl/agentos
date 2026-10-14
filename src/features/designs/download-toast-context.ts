import { createContext } from "react";

/**
 * Progress and errors for Creative downloads, in the same place workspace
 * edits report back: a bar at the bottom of the window, not a mystery.
 */

export type DownloadToastTone = "progress" | "success" | "error";

export interface DownloadToast {
  reportProgress: (label: string, percent?: number) => void;
  reportSuccess: (label: string) => void;
  reportError: (label: string) => void;
  clear: () => void;
}

export const DownloadToastContext = createContext<DownloadToast | undefined>(undefined);
