import fs from "node:fs/promises";
import path from "node:path";

/**
 * Creating a new project's folder, e.g. `/Volumes/SSD/Developer/rankpulse`.
 *
 * The one place Operator writes outside the vault, so it is deliberately narrow:
 *
 * - **The parent is fixed.** Folders go under `AGENTOS_PROJECTS_ROOT` and
 *   nowhere else. A path is never taken from the request text: "put it in
 *   /etc" is not something a transcript can make happen.
 * - **The name is a slug.** Lower-case letters, digits and single hyphens, so
 *   it can't contain `..`, a separator, or anything a shell would read.
 * - **A missing root is reported, not recreated.** When the SSD is unplugged,
 *   `/Volumes/SSD` doesn't exist; `mkdir -p` would quietly make it on the boot
 *   disk and the project would land in the wrong place. The root must already
 *   be there.
 * - **It never adopts or overwrites.** An existing folder with that name is a
 *   refusal, decided by `mkdir` itself (no check-then-create race).
 * - **It resolves symlinks before it checks containment**, so a link inside the
 *   root can't point the new folder somewhere else.
 */

export const PROJECTS_ROOT_ENV = "AGENTOS_PROJECTS_ROOT";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 64;

export class ProjectFolderError extends Error {
  constructor(
    message: string,
    readonly code: "no-root" | "root-not-absolute" | "root-missing" | "root-not-directory" | "bad-name" | "exists" | "outside-root" | "failed",
  ) {
    super(message);
    this.name = "ProjectFolderError";
  }
}

export function configuredProjectsRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[PROJECTS_ROOT_ENV]?.trim() || undefined;
}

export function assertFolderName(slug: string): string {
  if (slug.length === 0 || slug.length > MAX_SLUG || !SLUG.test(slug)) {
    throw new ProjectFolderError(`“${slug}” can't be a folder name: use lower-case letters, digits and hyphens.`, "bad-name");
  }
  return slug;
}

/** The root, checked and with symlinks resolved. Throws with a sentence a person can act on. */
export async function resolveProjectsRoot(root: string | undefined = configuredProjectsRoot()): Promise<string> {
  if (!root) {
    throw new ProjectFolderError(
      `Choose where new projects go: set ${PROJECTS_ROOT_ENV} (e.g. /Volumes/SSD/Developer) in Connectors → Local filesystem.`,
      "no-root",
    );
  }
  if (!path.isAbsolute(root)) {
    throw new ProjectFolderError(`${PROJECTS_ROOT_ENV} must be a full path, like /Volumes/SSD/Developer.`, "root-not-absolute");
  }

  let real: string;
  try {
    real = await fs.realpath(root);
  } catch {
    throw new ProjectFolderError(
      `The projects folder ${root} isn't there. If it's on an external drive, plug it in; AgentOS won't create it for you.`,
      "root-missing",
    );
  }

  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new ProjectFolderError(`${root} is a file, not a folder.`, "root-not-directory");
  return real;
}

/** Where the folder would go, without creating anything. For plans and prechecks. */
export async function plannedFolder(slug: string, root?: string): Promise<string> {
  const real = await resolveProjectsRoot(root);
  const target = path.join(real, assertFolderName(slug));
  const relative = path.relative(real, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new ProjectFolderError("That folder would land outside the projects folder.", "outside-root");
  }

  try {
    await fs.lstat(target);
    throw new ProjectFolderError(`${target} already exists. AgentOS won't reuse or overwrite it; pick another name.`, "exists");
  } catch (error) {
    if (error instanceof ProjectFolderError) throw error;
    // Not there: which is what we want.
  }
  return target;
}

/**
 * Creates the folder and returns its absolute path. Verified by reading it
 * back as a directory before it reports success.
 */
export async function createProjectFolder(slug: string, root?: string): Promise<string> {
  const target = await plannedFolder(slug, root);

  try {
    // Not recursive: the parent must exist, and an existing folder fails here.
    await fs.mkdir(target, { mode: 0o755 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new ProjectFolderError(`${target} already exists.`, "exists");
    if (code === "EACCES" || code === "EPERM") throw new ProjectFolderError(`AgentOS isn't allowed to create folders in ${path.dirname(target)}.`, "failed");
    if (code === "EROFS") throw new ProjectFolderError(`${path.dirname(target)} is read-only.`, "failed");
    if (code === "ENOSPC") throw new ProjectFolderError(`${path.dirname(target)} is full.`, "failed");
    throw new ProjectFolderError(`The folder couldn't be created (${code ?? "unknown error"}).`, "failed");
  }

  const stat = await fs.stat(target).catch(() => undefined);
  if (!stat?.isDirectory()) throw new ProjectFolderError(`${target} was created but can't be read back.`, "failed");
  return target;
}
