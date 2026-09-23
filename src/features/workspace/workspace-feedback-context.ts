import { createContext } from "react";

/**
 * What a workspace mutation reports back.
 *
 * In its own module because the provider is a component and the context is not
 * — keeping them together defeats fast refresh, and this boundary is the one
 * the tooling actually wants.
 */
export interface Feedback {
  /** Offers to undo the edit just made. */
  recordEdit: (label: string, undoId?: string) => void;
  /** Reports a failed write, giving conflicts their own treatment. */
  reportFailure: (error: unknown, onReload?: () => void) => void;
}

export const WorkspaceFeedbackContext = createContext<Feedback | undefined>(
  undefined,
);
