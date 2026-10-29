import matter from "gray-matter";
import { WORKING_STAGES, type IdeaStage, type VideoIdea } from "../../shared/video-ideas-types";
import { readOptionalFile } from "../agentos/filesystem";
import { getSource } from "../learning/library";
import { readJob } from "../workers/job-store";
import { fileAssessment, launchAssessment } from "./assessment";
import { advanceBuild } from "./build";
import { writeKnowledgeNote } from "./note";
import { filePlan, launchPlan } from "./plan";
import { getIdea, listIdeas, updateIdea, VideoIdeaError } from "./store";
import { rootsOfJob } from "./studio";
import { fetchCaptions, linesFromPaste, type TranscriptLine } from "./transcript";

/**
 * Moves each video idea on by one step at a time, from wherever it was left.
 *
 * Everything an idea needs is in its record, so a server restart loses
 * nothing: a sweep every 15 seconds picks each one up. A note cut off by a
 * restart starts again from the transcript; a worker job that vanished fails
 * the idea with Retry, never leaves it "assessing" forever.
 */

export interface PipelineDeps {
  captions: (videoId: string) => Promise<TranscriptLine[] | undefined>;
  /** A transcript already filed (pasted, or fetched before a restart). */
  storedTranscript: (path: string) => Promise<TranscriptLine[] | undefined>;
  note: (idea: VideoIdea, lines: TranscriptLine[]) => Promise<VideoIdea>;
  assess: (idea: VideoIdea) => Promise<VideoIdea>;
  jobStatus: (jobId: string) => Promise<string | undefined>;
  fileAssessment: (idea: VideoIdea) => Promise<VideoIdea>;
  plan: (idea: VideoIdea) => Promise<VideoIdea>;
  filePlan: (idea: VideoIdea) => Promise<VideoIdea>;
  build: (idea: VideoIdea) => Promise<VideoIdea>;
}

export async function writeNoteFor(idea: VideoIdea, lines: TranscriptLine[]): Promise<VideoIdea> {
  const source = getSource(idea.sourceId);
  if (!source) throw new Error("The saved video is no longer in the library.");
  return writeKnowledgeNote(idea, source, lines);
}

async function readStoredTranscript(path: string): Promise<TranscriptLine[] | undefined> {
  const file = await readOptionalFile(path);
  if (!file) return undefined;
  const lines = linesFromPaste(matter(file).content.replace(/^# .*\n+/, ""));
  return lines.length > 0 ? lines : undefined;
}

export const defaultPipelineDeps: PipelineDeps = {
  captions: (videoId) => fetchCaptions(videoId),
  storedTranscript: readStoredTranscript,
  note: writeNoteFor,
  assess: launchAssessment,
  jobStatus: async (jobId) => (await readJob(jobId))?.status,
  fileAssessment: async (idea) => fileAssessment(idea, idea.jobId ? await rootsOfJob(idea.jobId) : []),
  plan: launchPlan,
  filePlan: async (idea) => filePlan(idea, idea.jobId ? await rootsOfJob(idea.jobId) : []),
  build: (idea) => advanceBuild(idea),
};

const FILED = new Set(["completed", "awaiting_review"]);
const STOPPED = new Set(["failed", "cancelled", "rejected"]);

/** Waits for a studio job, then files what it wrote. */
/** How long a claimed step may wait for its job to be recorded before it counts as lost. */
const LAUNCH_GRACE_MS = 2 * 60 * 1000;

async function settleJob(idea: VideoIdea, stage: IdeaStage, deps: PipelineDeps, file: (idea: VideoIdea) => Promise<VideoIdea>): Promise<VideoIdea> {
  // Approved or retried a moment ago: the job is still being started.
  if (!idea.jobId && Date.now() - Date.parse(idea.updatedAt) < LAUNCH_GRACE_MS) return idea;
  const status = idea.jobId ? await deps.jobStatus(idea.jobId) : undefined;
  if (status && FILED.has(status)) return file(idea);
  if (!status || STOPPED.has(status)) {
    return updateIdea(idea.id, { stage: "failed", failedAt: stage, error: `The ${stage === "assessing" ? "assessment" : "plan"} run stopped (${status ?? "missing"}).` });
  }
  return idea;
}

async function step(idea: VideoIdea, deps: PipelineDeps): Promise<VideoIdea> {
  switch (idea.stage) {
    case "transcribing":
    case "noting": {
      const lines = (idea.transcriptPath ? await deps.storedTranscript(idea.transcriptPath) : undefined) ?? (await deps.captions(idea.videoId));
      if (!lines) return updateIdea(idea.id, { stage: "needs_transcript", error: "This video has no captions" });
      return deps.note(updateIdea(idea.id, { stage: "noting", error: undefined }), lines);
    }
    case "noted":
      return idea.mode === "assess" ? deps.assess(idea) : idea;
    case "assessing":
      return settleJob(idea, "assessing", deps, deps.fileAssessment);
    case "planning":
      return settleJob(idea, "planning", deps, deps.filePlan);
    case "building":
      return deps.build(idea);
    default:
      return idea;
  }
}

/** Ideas a step is being taken for right now, so a sweep and a request never take the same one twice. */
const inFlight = new Set<string>();

export async function advanceIdea(idea: VideoIdea, deps: PipelineDeps = defaultPipelineDeps): Promise<VideoIdea> {
  if (inFlight.has(idea.id)) return idea;
  inFlight.add(idea.id);
  try {
    return await step(idea, deps);
  } catch (error) {
    const failedAt = idea.stage === "noting" ? "transcribing" : idea.stage;
    return updateIdea(idea.id, { stage: "failed", failedAt, error: error instanceof Error ? error.message : String(error) });
  } finally {
    inFlight.delete(idea.id);
  }
}

/** Where a failed idea goes back to. */
const RETRY_FROM: Partial<Record<IdeaStage, IdeaStage>> = {
  transcribing: "transcribing",
  noting: "transcribing",
  needs_transcript: "transcribing",
  assessing: "noted",
  planning: "planning",
  building: "building",
};

export async function retryIdea(id: string, deps: PipelineDeps = defaultPipelineDeps): Promise<VideoIdea> {
  const idea = getIdea(id);
  if (!idea) throw new VideoIdeaError("There is no video idea with that id.", 404);
  if (idea.stage !== "failed") throw new VideoIdeaError("Only a failed idea can be retried.", 409);
  const back = RETRY_FROM[idea.failedAt ?? "transcribing"] ?? "transcribing";
  const reset = updateIdea(id, { stage: back, error: undefined, jobId: undefined });
  // A plan run is relaunched now; everything else is picked up by the next step.
  return back === "planning" ? deps.plan(reset) : reset;
}

export async function sweepIdeas(deps: PipelineDeps = defaultPipelineDeps): Promise<void> {
  for (const idea of listIdeas()) {
    if (!WORKING_STAGES.includes(idea.stage) && !(idea.stage === "noted" && idea.mode === "assess")) continue;
    await advanceIdea(idea, deps);
  }
}

let sweeping = false;
let sweepTimer: NodeJS.Timeout | undefined;

/** Starts the sweep. Safe to call twice. */
export function startVideoIdeaSweep(): void {
  if (sweepTimer) return;
  const sweep = () => {
    if (sweeping) return;
    sweeping = true;
    void sweepIdeas()
      .catch((error) => console.error("[agentos] video ideas sweep failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        sweeping = false;
      });
  };
  sweepTimer = setInterval(sweep, 15_000);
  sweepTimer.unref?.();
  sweep();
}
