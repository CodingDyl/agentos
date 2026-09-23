import { useContext } from "react";
import {
  WorkspaceFeedbackContext,
  type Feedback,
} from "./workspace-feedback-context";

/**
 * The hook every mutation goes through.
 *
 * Returns no-ops outside the provider rather than throwing: a component that
 * can edit should still render in isolation, and a missing feedback bar is not
 * a reason to break the screen it was meant to help.
 */
export function useWorkspaceFeedback(): Feedback {
  return (
    useContext(WorkspaceFeedbackContext) ?? {
      recordEdit: () => undefined,
      reportFailure: () => undefined,
    }
  );
}

