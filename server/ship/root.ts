import fs from "node:fs/promises";
import path from "node:path";
import { getWorkspaceClonePath } from "../coder/workspace-setup";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { expandHome } from "../agentos/git";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { findProject, parseRepositoryPath } from "../agentos/projects";
import { siteRepoPath } from "../motion-design/site-repo";
import { ShipError } from "./error";

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function hasPackageJson(target: string): Promise<boolean> {
  try {
    await fs.access(path.join(target, "package.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The folder Ship operates on: the generated site, a linked local path, the
 * Connected Systems repo, a Coder clone, or the vault project itself.
 */
export async function resolveShipRoot(slug: string): Promise<string | undefined> {
  const project = await findProject(slug);
  if (!project) return undefined;

  const markdown = await readOptionalFile(`projects/${slug}/PROJECT.md`);
  const config = parseConfiguration(markdown);
  const connected = markdown ? parseRepositoryPath(markdown) : undefined;

  const coderPath = (() => {
    try {
      return getWorkspaceClonePath(slug);
    } catch {
      return undefined;
    }
  })();

  const candidates = [
    config.localPath ? expandHome(config.localPath) : undefined,
    connected,
    siteRepoPath(slug),
    coderPath,
    path.join(agentOSRoot(), "projects", slug),
  ].filter((value): value is string => Boolean(value));

  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) existing.push(candidate);
  }

  const withPackage = [];
  for (const candidate of existing) {
    if (await hasPackageJson(candidate)) withPackage.push(candidate);
  }
  return withPackage[0] ?? existing[0];
}

export async function requireShipRoot(slug: string): Promise<string> {
  const root = await resolveShipRoot(slug);
  if (!root) throw new ShipError("This workspace has no project folder to ship yet.", 409);
  return root;
}

export async function requireKnownProject(slug: string): Promise<void> {
  if (!(await findProject(slug))) throw new ShipError("That workspace was not found.", 404);
}
