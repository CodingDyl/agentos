/**
 * Where a workspace's clone URL actually lives.
 *
 * AgentOS workspaces do not store `configuration.repositoryUrl`. The Coder
 * Part 2 wizard read that field, so a real workspace with no `localPath`
 * never opened it. What does exist:
 *
 * - website-rebuild / client-site `githubRepo`: `owner/name`
 * - settings / `git.repositoryPath`: a *local* checkout, not a clone URL
 * - `configuration.localPath`: the Coder IDE path, also local
 *
 * This helper prefers a real git URL when one is present, then `owner/name`,
 * and never treats a filesystem path as something to `git clone`.
 */

const SHELL_META = /[;&|`$()]/;
const HTTPS_GIT = /^https:\/\/[^\s]+/i;
const SSH_GIT = /^(?:git@|ssh:\/\/)[^\s]+/i;
const OWNER_NAME = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

export type WorkspaceRepoUrlSource = {
  configuration?: {
    repositoryUrl?: string;
    githubRepo?: string;
    localPath?: string;
  } | null;
  git?: {
    repositoryPath?: string;
    remoteUrl?: string;
  } | null;
  githubRepo?: string;
  repositoryUrl?: string;
  repository?: {
    url?: string;
    githubRepo?: string;
  } | null;
};

export function isGitCloneUrl(value: string | undefined | null): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || SHELL_META.test(trimmed)) return false;
  if (HTTPS_GIT.test(trimmed)) return true;
  if (SSH_GIT.test(trimmed)) return true;
  return false;
}

export function isFilesystemPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("~")) return true;
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  return false;
}

/** `owner/name` as stored on rebuilds and client sites → a GitHub clone URL. */
export function toGitCloneUrl(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (isFilesystemPath(trimmed) && !isGitCloneUrl(trimmed)) return undefined;
  if (isGitCloneUrl(trimmed)) return trimmed;

  const ownerRepo = OWNER_NAME.exec(trimmed);
  if (ownerRepo) {
    return `https://github.com/${ownerRepo[1]}/${ownerRepo[2]}.git`;
  }

  return undefined;
}

function firstCloneUrl(candidates: Array<string | undefined | null>): string | undefined {
  for (const candidate of candidates) {
    const url = toGitCloneUrl(candidate);
    if (url) return url;
  }
  return undefined;
}

export function resolveWorkspaceRepoUrl(source: WorkspaceRepoUrlSource): string | undefined {
  // URL-shaped fields only: never run owner/name conversion on a local path,
  // including git.repositoryPath (`src/app` would otherwise look like a repo).
  for (const candidate of [
    source.configuration?.repositoryUrl,
    source.repositoryUrl,
    source.repository?.url,
    source.git?.remoteUrl,
    source.git?.repositoryPath,
  ]) {
    if (isGitCloneUrl(candidate)) return candidate!.trim();
  }

  return firstCloneUrl([
    source.githubRepo,
    source.configuration?.githubRepo,
    source.repository?.githubRepo,
  ]);
}
