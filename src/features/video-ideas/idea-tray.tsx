import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PAPER_FOCUS } from "@/components/paper";
import { useVideoIdeas } from "@/lib/agentos/video-ideas";
import { cn } from "@/lib/utils";
import type { VideoIdea } from "@shared/video-ideas-types";
import { ideaHref, isFinishedForTray, isIdeaWorking } from "./idea-model";
import { IdeaProgressLine } from "./idea-progress";

const DISMISSED_KEY = "agentos.video-ideas.tray-dismissed";
const COLLAPSED_KEY = "agentos.video-ideas.tray-collapsed";

/** A stage dismissed is gone; the next stage of the same idea shows again. */
const stamp = (idea: VideoIdea) => `${idea.id}:${idea.stage}`;

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: the tray still works, it just forgets.
  }
}

/**
 * Video ideas at work, on every screen: a spinner and a stopwatch while an AI
 * reads, writes or checks, and a tick when it is done, until dismissed.
 */
export function IdeaTray() {
  const ideas = useVideoIdeas();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(() => readSet(DISMISSED_KEY));
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const shown = (ideas.data ?? []).filter((idea) => (isIdeaWorking(idea) || isFinishedForTray(idea)) && !dismissed.has(stamp(idea)));
  // The idea's own page already shows all of this.
  const onIdeaPage = shown.length === 1 && location.pathname === ideaHref(shown[0]);
  if (shown.length === 0 || onIdeaPage) return null;

  const working = shown.filter(isIdeaWorking).length;
  const dismiss = (idea: VideoIdea) => {
    const next = new Set(dismissed).add(stamp(idea));
    setDismissed(next);
    write(DISMISSED_KEY, [...next].slice(-200));
  };
  const toggle = () => {
    setCollapsed(!collapsed);
    write(COLLAPSED_KEY, !collapsed);
  };

  return (
    <aside
      aria-label="Video ideas in progress"
      className="fixed right-4 bottom-10 z-40 w-[340px] max-w-[calc(100vw-2rem)] border border-paper-ash bg-paper-cream font-paper-ui text-paper-moss shadow-[0_8px_24px_-8px_rgb(0_0_0/0.35)]"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className={cn("flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-paper-stone", PAPER_FOCUS)}
      >
        <span className="text-[13px] font-medium">
          {working > 0
            ? `Video ideas · ${working} working`
            : shown.some((idea) => idea.stage === "failed" || idea.stage === "needs_transcript" || idea.stage === "awaiting_decision")
              ? "Video ideas · needs you"
              : "Video ideas · done"}
        </span>
        {collapsed ? <ChevronUp className="size-4 text-paper-sage" aria-hidden="true" /> : <ChevronDown className="size-4 text-paper-sage" aria-hidden="true" />}
      </button>
      {collapsed ? null : (
        <ul className="max-h-[50vh] divide-y divide-paper-stone overflow-y-auto border-t border-paper-stone">
          {shown.map((idea) => (
            <li key={idea.id} className="flex items-start gap-1">
              <Link to={ideaHref(idea)} className={cn("min-w-0 flex-1 px-3.5 py-2.5 hover:bg-paper-stone", PAPER_FOCUS)}>
                <span className="block truncate text-[13px] font-medium">{idea.title}</span>
                <IdeaProgressLine idea={idea} className="mt-0.5" />
              </Link>
              {isIdeaWorking(idea) ? null : (
                <button
                  type="button"
                  onClick={() => dismiss(idea)}
                  aria-label={`Dismiss ${idea.title}`}
                  className={cn("mt-2 mr-1.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
