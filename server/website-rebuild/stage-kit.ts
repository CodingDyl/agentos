import type { RebuildRun, RebuildStage, RebuildStageId } from "../../shared/website-rebuild-types";
import type { CaptureResult } from "./capture";

/** The shared vocabulary of the runner and the stage handlers, kept apart so neither imports the other. */

export class StageBlocked extends Error {}

export interface StageContext {
  run: RebuildRun;
  stage: RebuildStageId;
  /** This stage's record as the attempt started: revision, the job it may be resuming. */
  record: RebuildStage;
  /** The revision this attempt will produce. */
  revision: number;
  /** What the person asked to change on the last revision, if they did. */
  changeRequest?: string;
  /** Shown on the stage while it works, and renews the lease. */
  activity: (message: string) => void;
  log: (message: string, level?: "info" | "warning" | "error") => void;
  /** Writes a Markdown report into the workspace's documents and records it against this stage. */
  writeReport: (name: string, title: string, markdown: string) => Promise<string>;
  /** Copies a screenshot into the workspace and records it as an image of this revision. */
  writeImage: (name: string, title: string, file: string) => Promise<string>;
  /** Remembers the worker job this stage waits on, so a retry resumes it. */
  rememberJob: (jobId: string | null) => void;
}

export interface StageOutcome {
  summary: string;
  artifactIds: string[];
  ref?: string;
  worker?: string;
  jobId?: string;
}

export interface RunnerDeps {
  ensureWorkspace: (run: RebuildRun) => Promise<{ slug: string; reused: boolean }>;
  capture: (url: string, onProgress: (message: string) => void) => Promise<CaptureResult>;
  writeDocument: (relativePath: string, markdown: string) => Promise<void>;
  /** Copies a file into the vault at a vault-relative path. */
  writeBinary?: (relativePath: string, sourceFile: string) => Promise<void>;
  /** Whether the run's skill may run. Asked before every stage. */
  skillEnabled?: (skillId: string) => Promise<boolean>;
}

export type StageHandler = (context: StageContext, deps: RunnerDeps) => Promise<StageOutcome>;
