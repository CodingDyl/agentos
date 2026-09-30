import { useEffect, useRef, useState } from "react";
import type { OperatorMode, OperatorRun } from "@shared/operator-types";
import { useJarvis } from "@/features/voice/jarvis-store";
import { useApproveOperatorRun, useStopOperatorRun } from "@/lib/agentos/operator";
import {
  acknowledge,
  approvalGate,
  CONFIRM_WINDOW_MS,
  narrate,
  parseVoiceCommand,
  readPlan,
  statusBrief,
} from "./jarvis-operator";
import { isStoppable } from "./operator-model";

const NARRATE_KEY = "agentos.operator.narrate";

function readNarrate(): boolean {
  try {
    return window.localStorage.getItem(NARRATE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Puts Jarvis in charge of the Operator page while it is open.
 *
 * What Jarvis hears goes to Operator instead of Hermes chat: a request starts
 * a run, and "approve", "confirm", "stop", "status" and "read me the plan" act
 * on the run on screen. As the run moves, Jarvis says what changed. Leaving
 * the page hands Jarvis back to Hermes.
 */
export function useOperatorJarvis({
  run,
  mode,
  setMode,
  start,
}: {
  run: OperatorRun | undefined;
  mode: OperatorMode;
  setMode: (mode: OperatorMode) => void;
  start: (input: string, mode: OperatorMode) => void;
}) {
  const jarvis = useJarvis();
  const approve = useApproveOperatorRun();
  const stop = useStopOperatorRun();
  const [narrating, setNarratingState] = useState(readNarrate);
  const pendingConfirm = useRef<{ runId: string; until: number } | undefined>(undefined);

  const setNarrating = (on: boolean) => {
    setNarratingState(on);
    try {
      window.localStorage.setItem(NARRATE_KEY, on ? "on" : "off");
    } catch {
      // A per-browser preference; losing it costs nothing.
    }
  };

  // The handler reads the latest state through a ref, so the intercept itself
  // is registered once for the life of the page.
  const latest = useRef({ run, mode, setMode, start, jarvis, approve, stop });
  useEffect(() => {
    latest.current = { run, mode, setMode, start, jarvis, approve, stop };
  });

  const { setIntercept } = jarvis;
  useEffect(() => {
    setIntercept({
      label: "Operator",
      handle: (text) => {
        const { run: current, mode: currentMode, setMode: changeMode, start: begin, jarvis: voice, approve: approveRun, stop: stopRun } = latest.current;
        const command = parseVoiceCommand(text, currentMode);
        if (!command) return false;

        switch (command.kind) {
          case "stop":
            if (current && isStoppable(current.status)) {
              pendingConfirm.current = undefined;
              stopRun.mutate(current.id);
              voice.announce("Stopping. Anything already changed stays as it is.");
            } else voice.announce("Nothing is running.");
            return true;

          case "approve": {
            if (current?.status !== "awaiting_approval") {
              voice.announce(current?.mode === "plan" && current.status === "completed" ? "That was a plan. Say run this plan to do it." : "There's nothing waiting for approval.");
              return true;
            }
            const gate = approvalGate(current);
            if (gate.needsConfirm) {
              pendingConfirm.current = { runId: current.id, until: Date.now() + CONFIRM_WINDOW_MS };
            } else {
              approveRun.mutate(current.id);
            }
            voice.announce(gate.say);
            return true;
          }

          case "confirm": {
            const pending = pendingConfirm.current;
            pendingConfirm.current = undefined;
            if (!pending || pending.until < Date.now() || current?.id !== pending.runId || current.status !== "awaiting_approval") {
              voice.announce("There's nothing to confirm. Say approve first.");
              return true;
            }
            approveRun.mutate(current.id);
            voice.announce("Confirmed. Running it now.");
            return true;
          }

          case "run-plan":
            if (current?.mode === "plan") {
              begin(current.input, "run");
              voice.announce("Running the plan. I'll ask before anything changes.");
            } else voice.announce("There's no plan open to run.");
            return true;

          case "status":
            voice.announce(statusBrief(current));
            return true;

          case "read-plan":
            voice.announce(readPlan(current));
            return true;

          case "mode":
            changeMode(command.mode);
            voice.announce(`${command.mode.charAt(0).toUpperCase()}${command.mode.slice(1)} mode.`);
            return true;

          case "request":
            pendingConfirm.current = undefined;
            changeMode(command.mode);
            begin(command.input, command.mode);
            voice.announce(acknowledge(command.mode));
            return true;
        }
      },
    });
    return () => setIntercept(undefined);
  }, [setIntercept]);

  // Say what changed since the last look at this run.
  const previous = useRef<OperatorRun | undefined>(undefined);
  const { announce } = jarvis;
  useEffect(() => {
    const before = previous.current;
    previous.current = run;
    if (!run || !narrating) return;
    const line = narrate(before, run);
    if (line) announce(line);
  }, [run, narrating, announce]);

  return { narrating, setNarrating, jarvis };
}
