import { readOptionalFile } from "../agentos/filesystem";
import { findStoredAsset } from "./library";
import { ORIGINALS, resolveMedia } from "./media";

/**
 * Turning a selection of design assets into something Hermes can look at.
 *
 * The security property of this module is the whole reason it exists: **the
 * browser names assets, and only the server names files.** A request carries
 * ids; those ids are looked up in the library; the library says which file on
 * disk each one is. A path the library does not know about cannot be produced
 * here, so a crafted request cannot point Hermes at anything else on the
 * machine.
 *
 * The context sent alongside is scoped for the same reason a worker's is: a
 * design review needs to know what the project is and what has been decided
 * about it, and nothing else about the vault.
 */

const PROJECTS_DIR = "projects";

/** Enough of a document to reason against, without sending the whole thing. */
const MAX_DOCUMENT_CHARS = 3_000;

export interface ResolvedReference {
  assetId: string;
  /** The file on disk. Never derived from anything the browser sent. */
  path: string;
  filename: string;
  /** What the library already knows about it, which Hermes need not guess. */
  tags: string[];
  notes?: string;
}

export interface ReviewContext {
  references: ResolvedReference[];
  /** Ids that named nothing in the library, reported rather than skipped. */
  missing: string[];
  projectContext: string;
}

/**
 * Resolves asset ids to files.
 *
 * An id that names nothing is collected rather than thrown on: a board with
 * one stale reference should still be reviewable, and the caller can say which
 * one was dropped instead of failing the whole request.
 */
export async function resolveReferences(
  assetIds: readonly string[],
): Promise<{ references: ResolvedReference[]; missing: string[] }> {
  const references: ResolvedReference[] = [];
  const missing: string[] = [];

  for (const assetId of assetIds) {
    const asset = await findStoredAsset(assetId);

    if (!asset) {
      missing.push(assetId);
      continue;
    }

    references.push({
      assetId: asset.id,
      // The only place a path is produced, and only from the stored name the
      // library itself wrote.
      path: resolveMedia(ORIGINALS, asset.storedName),
      filename: asset.filename,
      tags: asset.tags,
      notes: asset.notes,
    });
  }

  return { references, missing };
}

function clip(document: string | undefined, label: string): string | undefined {
  const trimmed = document?.trim();
  if (!trimmed) return undefined;

  const body =
    trimmed.length > MAX_DOCUMENT_CHARS
      ? `${trimmed.slice(0, MAX_DOCUMENT_CHARS)}\n…(truncated)`
      : trimmed;

  return `--- ${label} ---\n${body}`;
}

/**
 * What the project is, for a review to be about it rather than about images.
 *
 * Three documents and an optional design brief. Not `TASKS.md`: a review is
 * asking what direction to take, and a list of open work would pull the answer
 * towards whatever happens to be queued.
 */
export async function projectContext(slug: string): Promise<string> {
  const directory = `${PROJECTS_DIR}/${slug}`;

  const [project, status, decisions, brief] = await Promise.all([
    readOptionalFile(`${directory}/PROJECT.md`),
    readOptionalFile(`${directory}/STATUS.md`),
    readOptionalFile(`${directory}/DECISIONS.md`),
    readOptionalFile(`${directory}/design/BRIEF.md`),
  ]);

  return [
    clip(project, "PROJECT.md"),
    clip(status, "STATUS.md"),
    clip(decisions, "DECISIONS.md"),
    clip(brief, "design/BRIEF.md"),
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n");
}

/** Everything one review needs, resolved from ids the browser sent. */
export async function buildReviewContext(
  slug: string,
  assetIds: readonly string[],
): Promise<ReviewContext> {
  const [{ references, missing }, context] = await Promise.all([
    resolveReferences(assetIds),
    projectContext(slug),
  ]);

  return { references, missing, projectContext: context };
}
