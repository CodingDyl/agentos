import { useCallback, useSyncExternalStore } from "react";
import type { ProjectSummary } from "@shared/agentos-types";

/**
 * Pinned and recently opened workspaces.
 *
 * Per-device preferences, so they live in the browser rather than the vault:
 * which workspaces sit in *this* sidebar is not a fact about the work, and
 * Hermes has no use for it. Every read is guarded — storage can be absent or
 * throw, and the sidebar must still render.
 */

const PINS_KEY = "agentos.workspaces.pinned";
const RECENT_KEY = "agentos.workspaces.recent";
const RECENT_LIMIT = 6;

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PINS_KEY || event.key === RECENT_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: the preference just does not stick.
  }
  for (const listener of listeners) listener();
}

function parseList(raw: string | null): string[] | undefined {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
  } catch {
    return undefined;
  }
}

/** The raw strings are the snapshot, so React compares them cheaply. */
function usePreference(key: string): string | null {
  return useSyncExternalStore(subscribe, () => read(key), () => null);
}

/**
 * Pinned slugs, or `undefined` when the operator has never pinned anything —
 * which is different from having unpinned everything.
 */
export function usePinnedWorkspaces(): {
  pinned: string[] | undefined;
  isPinned: (slug: string) => boolean;
  toggle: (slug: string, fallback: readonly string[]) => void;
} {
  const raw = usePreference(PINS_KEY);
  const pinned = parseList(raw);

  const isPinned = useCallback((slug: string) => (parseList(raw) ?? []).includes(slug), [raw]);

  // The first explicit toggle starts from what the sidebar was already showing,
  // so pinning one more workspace does not make the defaults vanish.
  const toggle = useCallback((slug: string, fallback: readonly string[]) => {
    const current = parseList(read(PINS_KEY)) ?? [...fallback];
    write(PINS_KEY, current.includes(slug) ? current.filter((entry) => entry !== slug) : [...current, slug]);
  }, []);

  return { pinned, isPinned, toggle };
}

/**
 * Which workspaces the sidebar lists.
 *
 * Explicit pins win. Before any pin exists, the live high-priority workspaces
 * stand in — the ones a person would pin on day one — so the sidebar is useful
 * before it has been configured.
 */
export function sidebarWorkspaces(projects: readonly ProjectSummary[], pinned: readonly string[] | undefined): ProjectSummary[] {
  if (pinned) {
    return pinned.flatMap((slug) => projects.filter((project) => project.slug === slug));
  }

  return projects.filter((project) => project.state === "active" && project.priority === "high");
}

export function useRecentWorkspaces(): string[] {
  return parseList(usePreference(RECENT_KEY)) ?? [];
}

export function recordRecentWorkspace(slug: string): void {
  const current = parseList(read(RECENT_KEY)) ?? [];
  if (current[0] === slug) return;
  write(RECENT_KEY, [slug, ...current.filter((entry) => entry !== slug)].slice(0, RECENT_LIMIT));
}

/** Read outside React — the palette ranks with it when it opens. */
export function readRecentWorkspaces(): string[] {
  return parseList(read(RECENT_KEY)) ?? [];
}
