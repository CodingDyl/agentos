import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getWorkspaceClonePath } from "../coder/workspace-setup";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { expandHome } from "../agentos/git";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { findProject, parseRepositoryPath } from "../agentos/projects";
import { ShipError } from "./error";

/**
 * The folder Ship acts on, and the guards every path passes before it does.
 *
 * Nothing here takes a path from a request. The folder comes from what the
 * workspace already records — PROJECT.md's `Local repository` (what Motion
 * Design, rebuilds and the Dev tab use), then its configured `Local path`, then
 * the Coder clone — and each candidate is resolved with `realpath` before it
 * is used, so a symlink is judged by where it really points.
 *
 * A folder that would put the whole machine, the home directory, the vault, or
 * AgentOS itself under Ship's git and package-manager commands is refused.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertShipSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new ShipError("That workspace was not found.", 404);
  return slug;
}

export async function requireKnownProject(slug: string): Promise<void> {
  assertShipSlug(slug);
  if (!(await findProject(slug))) throw new ShipError("That workspace was not found.", 404);
}

async function realOrSelf(target: string): Promise<string> {
  return fs.realpath(target).catch(() => path.resolve(target));
}

/** Whether `child` is `parent` or inside it, comparing resolved paths. */
export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Folders too broad to run git or a package manager in. */
async function tooBroad(real: string): Promise<boolean> {
  if (real === path.parse(real).root) return true;
  const protectedFolders = await Promise.all([os.homedir(), agentOSRoot(), process.cwd()].map(realOrSelf));
  // The folder itself, or anything that contains one of them.
  return protectedFolders.some((folder) => isWithin(real, folder));
}

/**
 * `candidate` resolved through symlinks, if it is an existing folder Ship may
 * act on. Throws for a folder that is too broad; `undefined` when absent.
 */
export async function guardProjectFolder(candidate: string): Promise<string | undefined> {
  if (!path.isAbsolute(candidate)) return undefined;
  let real: string;
  try {
    real = await fs.realpath(candidate);
    if (!(await fs.stat(real)).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  if (await tooBroad(real)) {
    throw new ShipError(`${candidate} is too broad a folder for Ship to run git or a package manager in. Point Local repository at the project's own folder.`, 409);
  }
  return real;
}

/**
 * `relative` joined onto `root`, proven to stay inside it after symlinks are
 * resolved. For a path that does not exist yet, its nearest existing ancestor
 * is what gets resolved.
 */
export async function resolveInside(root: string, relative: string): Promise<string> {
  const realRoot = await realOrSelf(root);
  const target = path.resolve(realRoot, relative);
  if (!isWithin(realRoot, target)) throw new ShipError("That path is outside the project.", 400);

  let existing = target;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(existing);
      const resolved = path.join(real, ...missing.reverse());
      if (!isWithin(realRoot, resolved)) throw new ShipError("That path is outside the project.", 400);
      return resolved;
    } catch (error) {
      if (error instanceof ShipError) throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new ShipError("That path is outside the project.", 400);
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

/** Every folder this workspace records, most specific first. Unresolved: callers guard them. */
export async function shipRootCandidates(slug: string): Promise<string[]> {
  const markdown = await readOptionalFile(`projects/${slug}/PROJECT.md`);
  const config = parseConfiguration(markdown);
  const coder = (() => {
    try {
      return getWorkspaceClonePath(slug);
    } catch {
      return undefined;
    }
  })();
  return [markdown ? parseRepositoryPath(markdown) : undefined, config.localPath ? expandHome(config.localPath) : undefined, coder].filter(
    (value): value is string => Boolean(value),
  );
}

/** The real folder Ship operates on, or `undefined` when the workspace records none that exists. */
export async function resolveShipRoot(slug: string): Promise<string | undefined> {
  await requireKnownProject(slug);
  for (const candidate of await shipRootCandidates(slug)) {
    const real = await guardProjectFolder(candidate);
    if (real) return real;
  }
  return undefined;
}

export async function requireShipRoot(slug: string): Promise<string> {
  const root = await resolveShipRoot(slug);
  if (!root) {
    throw new ShipError("This workspace has no project folder yet. Run Motion Design, link a GitHub repository, or add a Local repository line to PROJECT.md.", 409);
  }
  return root;
}
