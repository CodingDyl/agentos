import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "../session-store";
import { agentOSRoot, readOptionalFile, writeAgentOSFile } from "../filesystem";
import {
  RevisionConflictError,
  revisionOfOptional,
  type Revisioned,
} from "./revision";

/**
 * The only way AgentOS writes to the vault.
 *
 * Every mutation in the console funnels through `editFile`, and the shape of it
 * is the whole safety argument:
 *
 * ```text
 * read current file
 *       ↓
 * check it is the revision the edit was composed against   → 409 if not
 *       ↓
 * apply the change to the parsed document
 *       ↓
 * validate the result before it touches disk               → refuse if invalid
 *       ↓
 * back up what is about to be replaced
 *       ↓
 * write a temporary file, then rename over the target      → atomic
 * ```
 *
 * Three of those steps are the ones that matter.
 *
 * **The revision check** is what makes a hand-edited vault safe to put a UI on
 * top of. These files are still edited in an editor and written by Hermes, and
 * without this a screen loaded ten minutes ago would silently discard whatever
 * happened in between.
 *
 * **The validation step runs on the result, not the input.** Checking that a
 * request looks reasonable is not the same as checking that the document it
 * produces is still a document. A serializer bug that dropped half a file would
 * sail through input validation and be caught here.
 *
 * **The backup is taken before every write**, not on request. Undo is built on
 * it, but its real job is the case nobody plans for: a mutation that was
 * perfectly valid and still not what the operator meant.
 */

/** Where replaced content is kept. Outside the vault, like every other by-product. */
export function backupsDir(): string {
  return path.join(uiStateDir(), "backups");
}

/**
 * How many superseded versions of one file are kept.
 *
 * Enough to undo a bad afternoon, not enough to become a second copy of the
 * vault. This is a safety net, not version control — git is still there for
 * anything that deserves a real history.
 */
const BACKUPS_PER_FILE = 40;

/** A backup filename that sorts chronologically and never collides. */
function backupName(relativePath: string, at: Date): string {
  const flattened = relativePath.replace(/[\\/]/g, "__");
  const stamp = at.toISOString().replace(/[:.]/g, "-");

  return `${stamp}__${flattened}`;
}

export interface BackupEntry {
  /** The backup file's own name, used to restore it. */
  id: string;
  path: string;
  takenAt: string;
  /** What produced it, e.g. `task.move`. Shown in the undo affordance. */
  label: string;
  /** The root the path is relative to, when it is not the AgentOS vault. */
  root?: string;
}

/** Reads the label and original path back out of a backup's sidecar. */
async function readBackupMeta(id: string): Promise<BackupEntry | undefined> {
  try {
    const raw = await fs.readFile(path.join(backupsDir(), `${id}.json`), "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) return undefined;

    const meta = parsed as Record<string, unknown>;

    if (typeof meta.path !== "string" || typeof meta.takenAt !== "string") {
      return undefined;
    }

    return {
      id,
      path: meta.path,
      takenAt: meta.takenAt,
      label: typeof meta.label === "string" ? meta.label : "Edit",
      root: typeof meta.root === "string" ? meta.root : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Keeps the most recent backups for one file and removes the rest.
 *
 * Pruned per file rather than globally so a busy TASKS.md cannot push every
 * other file's history out of reach.
 */
async function prune(relativePath: string): Promise<void> {
  const suffix = `__${relativePath.replace(/[\\/]/g, "__")}`;

  try {
    const entries = await fs.readdir(backupsDir());

    const mine = entries
      .filter((entry) => entry.endsWith(suffix))
      .sort()
      .reverse();

    for (const stale of mine.slice(BACKUPS_PER_FILE)) {
      await fs.rm(path.join(backupsDir(), stale), { force: true });
      await fs.rm(path.join(backupsDir(), `${stale}.json`), { force: true });
    }
  } catch {
    // A pruning failure is not a reason to fail the write it followed.
  }
}

/**
 * Copies the about-to-be-replaced contents aside.
 *
 * Never throws into the write it is protecting: losing the ability to undo is
 * bad, and failing an edit the operator asked for because of it is worse.
 */
async function backup(
  relativePath: string,
  contents: string,
  label: string,
  root?: string,
): Promise<string | undefined> {
  try {
    await fs.mkdir(backupsDir(), { recursive: true });

    const id = backupName(relativePath, new Date());

    await fs.writeFile(path.join(backupsDir(), id), contents, "utf8");
    await fs.writeFile(
      path.join(backupsDir(), `${id}.json`),
      JSON.stringify({ path: relativePath, takenAt: new Date().toISOString(), label, root }),
      "utf8",
    );

    void prune(relativePath);

    return id;
  } catch (error) {
    console.error("[agentos] could not back up before writing:", error);
    return undefined;
  }
}

/** Raised when a change would produce a document AgentOS refuses to write. */
export class DocumentInvalidError extends Error {
  readonly code = "document_invalid";

  constructor(reason: string) {
    super(reason);
    this.name = "DocumentInvalidError";
  }
}

export interface EditResult {
  revision: string;
  /** The backup that can undo this edit, when one was taken. */
  undoId?: string;
}

export interface EditOptions {
  /** Vault-relative, e.g. `projects/pantry-pilot/TASKS.md`. */
  relativePath: string;
  /**
   * The revision the edit was composed against.
   *
   * Omitted only where a caller genuinely has no prior read — creating a
   * project's files, for instance. Everything a person edited on screen has
   * one, and passing it is what makes the edit safe.
   */
  expectedRevision?: string;
  /** Names the change for the undo affordance, e.g. `task.complete`. */
  label: string;
  /** Produces the new contents. Receives `undefined` for a file that is absent. */
  apply: (current: string | undefined) => string;
  /**
   * The root `relativePath` is inside. Defaults to the AgentOS vault; memory
   * passes its own, which is usually the same folder but may be configured
   * apart.
   */
  root?: string;
  /**
   * Whether to refuse results that lost their title or most of their content.
   * On by default — it catches serializer bugs. Off only for a person's own
   * free-text edit of a note, where shortening it is the point.
   */
  checkShape?: boolean;
}

/**
 * The minimum a written document has to satisfy.
 *
 * Deliberately thin. This is a guard against a serializer bug, not a schema:
 * the vault is a person's own notes and AgentOS has no business refusing a file
 * because it does not like the prose. It catches the failure that actually
 * matters — a mutation that produced nothing, or lost the document's title.
 */
function validate(relativePath: string, next: string, previous?: string): void {
  if (next.trim().length === 0) {
    throw new DocumentInvalidError(
      `Refusing to write an empty ${path.basename(relativePath)}.`,
    );
  }

  if (previous === undefined) return;

  const hadHeading = /^#\s+\S/m.test(previous);

  if (hadHeading && !/^#\s+\S/m.test(next)) {
    throw new DocumentInvalidError(
      `Refusing to write a ${path.basename(relativePath)} that lost its title.`,
    );
  }

  // A mutation is an edit, not a rewrite. Losing most of a file is the shape a
  // parser bug takes, and it is worth refusing even when the result is
  // technically well-formed.
  if (previous.length > 400 && next.length < previous.length / 3) {
    throw new DocumentInvalidError(
      `Refusing to write a ${path.basename(relativePath)} that lost most of its content.`,
    );
  }
}

/**
 * Applies one change to one vault file.
 *
 * The single write path. Nothing else in the server is permitted to call
 * `writeAgentOSFile` for project state, because everything protective lives
 * here rather than in the callers.
 */
export async function editFile(options: EditOptions): Promise<EditResult> {
  const current = await readOptionalFile(options.relativePath, options.root);
  const actual = revisionOfOptional(current);

  if (
    options.expectedRevision !== undefined &&
    options.expectedRevision !== actual
  ) {
    throw new RevisionConflictError(
      options.relativePath,
      options.expectedRevision,
      actual,
    );
  }

  const next = options.apply(current);

  // Nothing changed. Not an error, and not worth a backup or a disk write.
  if (current !== undefined && next === current) {
    return { revision: actual };
  }

  if (options.checkShape === false) {
    if (next.trim().length === 0) {
      throw new DocumentInvalidError(`Refusing to write an empty ${path.basename(options.relativePath)}.`);
    }
  } else {
    validate(options.relativePath, next, current);
  }

  const undoId =
    current === undefined
      ? undefined
      : await backup(options.relativePath, current, options.label, options.root);

  await writeAgentOSFile(options.relativePath, next, options.root);

  return { revision: revisionOfOptional(next), undoId };
}

/** Reads a vault file together with the revision it was read at. */
export async function readForEdit(
  relativePath: string,
): Promise<Revisioned<string | undefined>> {
  const contents = await readOptionalFile(relativePath);

  return { data: contents, revision: revisionOfOptional(contents) };
}

/** Recent backups, newest first. What the undo affordance offers. */
export async function listBackups(limit = 20): Promise<BackupEntry[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(backupsDir());
  } catch {
    return [];
  }

  const ids = entries
    .filter((entry) => !entry.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);

  const metas = await Promise.all(ids.map((id) => readBackupMeta(id)));

  return metas.filter((meta): meta is BackupEntry => meta !== undefined);
}

/**
 * Puts a backup back.
 *
 * Deliberately not a revision-checked edit: undo is what an operator reaches
 * for when something already went wrong, and refusing it because the file has
 * moved again would withhold the one tool that helps. It takes its own backup
 * first, so an undo can itself be undone.
 */
export async function restoreBackup(id: string): Promise<EditResult | undefined> {
  // Only ever a name this module generated — never a path from a request.
  if (!/^[\w.-]+__[\w.-]+$/.test(id)) return undefined;

  const meta = await readBackupMeta(id);
  if (!meta) return undefined;

  let contents: string;

  try {
    contents = await fs.readFile(path.join(backupsDir(), id), "utf8");
  } catch {
    return undefined;
  }

  return editFile({
    relativePath: meta.path,
    root: meta.root,
    label: `undo:${meta.label}`,
    apply: () => contents,
  });
}

/**
 * A backup's contents and where it belongs, for an undo that has its own
 * conflict rule (memory refuses to undo over a later edit).
 */
export async function readBackup(id: string): Promise<{ meta: BackupEntry; contents: string } | undefined> {
  // A bare file name this module made: never a path, never hidden.
  if (!id || path.basename(id) !== id || id.startsWith(".") || id.endsWith(".json")) return undefined;

  const meta = await readBackupMeta(id);
  if (!meta) return undefined;

  try {
    return { meta, contents: await fs.readFile(path.join(backupsDir(), id), "utf8") };
  } catch {
    return undefined;
  }
}

/** Where a project's files live. Slugs are validated before they get here. */
export function projectFile(slug: string, file: string): string {
  return path.posix.join("projects", slug, file);
}

/** Whether the vault root is somewhere this process may write at all. */
export function vaultRoot(): string {
  return agentOSRoot();
}
