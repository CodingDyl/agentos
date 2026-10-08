import { z } from "zod";

/**
 * A project's repository, as the console sees and acts on it.
 *
 * Reads are total — every field that could fail to load has a shape for
 * "could not", because the repository view must render for a project whose
 * `PROJECT.md` links nothing, or links a path that has since moved.
 *
 * Writes are a closed set. There is no discard, no reset, no force, no push,
 * no merge and no rebase in this union, and that is the design rather than an
 * omission: the actions here exist to unblock a reviewed job, and every one
 * of them is reversible.
 */

export const BranchSummarySchema = z.object({
  name: z.string(),
  current: z.boolean(),
  /** Commits this branch has that its upstream does not. */
  ahead: z.number(),
  /** Commits its upstream has that this branch does not. */
  behind: z.number(),
  upstream: z.string().optional(),
  lastCommitAt: z.string().optional(),
  lastCommitSubject: z.string().optional(),
});

export const UncommittedFileSchema = z.object({
  path: z.string(),
  /** The raw two-letter porcelain code, kept for the tooltip. */
  code: z.string(),
  staged: z.boolean(),
  untracked: z.boolean(),
});

export const RepositoryCommitSchema = z.object({
  hash: z.string(),
  date: z.string(),
  subject: z.string(),
  author: z.string(),
});

/**
 * A job waiting on a branch.
 *
 * `baseMoved` is the interesting one: it is the advanced-base condition that
 * makes a reviewed job un-integrable, surfaced on the branch itself so it is
 * visible before the operator opens the job and finds out.
 */
export const BranchPinSchema = z.object({
  jobId: z.string(),
  branch: z.string(),
  status: z.string(),
  objective: z.string(),
  baseMoved: z.boolean(),
  live: z.boolean(),
});

export const RepositoryStatusSchema = z.object({
  slug: z.string(),
  repositoryPath: z.string().optional(),
  branch: z.string().optional(),
  head: z.string().optional(),
  workingTree: z.enum(["clean", "modified"]).optional(),
  branches: z.array(BranchSummarySchema),
  uncommitted: z.array(UncommittedFileSchema),
  recentCommits: z.array(RepositoryCommitSchema),
  pins: z.array(BranchPinSchema),
  /**
   * macOS `._*` sidecar files sitting untracked in the repository, which an
   * exFAT or network drive creates beside every file. Linters and test runners
   * read them as source and fail on them.
   */
  metadataFiles: z.number().optional(),
  /** Why no write may happen right now — usually a job is running. */
  writeBlocker: z.string().optional(),
  /** Why there is nothing to show at all. */
  unavailable: z.string().optional(),
});

/** Everything AgentOS is willing to do to a real repository. */
export const RepositoryActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("switch"), branch: z.string().min(1) }),
  z.object({ kind: z.literal("stash"), message: z.string().optional() }),
  z.object({ kind: z.literal("commit"), message: z.string().min(1) }),
  z.object({ kind: z.literal("branch"), name: z.string().min(1) }),
  /** Deletes untracked `._*` sidecar files only, and keeps git ignoring them. */
  z.object({ kind: z.literal("clean_metadata") }),
]);

export const RepositoryActionResultSchema = z.object({
  ok: z.boolean(),
  detail: z.string(),
  status: RepositoryStatusSchema.optional(),
});

/** A name pointing at a commit: a branch, a remote branch, a tag, or a worker's scratch branch. */
export const GraphRefSchema = z.object({
  name: z.string(),
  kind: z.enum(["branch", "remote", "tag", "worker"]),
  /** The branch HEAD is on. */
  current: z.boolean(),
});

/** One line segment between two lanes, from this row's top, through the commit, to its bottom. */
export const GraphEdgeSchema = z.object({
  kind: z.enum(["through", "in", "out"]),
  from: z.number(),
  to: z.number(),
  color: z.number(),
});

export const GraphCommitSchema = z.object({
  hash: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
  parents: z.array(z.string()),
  refs: z.array(GraphRefSchema),
  /** The lane the commit's dot sits in. */
  lane: z.number(),
  color: z.number(),
  edges: z.array(GraphEdgeSchema),
});

export const RepositoryGraphSchema = z.object({
  commits: z.array(GraphCommitSchema),
  /** Lanes the widest row needs. */
  lanes: z.number(),
  /** More history exists than was read. */
  truncated: z.boolean(),
  /** Worker scratch branches were left out of the drawing. */
  workersHidden: z.boolean(),
  unavailable: z.string().optional(),
});

export type GraphRef = z.infer<typeof GraphRefSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphCommit = z.infer<typeof GraphCommitSchema>;
export type RepositoryGraph = z.infer<typeof RepositoryGraphSchema>;
export type BranchSummary = z.infer<typeof BranchSummarySchema>;
export type UncommittedFile = z.infer<typeof UncommittedFileSchema>;
export type RepositoryCommit = z.infer<typeof RepositoryCommitSchema>;
export type BranchPin = z.infer<typeof BranchPinSchema>;
export type RepositoryStatus = z.infer<typeof RepositoryStatusSchema>;
export type RepositoryAction = z.infer<typeof RepositoryActionSchema>;
export type RepositoryActionResult = z.infer<typeof RepositoryActionResultSchema>;
