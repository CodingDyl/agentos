import type { MailProgress, MailProgressKind, MailProgressPhase } from "../../shared/mail-types";

/**
 * How far the current long mail job has got — a Refresh or an "Ask Jev
 * again" — so the Inbox can draw a progress bar while it runs.
 *
 * In memory on purpose: it describes work this process is doing right now,
 * and means nothing after a restart. A job that starts while another is
 * running takes over the bar; the older one's late updates are ignored.
 */

const IDLE: MailProgress = { running: false, total: 0, done: 0, failed: 0 };

let current: MailProgress = IDLE;
let currentToken = 0;

export interface ProgressHandle {
  phase: (phase: MailProgressPhase, total: number) => void;
  advance: (ok: boolean) => void;
  finish: () => void;
}

export function startProgress(kind: MailProgressKind): ProgressHandle {
  currentToken += 1;
  const token = currentToken;
  const mine = () => token === currentToken;

  current = { running: true, kind, total: 0, done: 0, failed: 0, startedAt: new Date().toISOString() };

  return {
    phase: (phase, total) => {
      if (mine()) current = { ...current, phase, total, done: 0, failed: 0 };
    },
    advance: (ok) => {
      if (!mine()) return;
      current = { ...current, done: current.done + 1, failed: current.failed + (ok ? 0 : 1) };
    },
    finish: () => {
      if (mine()) current = IDLE;
    },
  };
}

export function readProgress(): MailProgress {
  return current;
}
