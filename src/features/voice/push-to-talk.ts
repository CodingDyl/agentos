/**
 * Hold Control to talk to Jarvis; let go to send.
 *
 * Control is also half of every shortcut (Ctrl+C, Ctrl+K), so holding it is
 * only "talk" when it is held *alone*:
 *
 * - Nothing starts until Control has been down on its own for `holdMs`. A
 *   quick Ctrl+C never touches the microphone.
 * - Any other key while it is held turns it back into a shortcut: an armed
 *   hold is dropped, a recording is thrown away, and letting go sends nothing.
 * - Letting go sends, unless the recording was too short to be speech.
 * - Losing focus (switching window mid-hold, so the key-up never arrives)
 *   throws the recording away rather than leaving the microphone open.
 *
 * Pure: timers and the clock are injected, so every rule is tested without a
 * keyboard or a microphone.
 */

export type PushToTalkState = "idle" | "armed" | "recording" | "spoiled";

export interface KeyLike {
  key: string;
  repeat?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface PushToTalkOptions {
  /** Control held alone this long starts listening. */
  holdMs?: number;
  /** A recording shorter than this is a slip, not speech. */
  minRecordingMs?: number;
  start: () => void;
  /** Let go after a real recording: stop and send. */
  finish: () => void;
  /** Stop and throw the recording away. */
  cancel: () => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const HOLD_MS = 250;
export const MIN_RECORDING_MS = 400;

export class PushToTalk {
  private current: PushToTalkState = "idle";
  private timer: unknown;
  private startedAt = 0;
  private readonly options: Required<Omit<PushToTalkOptions, "start" | "finish" | "cancel">> & Pick<PushToTalkOptions, "start" | "finish" | "cancel">;

  constructor(options: PushToTalkOptions) {
    this.options = {
      holdMs: HOLD_MS,
      minRecordingMs: MIN_RECORDING_MS,
      now: () => Date.now(),
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  get state(): PushToTalkState {
    return this.current;
  }

  keyDown(event: KeyLike): void {
    if (event.key === "Control") {
      if (event.repeat || this.current !== "idle") return;
      // Ctrl held with another modifier is a shortcut in progress.
      if (event.altKey || event.metaKey || event.shiftKey) return;
      this.current = "armed";
      this.timer = this.options.setTimer(() => this.begin(), this.options.holdMs);
      return;
    }

    // Any other key while Control is down: it was a shortcut after all.
    if (this.current === "armed") this.disarm("idle");
    else if (this.current === "recording") {
      this.current = "spoiled";
      this.options.cancel();
    }
  }

  keyUp(event: KeyLike): void {
    if (event.key !== "Control") return;

    switch (this.current) {
      case "armed":
        this.disarm("idle");
        return;
      case "recording": {
        this.current = "idle";
        const held = this.options.now() - this.startedAt;
        if (held < this.options.minRecordingMs) this.options.cancel();
        else this.options.finish();
        return;
      }
      case "spoiled":
        this.current = "idle";
        return;
      default:
        return;
    }
  }

  /** The window lost focus: the key-up may never come. */
  blur(): void {
    if (this.current === "armed") this.disarm("idle");
    else if (this.current === "recording") {
      this.current = "idle";
      this.options.cancel();
    } else this.current = "idle";
  }

  private begin(): void {
    if (this.current !== "armed") return;
    this.timer = undefined;
    this.current = "recording";
    this.startedAt = this.options.now();
    this.options.start();
  }

  private disarm(next: PushToTalkState): void {
    if (this.timer !== undefined) this.options.clearTimer(this.timer);
    this.timer = undefined;
    this.current = next;
  }
}
