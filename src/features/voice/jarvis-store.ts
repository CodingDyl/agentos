import { createContext, useContext } from "react";
import type { ApprovalDecision, ApprovalRequest } from "@shared/agentos-types";
import type { VoiceStatus } from "@shared/voice-types";
import type { UseAgentRunResult } from "@/features/agent/hooks/use-agent-run";
import type { MicPermission } from "./mic-permission";
import type { VoicePhase } from "./voice-model";
import type { TimingSummary } from "./voice-timings";

/**
 * A page that takes over what Jarvis hears. Operator uses it so that speech
 * becomes a run (and "approve", "stop", "status" act on the run on screen)
 * instead of a Hermes chat message.
 */
export interface JarvisIntercept {
  /** Who Jarvis is talking for, e.g. "Operator". Shown on the launcher and panel. */
  label: string;
  /** Return true when handled. The page answers through `announce`. */
  handle: (text: string) => boolean;
}

export interface JarvisApi {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  phase: VoicePhase;
  /** Live microphone loudness, 0..1. */
  level: number;
  transcript: string;
  /** Editing stops the auto-send clock. */
  setTranscript: (text: string) => void;
  /** When the transcript will send itself, if it is going to. */
  autoSendAt?: number;
  send: (text?: string) => void;
  cancelTranscript: () => void;
  toggleListening: () => void;
  /** Stops playback and any run in flight. */
  stop: () => void;
  reply: string;
  project?: string;
  approval?: ApprovalRequest;
  respond: (decision: ApprovalDecision) => void;
  isResponding: boolean;
  approvalError?: string;
  error?: string;
  /** Audio failed or is off, but the text answer is intact. */
  audioNote?: string;
  /** Where the time went on the last exchange. */
  timings: TimingSummary;
  /** Speaks a fixed line, skipping Hermes and the microphone, to test Fish alone. */
  testVoice: () => void;
  /** The browser's microphone setting. `prompt` means pressing record will ask. */
  micPermission: MicPermission;
  /** The browser's permission dialog is open and waiting for an answer. */
  askingMic: boolean;
  /** The last attempt failed at the microphone itself. */
  micFailed: boolean;
  /** The voice status could not be read at all: the data server is probably not running. */
  voiceStatusError: boolean;
  voice?: VoiceStatus;
  setVoiceOn: (enabled: boolean) => void;
  run: UseAgentRunResult;
  /** The page Jarvis is working for right now, when one has taken over. */
  target?: string;
  setIntercept: (intercept: JarvisIntercept | undefined) => void;
  /**
   * Says a line on the page's behalf: shown as the reply, spoken when voice is
   * on. `display` is shown under it and never spoken (a draft, a list).
   */
  announce: (text: string, display?: string) => void;
  /** Voice is on, configured, and not silenced for this exchange. */
  canSpeak: boolean;
  /** Hold Control to talk, let go to send. On by default; a per-browser choice. */
  pushToTalk: boolean;
  setPushToTalk: (on: boolean) => void;
  /** Control is held and Jarvis is listening. */
  holding: boolean;
}

export const JarvisContext = createContext<JarvisApi | null>(null);

export function useJarvis(): JarvisApi {
  const value = useContext(JarvisContext);
  if (!value) throw new Error("useJarvis must be used inside JarvisProvider");
  return value;
}

