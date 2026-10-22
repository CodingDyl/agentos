import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Where a client's site code lives: its own git repository on the SSD,
 * `/Volumes/DylanSSD/projects/clients/<slug>` unless
 * `AGENTOS_CLIENT_PROJECTS_ROOT` or `AGENTOS_CLIENT_SITES_DIR` says otherwise.
 *
 * Project metadata stays in the AgentOS-Memory vault. The code repo must not
 * live there: nesting it inside the vault made workers worktree the whole vault.
 *
 * If the drive is not plugged in, the stage stops and says so. It never falls
 * back to the laptop's disk: client code in two places is worse than waiting.
 */

const run = promisify(execFile);

export const DEFAULT_CLIENT_PROJECTS_ROOT = "/Volumes/DylanSSD/projects/clients";
/** @deprecated Use DEFAULT_CLIENT_PROJECTS_ROOT. Kept so older imports still resolve. */
export const DEFAULT_CLIENT_SITES_DIR = DEFAULT_CLIENT_PROJECTS_ROOT;

export class ClientRepoUnavailable extends Error {}

export function clientSitesDir(): string {
  return (
    process.env.AGENTOS_CLIENT_PROJECTS_ROOT?.trim() ||
    process.env.AGENTOS_CLIENT_SITES_DIR?.trim() ||
    DEFAULT_CLIENT_PROJECTS_ROOT
  );
}

/** A usable recorded path, or undefined when it is blank / the PROJECT.md placeholder. */
export function usableRepoPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^_?not set_?$/i.test(trimmed)) return undefined;
  return trimmed;
}

/** `/Volumes/DylanSSD/projects/clients/<slug>` (or the configured root). */
export function defaultClientRepoPath(slug: string): string {
  return path.join(clientSitesDir(), repoFolderName(slug));
}

/**
 * Where this client's code lives: a recorded path wins, then the
 * configurable clients root. Never migrates files.
 */
export function resolveClientRepoPath(slug: string, recorded?: string): string {
  return usableRepoPath(recorded) ?? defaultClientRepoPath(slug);
}

/** `/Volumes/DylanSSD/...` → `/Volumes/DylanSSD`: the mount that must be present. */
export function mountPointOf(directory: string): string | undefined {
  const match = /^(\/Volumes\/[^/]+)/.exec(directory);
  return match?.[1];
}

export async function git(repo: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

const AUTHOR = ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost"];

/** A repository folder name: the workspace slug, nothing that could climb out of the clients folder. */
export function repoFolderName(slug: string): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!clean) throw new ClientRepoUnavailable("The workspace has no usable name for a folder.");
  return clean;
}

const GITIGNORE = ["node_modules/", ".next/", "out/", ".vercel/", ".env", ".env.*", "!.env.example", "*.log", "._*", ".DS_Store", "screenshots/", ""].join("\n");

export async function assertClientDrivePresent(directory = clientSitesDir()): Promise<void> {
  const mount = mountPointOf(directory);
  if (!mount) return;
  try {
    await fs.access(mount);
  } catch {
    throw new ClientRepoUnavailable(`Connect ${path.basename(mount)}: client sites are kept on it (${directory}), and it is not plugged in.`);
  }
}

/**
 * The client's repository, created on first use with one commit so worker
 * jobs have something to branch from. Safe to call again: an existing
 * repository is returned as it is. A recorded path is used as-is so a
 * project that still lives at an older location is not recreated.
 */
export async function ensureClientRepo(slug: string, company: string, recorded?: string): Promise<string> {
  const repo = resolveClientRepoPath(slug, recorded);
  await assertClientDrivePresent(repo);

  await fs.mkdir(repo, { recursive: true });

  try {
    await git(repo, ["rev-parse", "--verify", "HEAD"]);
    return repo;
  } catch {
    // Not a repository with a commit yet: make it one.
  }

  try {
    await git(repo, ["init", "-b", "main"]);
  } catch {
    await git(repo, ["init"]);
  }
  await fs.writeFile(path.join(repo, ".gitignore"), GITIGNORE, { flag: "wx" }).catch(() => undefined);
  await fs.writeFile(
    path.join(repo, "README.md"),
    `# ${company}\n\nWebsite rebuild managed by AgentOS. Research and reports live in \`docs/\`; the site is a Next.js app once stage 5 has run.\n`,
    { flag: "wx" },
  ).catch(() => undefined);
  await git(repo, ["add", "-A"]);
  await git(repo, [...AUTHOR, "commit", "--no-verify", "-m", "Start the website rebuild"]);
  return repo;
}

/**
 * Copies reports into the repo (so workers can read them) and commits them. Unchanged files make no commit.
 * `replace` names a folder that is emptied first, so a file dropped since the last commit is removed too.
 */
export async function commitFiles(repo: string, files: Record<string, string | Buffer>, message: string, options: { replace?: string } = {}): Promise<string | undefined> {
  const paths = Object.keys(files);
  if (options.replace) {
    const folder = path.resolve(repo, options.replace);
    if (!folder.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new Error(`Refusing to replace outside the repository: ${options.replace}`);
    await fs.rm(folder, { recursive: true, force: true });
    paths.push(options.replace);
  }
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.resolve(repo, relative);
    if (!target.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new Error(`Refusing to write outside the repository: ${relative}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  await git(repo, ["add", "-A", "--", ...paths]);
  const staged = await git(repo, ["diff", "--cached", "--name-only"]);
  if (!staged) return undefined;
  await git(repo, [...AUTHOR, "commit", "--no-verify", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/** Marks a revision's commit, e.g. `rebuild/hero-r2`, so every revision can be checked out later. */
export async function tagRevision(repo: string, commit: string, tag: string): Promise<void> {
  await git(repo, ["tag", "-f", tag, commit]);
}

export async function readRepoFile(repo: string, relative: string): Promise<string | undefined> {
  const target = path.resolve(repo, relative);
  if (!target.startsWith(`${path.resolve(repo)}${path.sep}`)) return undefined;
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return undefined;
  }
}
