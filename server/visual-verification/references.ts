import fs from "node:fs/promises";
import path from "node:path";
import type { VisualAcceptanceContext } from "../../shared/visual-verification-types";
import { readOptionalFile } from "../agentos/filesystem";
import { getLibrary } from "../designs/library";
import { resolveReferences, type ResolvedReference } from "../designs/review-context";

/**
 * Finding what the implementation was supposed to look like.
 *
 * The security property is the one `review-context` already establishes and
 * this module preserves: **the caller names assets, and only the server names
 * files.** A job carries ids and a board id; those are looked up in the design
 * library, and the library says which file on disk each one is. A path that the
 * library does not know about cannot be produced here.
 *
 * The rest of the module is about scope. A visual review is given the brief for
 * this feature, the references that were approved for it, and the design
 * system's own rules — not the whole vault, not every image ever uploaded, and
 * not the entire repository. A reviewer that can see everything will find
 * something to say about everything.
 */

/** Enough of a document to reason against, without sending the whole thing. */
const MAX_DOCUMENT_CHARS = 6_000;

/**
 * The design system, as the repository states it.
 *
 * Read from the worktree rather than the vault because it is the rule the
 * implementation is actually meant to comply with, and it lives beside the
 * code that has to obey it.
 */
const DESIGN_SYSTEM_FILES = ["DESIGN.md", "docs/DESIGN.md", "design/DESIGN.md"];

function clip(document: string | undefined): string | undefined {
  const trimmed = document?.trim();
  if (!trimmed) return undefined;

  return trimmed.length > MAX_DOCUMENT_CHARS
    ? `${trimmed.slice(0, MAX_DOCUMENT_CHARS)}\n…(truncated)`
    : trimmed;
}

/**
 * Every asset id this job's visual acceptance points at.
 *
 * A board and an explicit list are both allowed, and both are used: the board
 * says what the approved direction is, and the list says which of it bears on
 * this particular piece of work. Duplicates collapse, and order is kept so the
 * reviewer sees the explicitly named ones first.
 */
export async function referenceAssetIds(
  context: VisualAcceptanceContext,
): Promise<{ ids: string[]; missingBoard?: string }> {
  const ids = [...(context.referenceAssetIds ?? [])];

  if (!context.boardId) return { ids: [...new Set(ids)] };

  const library = await getLibrary();
  const board = library.boards.find((entry) => entry.id === context.boardId);

  if (!board) {
    // Reported rather than ignored: a job that named a board which no longer
    // exists was compared against less than someone thought it was.
    return { ids: [...new Set(ids)], missingBoard: context.boardId };
  }

  return { ids: [...new Set([...ids, ...board.assetIds])] };
}

export interface VisualContext {
  /** Approved references, resolved to files this process may read. */
  references: ResolvedReference[];
  /** Ids that named nothing in the library. */
  missing: string[];
  /** A board id that named nothing, when one did. */
  missingBoard?: string;
  /** The brief this work was drawn from, when it named one. */
  designBrief?: string;
  designBriefPath?: string;
  /** The repository's own design system rules, when it states any. */
  designSystem?: string;
  designSystemPath?: string;
}

/** The repository's design system document, if it has one. */
async function readDesignSystem(
  worktreePath: string,
): Promise<{ contents?: string; file?: string }> {
  for (const candidate of DESIGN_SYSTEM_FILES) {
    try {
      const contents = await fs.readFile(
        path.join(worktreePath, candidate),
        "utf8",
      );

      return { contents: clip(contents), file: candidate };
    } catch {
      continue;
    }
  }

  return {};
}

/**
 * Everything one visual review is allowed to see, besides the screenshots.
 *
 * Nothing here throws on an absence. A missing brief, an empty board and a
 * repository with no design system are all normal states — they make the
 * review thinner, which the verifier is told about, rather than making it
 * fail.
 */
export async function buildVisualContext(
  context: VisualAcceptanceContext,
  worktreePath: string,
): Promise<VisualContext> {
  const { ids, missingBoard } = await referenceAssetIds(context);

  const [{ references, missing }, brief, designSystem] = await Promise.all([
    resolveReferences(ids),
    context.designBriefPath
      ? readOptionalFile(context.designBriefPath).catch(() => undefined)
      : Promise.resolve(undefined),
    readDesignSystem(worktreePath),
  ]);

  return {
    references,
    missing,
    missingBoard,
    designBrief: clip(brief),
    designBriefPath: brief ? context.designBriefPath : undefined,
    designSystem: designSystem.contents,
    designSystemPath: designSystem.file,
  };
}
