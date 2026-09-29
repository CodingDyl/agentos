/**
 * Microphone access, and what to say when it is missing.
 *
 * A browser asks for the microphone only when a page tries to use it, and only
 * while the answer is still "prompt". Once you have blocked it, the page can
 * not ask again: the only thing to do is say where to switch it back on.
 *
 * There are two different blocks, and telling them apart matters. The browser
 * can block this *site* (the fix is the icon by the address bar), or the
 * *operating system* can block the browser itself (the site shows "allowed"
 * and recording still fails; the fix is in system privacy settings).
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

export type MicFailureKind =
  /** The browser has this site blocked (or you closed its prompt). */
  | "site-blocked"
  /** The site is allowed but the operating system refuses the browser. */
  | "system-blocked"
  | "no-device"
  | "busy"
  | "insecure"
  | "other";

export interface MicFailure {
  message: string;
  kind: MicFailureKind;
  /** The browser's own error, for when the message is not enough. */
  detail?: string;
  /** The browser will now refuse without asking, so the fix is in its settings. */
  blocked: boolean;
}

export function siteBlockedMessage(host: string): string {
  return `Microphone access is blocked for ${host}. Click the icon at the left of the address bar, set Microphone to Allow, then press Try again.`;
}

export const MIC_DISMISSED_MESSAGE = "The microphone prompt was closed without allowing it. Press Try again and choose Allow.";

export const MIC_SYSTEM_BLOCKED_MESSAGE =
  "Your browser allows the microphone for this site, but your computer is not letting the browser use it. Mac: System Settings, Privacy & Security, Microphone, switch on your browser, then quit and reopen it. Windows: Settings, Privacy & security, Microphone, allow desktop apps. Then press Try again.";

function currentHost(): string {
  return typeof window !== "undefined" && window.location?.host ? window.location.host : "this site";
}

/**
 * Turns a getUserMedia failure into something you can act on.
 *
 * `permission` is what the browser reported for this site *now*: a refusal
 * while the site shows "granted" cannot be the site's doing.
 */
export function describeMicFailure(error: unknown, permission: MicPermission = "unknown"): MicFailure {
  const record = typeof error === "object" && error !== null ? (error as { name?: unknown; message?: unknown }) : {};
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  const detail = name ? (message ? `${name}: ${message}` : name) : undefined;

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError": {
      if (permission === "granted") {
        return { message: MIC_SYSTEM_BLOCKED_MESSAGE, kind: "system-blocked", detail, blocked: false };
      }
      if (/dismiss/i.test(message)) {
        return { message: MIC_DISMISSED_MESSAGE, kind: "site-blocked", detail, blocked: false };
      }
      return { message: siteBlockedMessage(currentHost()), kind: "site-blocked", detail, blocked: true };
    }
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return {
        message: "No microphone was found. Plug one in or choose one in your system sound settings, then press Try again.",
        kind: "no-device",
        detail,
        blocked: false,
      };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        message: "The microphone is busy or not responding. Close other apps using it (calls, recorders), then press Try again.",
        kind: "busy",
        detail,
        blocked: false,
      };
    case "InsecureContext":
      return {
        message: `The browser only allows the microphone on https or localhost, and this page is on ${currentHost()}. Open AgentOS from http://localhost:1420.`,
        kind: "insecure",
        detail,
        blocked: false,
      };
    default:
      return { message: "The microphone couldn't be started.", kind: "other", detail, blocked: false };
  }
}

/** The one place that decides whether this page may even ask. */
export function micSupportFailure(): MicFailure | undefined {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return describeMicFailure({ name: typeof window !== "undefined" && window.isSecureContext ? "NotFoundError" : "InsecureContext" });
  }
  return undefined;
}
