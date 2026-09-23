import type { ApprovalDecision } from "../../shared/agentos-types";
import { hermesFailure, hermesFetch, HermesError } from "./client";

/**
 * Recording a decision on a Hermes approval request.
 *
 * This is the only write path in the whole system: the console never touches
 * AgentOS files. A mutation always travels UI → Hermes → approval → AgentOS,
 * and the local adapter stays read-only. What this endpoint sends is a
 * decision, never a file change.
 *
 * The key stays server-side, as with every other Hermes call.
 */

/**
 * The request body.
 *
 * Hermes identifies the pending request by the id it published in the
 * `approval.request` event, so that id is echoed back rather than guessed at,
 * and the decision is sent using Hermes' own vocabulary. Both fields are
 * snake_case, matching the run and session endpoints.
 *
 * If a Hermes build expects a different shape it will reject this outright,
 * and the console reports that failure — it never treats an unacknowledged
 * decision as an approval.
 */
export interface ApprovalPayload {
  request_id: string;
  decision: ApprovalDecision;
}

const DECISIONS: readonly ApprovalDecision[] = [
  "once",
  "session",
  "always",
  "deny",
];

/** Narrows an incoming decision, refusing anything not in the vocabulary. */
export function readDecision(value: unknown): ApprovalDecision | undefined {
  return typeof value === "string" &&
    DECISIONS.includes(value as ApprovalDecision)
    ? (value as ApprovalDecision)
    : undefined;
}

/**
 * Sends one decision to Hermes.
 *
 * Resolves only when Hermes has acknowledged it. A rejected or unreachable
 * request throws, so the console can say the gate is still closed rather than
 * showing a run as resumed when it is not.
 */
export async function respondToApproval(
  runId: string,
  requestId: string,
  decision: ApprovalDecision,
): Promise<void> {
  const body: ApprovalPayload = { request_id: requestId, decision };

  const response = await hermesFetch(
    `/runs/${encodeURIComponent(runId)}/approval`,
    { method: "POST", body },
  );

  if (!response.ok) {
    // A 4xx here usually means the request was already answered or has expired;
    // either way the operator needs to know the decision did not land.
    if (response.status === 404 || response.status === 409) {
      throw new HermesError(
        "Hermes no longer has that approval request pending.",
        "failed",
      );
    }
    throw hermesFailure(response.status);
  }
}
