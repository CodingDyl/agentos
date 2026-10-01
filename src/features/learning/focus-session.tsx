import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FocusContext, type FocusSession } from "./focus-session-context";

/**
 * A focus session: which workspace (and task) the time is going to, since
 * when, and — only if wanted — what music plays.
 *
 * Started alongside "Start focus", which still opens the console exactly as
 * before; the session is a timer beside it, not a dependency of it. Music is
 * optional and Spotify being missing, off or signed out changes nothing about
 * the session except that there is no music picker.
 *
 * Kept in this browser's storage so a reload doesn't lose the timer. That is a
 * per-viewer convenience; nothing else depends on it.
 */

const STORAGE_KEY = "agentos.focus-session";

function load(): FocusSession | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as FocusSession;
    return typeof parsed.project === "string" && typeof parsed.startedAt === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function store(session: FocusSession | undefined): void {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the session lasts as long as the page.
  }
}

export function FocusSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<FocusSession | undefined>(() => (typeof window === "undefined" ? undefined : load()));

  useEffect(() => store(session), [session]);

  const start = useCallback((input: { project: string; projectName?: string; taskId?: string }) => {
    setSession((current) =>
      // Starting focus on the workspace already in focus keeps its timer.
      current && current.project === input.project && (!input.taskId || current.taskId === input.taskId)
        ? current
        : { ...input, startedAt: new Date().toISOString() },
    );
  }, []);

  const setMusic = useCallback((music: FocusSession["music"]) => setSession((current) => (current ? { ...current, music } : current)), []);
  const end = useCallback(() => setSession(undefined), []);

  const controls = useMemo(() => ({ session, start, setMusic, end }), [end, session, setMusic, start]);
  return <FocusContext.Provider value={controls}>{children}</FocusContext.Provider>;
}
