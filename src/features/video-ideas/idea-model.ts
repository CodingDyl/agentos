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

export type StepState = "done" | "active" | "waiting" | "needs_you" | "failed";
export type StepId = "transcript" | "note" | "assess" | "decide" | "build";

export interface IdeaStep {
  id: StepId;
  label: string;
  state: StepState;
}

const STEP_LABELS: Record<StepId, string> = {
  transcript: "Read the transcript",
  note: "Write your brief",
  assess: "Check it against AgentOS",
  decide: "Your decision",
  build: "Plan and build",
};

/** Where each stage sits on the steps, and how. */
const AT: Record<VideoIdea["stage"], { step: StepId; state: StepState }> = {
  transcribing: { step: "transcript", state: "active" },
  needs_transcript: { step: "transcript", state: "needs_you" },
  noting: { step: "note", state: "active" },
  noted: { step: "assess", state: "active" },
  assessing: { step: "assess", state: "active" },
  awaiting_decision: { step: "decide", state: "needs_you" },
  declined: { step: "decide", state: "done" },
  planning: { step: "build", state: "active" },
  building: { step: "build", state: "active" },
  built: { step: "build", state: "done" },
  failed: { step: "transcript", state: "failed" },
};

const FAILED_AT: Partial<Record<VideoIdea["stage"], StepId>> = {
  transcribing: "transcript",
  needs_transcript: "note",
  noting: "note",
  assessing: "assess",
  planning: "build",
  building: "build",
};

/** The steps this idea goes through, each marked done, active, waiting, stopped or needing Dylan. */
export function ideaSteps(idea: VideoIdea): IdeaStep[] {
  const ids: StepId[] =
    idea.mode === "learn" ? ["transcript", "note"] : idea.stage === "declined" ? ["transcript", "note", "assess", "decide"] : ["transcript", "note", "assess", "decide", "build"];
  // A learning-only idea is finished once it is noted.
  const at = idea.mode === "learn" && idea.stage === "noted" ? { step: "note" as StepId, state: "done" as StepState } : idea.stage === "failed" ? { step: FAILED_AT[idea.failedAt ?? "transcribing"] ?? "transcript", state: "failed" as StepState } : AT[idea.stage];
  const current = ids.indexOf(at.step);
  return ids.map((id, index) => ({
    id,
    label: STEP_LABELS[id],
    state: index < current ? "done" : index === current ? at.state : "waiting",
  }));
}

/** One sentence: who is doing what right now, or what is done. */
export function ideaHeadline(idea: VideoIdea): string {
  switch (idea.stage) {
    case "transcribing":
      return "Reading the video's captions";
    case "needs_transcript":
      return idea.error ?? "This video needs a transcript";
    case "noting":
      return "Claude is writing your brief";
    case "noted":
      return idea.mode === "assess" ? "Claude is checking it against AgentOS" : "Your note is ready";
    case "assessing":
      return "Claude is checking it against AgentOS";
    case "awaiting_decision":
      return "Ready for your decision";
    case "declined":
      return "Declined";
    case "planning":
      return "Claude is planning the build";
    case "building": {
      const total = idea.taskIds.length;
      return `Claude Code is building task ${Math.min((idea.currentTask ?? 0) + 1, total)} of ${total}`;
    }
    case "built":
      return "Built and merged";
    case "failed":
      return idea.error ?? "This stopped";
  }
}

/** Roughly how long the step now running usually takes. */
export function typicalWait(idea: VideoIdea): string | undefined {
  if (idea.stage === "transcribing") return "Usually a few seconds";
  if (idea.stage === "noting") return "Usually 1–3 minutes";
  if (idea.stage === "assessing" || (idea.stage === "noted" && idea.mode === "assess")) return "Usually 5–15 minutes";
  if (idea.stage === "planning") return "Usually 5–10 minutes";
  return undefined;
}

export const isIdeaWorking = (idea: VideoIdea) =>
  idea.stage === "transcribing" || idea.stage === "noting" || idea.stage === "assessing" || idea.stage === "planning" || idea.stage === "building" || (idea.stage === "noted" && idea.mode === "assess");

/** "1:05", "1:02:05": a stopwatch since `since`. */
export function elapsed(since: string, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Done, stopped or waiting on Dylan in the last day: worth a line in the tray until dismissed. */
export function isFinishedForTray(idea: VideoIdea, now = Date.now()): boolean {
  if (isIdeaWorking(idea)) return false;
  return now - Date.parse(idea.updatedAt) < 24 * 60 * 60 * 1000;
}
