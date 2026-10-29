import type { IndicatorTone } from "@/components/paper";
import type { VideoIdea } from "@shared/video-ideas-types";

/** What a video idea is doing, in plain words, with a tone for its dot. */
export function ideaStatus(idea: VideoIdea): { tone: IndicatorTone; label: string } {
  switch (idea.stage) {
    case "transcribing":
      return { tone: "amber", label: "Reading the transcript…" };
    case "needs_transcript":
      return { tone: "marigold", label: "No captions — paste a transcript" };
    case "noting":
      return { tone: "amber", label: "Writing your note…" };
    case "noted":
      return idea.mode === "assess" ? { tone: "amber", label: "Checking against AgentOS…" } : { tone: "green", label: "Note ready" };
    case "assessing":
      return { tone: "amber", label: "Checking against AgentOS…" };
    case "awaiting_decision":
      return { tone: "marigold", label: "Ready to decide" };
    case "declined":
      return { tone: "muted", label: "Declined" };
    case "planning":
      return { tone: "amber", label: "Planning the build…" };
    case "building": {
      const total = idea.taskIds.length;
      const at = Math.min((idea.currentTask ?? 0) + 1, total);
      return { tone: "amber", label: `Building task ${at} of ${total}` };
    }
    case "built":
      return { tone: "green", label: "Built" };
    case "failed":
      return { tone: "flame", label: "Stopped" };
  }
}

export const ideaHref = (idea: Pick<VideoIdea, "id">) => `/learning/ideas/${encodeURIComponent(idea.id)}`;

export const noteHref = (notePath: string) => `/memory?note=${encodeURIComponent(notePath)}`;

/** "4 min", "1 h 5 min": how long a run took, or has been running. */
export function runLength(startedAt: string, endedAt?: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round(((endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt)) / 60_000));
  if (minutes < 1) return "under a minute";
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
