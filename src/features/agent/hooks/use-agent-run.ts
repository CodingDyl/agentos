import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentRunEventSchema,
  type AgentRunStatus,
  type ApprovalDecision,
} from "@shared/agentos-types";
import {
  agentRunEventsUrl,
  AgentRequestError,
  respondToAgentApproval,
  startAgentRun,
  steerAgentRun,
  stopAgentRun,
} from "@/lib/agentos/client";
import { readSseStream } from "../sse";
import {
  applyRunEvent,
  initialRunState,
  isTerminal,
  resolveApproval,
  settleRunState,
  type RunState,
} from "../run-events";

/**
 * Drives one agent run: start it, stream its events, and steer or stop it.
 *
 * The stream is consumed through the local adapter's SSE proxy, so the browser
 * never needs the Hermes key. Nothing starts until `start` is called.
 */

export interface StartRunInput {
  message: string;
  project?: string;
  sessionId?: string;
}

export interface UseAgentRunResult {
  runId?: string;
  sessionId?: string;
  state: RunState;
  isRunning: boolean;
  error?: string;
  start: (input: StartRunInput) => Promise<void>;
  stop: () => Promise<void>;
  steer: (guidance: string) => Promise<void>;
  /** Records a decision on the pending approval. Rejects if Hermes refuses it. */
  respond: (decision: ApprovalDecision) => Promise<void>;
  /** True while a decision is in flight. */
  isResponding: boolean;
  /** Why the last decision could not be recorded. */
  approvalError?: string;
  reset: () => void;
}

export interface UseAgentRunOptions {
  /**
   * Called once when a run reaches a terminal status, for any reason.
   *
   * Carries the run's id, because a run's outcome is known only here — the
   * adapter recorded that it started; only the stream knows how it ended.
   */
  onFinished?: (status: AgentRunStatus, runId?: string, output?: string) => void;
}

export function useAgentRun({ onFinished }: UseAgentRunOptions = {}): UseAgentRunResult {
  const [runId, setRunId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [state, setState] = useState<RunState>(initialRunState);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [isResponding, setIsResponding] = useState(false);
  const [approvalError, setApprovalError] = useState<string>();

  const streamRef = useRef<AbortController>(null);
  // Mirrors `runId` so a finishing run can name itself without `finish`
  // depending on state that changes underneath it.
  const runIdRef = useRef<string>(undefined);
  // Mirrors `state` so events can be folded without side-effecting inside a
  // state updater — React may invoke updaters more than once.
  const stateRef = useRef<RunState>(initialRunState);

  const closeStream = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
  }, []);

  // A run must not keep streaming after the console unmounts.
  useEffect(() => closeStream, [closeStream]);

  const finish = useCallback(
    (status: AgentRunStatus) => {
      closeStream();
      setIsRunning(false);
      stateRef.current = settleRunState({ ...stateRef.current, status });
      setState(stateRef.current);
      onFinished?.(status, runIdRef.current, stateRef.current.output);
    },
    // `onFinished` is only ever called, never subscribed to, so an unstable
    // handler costs nothing beyond recreating these callbacks.
    [closeStream, onFinished],
  );

  const openStream = useCallback(
    (id: string) => {
      closeStream();
      const controller = new AbortController();
      streamRef.current = controller;

      const consume = (raw: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }

        const event = AgentRunEventSchema.safeParse(parsed);
        if (!event.success) return;

        const next = applyRunEvent(stateRef.current, event.data, id);
        stateRef.current = next;
        setState(next);

        if (isTerminal(next.status)) finish(next.status);
      };

      void (async () => {
        try {
          const response = await fetch(agentRunEventsUrl(id), {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            finish("failed");
            return;
          }

          // The `data` payload carries its own `type`, so the SSE event name is
          // only a transport detail — every event is handled the same way.
          await readSseStream(response.body, (message) => consume(message.data));
        } catch {
          // An aborted stream is a stop, not a failure.
          if (!controller.signal.aborted) finish("failed");
          return;
        }

        // The stream closed without ever reporting a terminal status.
        if (!controller.signal.aborted && !isTerminal(stateRef.current.status)) {
          finish("completed");
        }
      })();
    },
    [closeStream, finish],
  );

  const start = useCallback(
    async ({ message, project, sessionId: session }: StartRunInput) => {
      setError(undefined);
      stateRef.current = initialRunState;
      setState(initialRunState);
      setIsRunning(true);

      try {
        const run = await startAgentRun({
          message,
          project,
          sessionId: session ?? sessionId,
        });

        setRunId(run.runId);
        runIdRef.current = run.runId;
        if (run.sessionId) setSessionId(run.sessionId);
        stateRef.current = { ...stateRef.current, status: run.status };
        setState(stateRef.current);
        openStream(run.runId);
      } catch (failure) {
        setIsRunning(false);
        setError(
          failure instanceof AgentRequestError
            ? failure.message
            : "Hermes could not start the run.",
        );
        throw failure;
      }
    },
    [openStream, sessionId],
  );

  const stop = useCallback(async () => {
    if (!runId) return;
    stateRef.current = { ...stateRef.current, status: "stopping" };
    setState(stateRef.current);

    try {
      await stopAgentRun(runId);
    } catch {
      // The run may have finished on its own between render and click.
      finish("cancelled");
    }
  }, [finish, runId]);

  const steer = useCallback(
    async (guidance: string) => {
      if (!runId) return;
      await steerAgentRun(runId, guidance);
    },
    [runId],
  );

  /**
   * Answers the pending approval.
   *
   * The gate is marked answered only after Hermes acknowledges the decision. A
   * failure leaves the approval pending and reports why, so a run is never
   * shown as resumed when it is still waiting — and nothing here claims a file
   * changed. Hermes acts; the stream reports what happened.
   */
  const respond = useCallback(
    async (decision: ApprovalDecision) => {
      const approval = stateRef.current.approval;
      if (!runId || !approval || approval.status !== "pending") return;

      setApprovalError(undefined);
      setIsResponding(true);

      try {
        await respondToAgentApproval(runId, approval.requestId, decision);
        stateRef.current = resolveApproval(stateRef.current, decision);
        setState(stateRef.current);
      } catch (failure) {
        setApprovalError(
          failure instanceof AgentRequestError
            ? failure.message
            : "Hermes did not record the decision.",
        );
        throw failure;
      } finally {
        setIsResponding(false);
      }
    },
    [runId],
  );

  const reset = useCallback(() => {
    closeStream();
    setRunId(undefined);
    runIdRef.current = undefined;
    stateRef.current = initialRunState;
    setState(initialRunState);
    setIsRunning(false);
    setError(undefined);
    setApprovalError(undefined);
  }, [closeStream]);

  return {
    runId,
    sessionId,
    state,
    isRunning,
    error,
    start,
    stop,
    steer,
    respond,
    isResponding,
    approvalError,
    reset,
  };
}

