/**
 * Microphone access, and what to say when it is missing.
 *
 * A browser asks for the microphone only when a page tries to use it, and only
 * while the answer is still "prompt". Once you have blocked it, the page can
 * not ask again: the only thing to do is say where to switch it back on.
 */

export type MicPermission = "granted" | "prompt" | "denied" | "unknown";

/** Maps the Permissions API answer onto ours. Anything unrecognised is unknown. */
export function permissionFromState(state: unknown): MicPermission {
  return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
}

/**
 * The current state, without triggering a prompt. Browsers that cannot answer
 * (Safari, some Firefox versions) report `unknown`, and asking is still the
 * right move there: trying to record is what raises the prompt.
 */
export async function readMicPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return permissionFromState(status.state);
  } catch {
    return "unknown";
  }
}

/** Calls back when you change the setting in the browser, so the UI follows it. */
export async function watchMicPermission(onChange: (state: MicPermission) => void): Promise<() => void> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    const handler = () => onChange(permissionFromState(status.state));
    status.addEventListener("change", handler);
    return () => status.removeEventListener("change", handler);
  } catch {
    return () => undefined;
  }
}

export const MIC_BLOCKED_MESSAGE =
  "Microphone access is blocked for this page. Click the icon at the left of the address bar, set Microphone to Allow, then press Try again.";

export interface MicFailure {
  message: string;
  /** Whether the browser will now refuse without asking, so the fix is in its settings. */
  blocked: boolean;
}

/** Turns a getUserMedia failure into something you can act on. */
export function describeMicFailure(error: unknown): MicFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return { message: MIC_BLOCKED_MESSAGE, blocked: true };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { message: "No microphone was found. Plug one in or pick one in your system settings, then try again.", blocked: false };
    case "NotReadableError":
    case "TrackStartError":
      return { message: "The microphone is in use by another app. Close it there and try again.", blocked: false };
    case "InsecureContext":
      return { message: "The browser only allows the microphone on https or localhost. Open AgentOS from localhost.", blocked: false };
    default:
      return { message: "The microphone couldn't be started. You can type instead.", blocked: false };
  }
}

/** The one place that decides whether this page may even ask. */
export function micSupportFailure(): MicFailure | undefined {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return describeMicFailure({ name: window.isSecureContext ? "NotFoundError" : "InsecureContext" });
  }
  return undefined;
}
