import { createHash } from "node:crypto";

/**
 * What "the file I read" means.
 *
 * A revision is a hash of the exact bytes a reader was shown. It exists for one
 * reason: the vault is a set of files a person still edits by hand, in an
 * editor, at the same time as the console is open — and Hermes writes to them
 * too. Any of those can move the ground under a screen that loaded a minute
 * ago.
 *
 * A mutation therefore carries the revision it was composed against, and the
 * writer refuses it if the file has changed since. That turns the dangerous
 * case — two writers, last one wins, silent loss — into a visible conflict the
 * operator resolves.
 *
 * Content-addressed rather than a counter or an mtime: a counter needs somewhere
 * to live and drifts the moment a file is edited outside AgentOS, and mtime
 * lies on copies, restores, and filesystems with coarse timestamps. The bytes
 * are the only thing that cannot disagree with itself.
 */

/** The revision of a file's contents. */
export function revisionOf(contents: string): string {
  return `sha256:${createHash("sha256").update(contents, "utf8").digest("hex").slice(0, 32)}`;
}

/**
 * The revision of a file that does not exist yet.
 *
 * Creating a file is still a write that can conflict — two screens both
 * offering to create `TASKS.md` should not both succeed, with one silently
 * discarding the other. An absent file has a revision like any other, and it
 * is distinct from the revision of an empty one.
 */
export const ABSENT_REVISION = "sha256:absent";

export function revisionOfOptional(contents: string | undefined): string {
  return contents === undefined ? ABSENT_REVISION : revisionOf(contents);
}

/** Anything read for editing carries the revision it was read at. */
export interface Revisioned<T> {
  data: T;
  revision: string;
}

/**
 * Raised when a file moved under a pending edit.
 *
 * Carries the current revision so the caller can re-read and show what changed,
 * rather than only reporting that something did.
 */
export class RevisionConflictError extends Error {
  readonly code = "revision_conflict";

  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`${path} changed since it was read.`);
    this.name = "RevisionConflictError";
  }
}
