import { createContext, useContext } from "react";

export type QuickCreateKind = "task" | "project" | "decision" | "capture" | "document";

export interface QuickCreateControls {
  open: (kind: QuickCreateKind, options?: { project?: string }) => void;
  close: () => void;
}

export const QuickCreateContext = createContext<QuickCreateControls | undefined>(undefined);

export function useQuickCreate(): QuickCreateControls {
  const controls = useContext(QuickCreateContext);
  if (!controls) throw new Error("useQuickCreate must be used inside QuickCreateProvider");
  return controls;
}
