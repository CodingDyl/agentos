import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import matter from "gray-matter";
import {
  SKILL_NAME_PATTERN,
  type MarketplaceCandidate,
  type MarketplaceInstallInput,
  type MarketplacePreview,
  type MarketplaceUpdateResult,
  type SkillSummary,
} from "../../shared/skill-types";
import { authorize } from "../connectors/policy";
import {
  listSkills,
  marketplaceSkillsDir,
  readEnablement,
  readOrigins,
  readSkill,
  SkillError,
  writeEnablement,
  writeOrigins,
  type SkillDeps,
} from "./registry";

/**
 * Skills installed from GitHub repos — Claude-style plugin marketplaces like
 * `cth9191/animate`, or any repo with a SKILL.md.
 *
 * A repo is read in one tarball download, pinned to a commit, and checked
 * with the same rules as every other skill. Only skill folders are copied:
 * a plugin's hooks, commands, agents and MCP servers are listed as left out,
 * and nothing in the repo is ever run — no install scripts, no npm.
 *
 * A marketplace install never replaces a skill AgentOS already has under the
 * same id, bundled or otherwise. Installing again from the same repo is an
 * update; from a different repo, a conflict the person resolves by removing
 * the first one.
 */

const exec = promisify(execFile);

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_TARBALL_BYTES = 60 * 1024 * 1024;
const MAX_SKILL_FILES = 1_000;
const MAX_SKILL_BYTES_TOTAL = 30 * 1024 * 1024;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * `owner/repo`, `github.com/owner/repo`, or any github.com URL into the repo
 * (`/tree/main/...`, `.git`). The plugin id is never typed: it comes from the
 * repo's own manifest.
 */
export function parseRepoRef(input: string): RepoRef {
  const trimmed = input.trim().replace(/^git\+/, "");
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(trimmed);
  const fromShort = /^([^/\s:]+)\/([^/\s]+)$/.exec(trimmed);
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i.exec(trimmed);
  const match = fromUrl ?? ssh ?? (/^https?:\/\//i.test(trimmed) ? null : fromShort);
  if (!match) {
    throw new SkillError("That isn't a GitHub repo. Paste owner/repo, like cth9191/animate, or the repo's github.com URL.", 422);
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") {
    throw new SkillError(`"${owner}/${repo}" isn't a valid GitHub owner/repo.`, 422);
  }
  return { owner, repo };
}

export interface DownloadedRepo {
  /** The extracted repo's root folder. */
  root: string;
  commit: string;
  branch: string;
  private: boolean;
  cleanup: () => Promise<void>;
}

export interface MarketplaceDeps extends SkillDeps {
  /** Downloads `ref` (a branch or commit; the default branch when absent). Replaced in tests. */
  download?: (repo: RepoRef, ref?: string) => Promise<DownloadedRepo>;
}

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AgentOS",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubFetch(url: string, accept?: string, timeout = REQUEST_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { headers: githubHeaders(accept), signal: AbortSignal.timeout(timeout), redirect: "follow" });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new SkillError("GitHub did not answer in time. Try again.", 504);
    throw new SkillError("Could not reach GitHub. Check the connection and try again.", 502);
  }
}

function explainGithubFailure(response: Response, { owner, repo }: RepoRef): SkillError {
  const name = `${owner}/${repo}`;
  if (response.status === 404) {
    return new SkillError(
      process.env.GITHUB_TOKEN?.trim()
        ? `GitHub has no repo called ${name}, or GITHUB_TOKEN can't see it. Check the spelling.`
        : `GitHub has no public repo called ${name}. Check the spelling; for a private repo, add GITHUB_TOKEN in Connectors → GitHub.`,
      404,
    );
  }
  if (response.status === 401) return new SkillError("GitHub rejected GITHUB_TOKEN. Replace it in Connectors → GitHub.", 401);
  if (response.status === 403 || response.status === 429) {
    return new SkillError(
      process.env.GITHUB_TOKEN?.trim()
        ? "GitHub is rate-limiting requests. Wait a few minutes and try again."
        : "GitHub is rate-limiting anonymous requests. Add GITHUB_TOKEN in Connectors → GitHub, or wait an hour.",
      429,
    );
  }
  return new SkillError(`GitHub answered ${response.status} for ${name}.`, 502);
}

/** The real download: repo metadata, the commit, then one tarball, extracted into a temporary folder. */
async function downloadFromGithub(ref: RepoRef, wanted?: string): Promise<DownloadedRepo> {
  const decision = authorize("github.read_repository", { initiator: "person", detail: `${ref.owner}/${ref.repo}` });
  if (!decision.allowed) throw new SkillError(decision.reason, 403);

  const base = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const meta = await githubFetch(base);
  if (!meta.ok) throw explainGithubFailure(meta, ref);
  const repo = (await meta.json()) as { default_branch?: string; private?: boolean };
  const branch = repo.default_branch ?? "main";

  const commitResponse = await githubFetch(`${base}/commits/${encodeURIComponent(wanted ?? branch)}`, "application/vnd.github.sha");
  if (!commitResponse.ok) {
    if (commitResponse.status === 404 || commitResponse.status === 422) throw new SkillError(`${ref.owner}/${ref.repo} has no commit or branch "${wanted ?? branch}".`, 404);
    throw explainGithubFailure(commitResponse, ref);
  }
  const commit = (await commitResponse.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new SkillError("GitHub returned an unexpected commit id.", 502);

  const work = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-marketplace-"));
  const cleanup = () => fs.rm(work, { recursive: true, force: true });
  try {
    const tarball = await githubFetch(`${base}/tarball/${commit}`, "application/vnd.github+json", DOWNLOAD_TIMEOUT_MS);
    if (!tarball.ok || !tarball.body) throw explainGithubFailure(tarball, ref);
    const declared = Number(tarball.headers.get("content-length") ?? 0);
    if (declared > MAX_TARBALL_BYTES) throw new SkillError("That repo is larger than 60 MB. Skills that big aren't installed from here.", 413);

    const archive = path.join(work, "repo.tar.gz");
    let received = 0;
    const limited = Readable.fromWeb(tarball.body as import("node:stream/web").ReadableStream<Uint8Array>);
    limited.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_TARBALL_BYTES) limited.destroy(new SkillError("That repo is larger than 60 MB. Skills that big aren't installed from here.", 413));
    });
    await pipeline(limited, createWriteStream(archive));

    const extracted = path.join(work, "repo");
    await fs.mkdir(extracted);
    // bsdtar and GNU tar both refuse absolute paths and `..` unless told otherwise; nothing here tells them.
    await exec("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner"], { timeout: 60_000 });
    await fs.rm(archive);

    // GitHub wraps the repo in one `owner-repo-sha/` folder.
    const [top] = (await fs.readdir(extracted, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    if (!top) throw new SkillError("The repo download was empty.", 502);
    return { root: path.join(extracted, top.name), commit, branch, private: Boolean(repo.private), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

interface Found {
  id: string;
  dir: string;
  /** Relative to the repo root, with forward slashes. */
  repoPath: string;
  plugin?: { name: string; version?: string };
}

interface Discovery {
  marketplace?: string;
  found: Found[];
  notInstalled: string[];
  problems: string[];
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function isFile(target: string): Promise<boolean> {
  return fs.lstat(target).then(
    (stat) => stat.isFile(),
    () => false,
  );
}

async function isDir(target: string): Promise<boolean> {
  return fs.lstat(target).then(
    (stat) => stat.isDirectory(),
    () => false,
  );
}

/** Keeps a manifest's `source` inside the repo. */
function insideRoot(root: string, relative: string): string | undefined {
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : undefined;
}

const toRepoPath = (root: string, dir: string) => path.relative(root, dir).split(path.sep).join("/") || ".";

/** A plugin folder's skills, and the parts of it that are not skills. */
async function readPlugin(root: string, dir: string, fallbackName: string, discovery: Discovery): Promise<void> {
  const manifest = await readJson(path.join(dir, ".claude-plugin", "plugin.json"));
  const name = typeof manifest?.name === "string" ? manifest.name : fallbackName;
  const version = typeof manifest?.version === "string" ? manifest.version : undefined;

  const skillsDir = path.join(dir, "skills");
  if (await isDir(skillsDir)) {
    for (const entry of (await fs.readdir(skillsDir, { withFileTypes: true })).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const folder = path.join(skillsDir, entry.name);
      if (await isFile(path.join(folder, "SKILL.md"))) discovery.found.push({ id: entry.name, dir: folder, repoPath: toRepoPath(root, folder), plugin: { name, version } });
    }
  } else if (await isFile(path.join(dir, "SKILL.md"))) {
    discovery.found.push({ id: path.basename(dir) === path.basename(root) ? name : path.basename(dir), dir, repoPath: toRepoPath(root, dir), plugin: { name, version } });
  }

  // Everything else a Claude plugin can carry. AgentOS installs instructions, not code that runs.
  const extras: [string, string][] = [
    ["commands", "slash commands"],
    ["agents", "subagents"],
    ["hooks", "hooks"],
    [".mcp.json", "MCP servers"],
  ];
  for (const [entry, label] of extras) {
    if ((await isDir(path.join(dir, entry))) || (await isFile(path.join(dir, entry)))) discovery.notInstalled.push(`${name}: ${label}`);
  }
  if (manifest?.hooks) discovery.notInstalled.push(`${name}: hooks`);
  if (manifest?.mcpServers) discovery.notInstalled.push(`${name}: MCP servers`);
}

/**
 * Finds the skills in an extracted repo, in this order:
 * a Claude plugin marketplace (`.claude-plugin/marketplace.json`), a single
 * plugin (`.claude-plugin/plugin.json`), a top-level `skills/` folder, or a
 * repo that is itself one skill (`SKILL.md` at the root).
 */
export async function discoverSkills(root: string, repoName: string): Promise<Discovery> {
  const discovery: Discovery = { found: [], notInstalled: [], problems: [] };
  const marketplace = await readJson(path.join(root, ".claude-plugin", "marketplace.json"));

  if (marketplace) {
    discovery.marketplace = typeof marketplace.name === "string" ? marketplace.name : repoName;
    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    for (const plugin of plugins as Record<string, unknown>[]) {
      const name = typeof plugin?.name === "string" ? plugin.name : "unnamed plugin";
      const source = plugin?.source;
      if (typeof source !== "string") {
        // `{ source: "github", repo }` and friends point at other repos. Install those by their own owner/repo.
        const elsewhere = source && typeof source === "object" && "repo" in source && typeof source.repo === "string" ? ` Install it from ${source.repo} directly.` : "";
        discovery.problems.push(`The ${name} plugin lives outside this repo.${elsewhere}`);
        continue;
      }
      const dir = insideRoot(root, source);
      if (!dir || !(await isDir(dir))) {
        discovery.problems.push(`The ${name} plugin points at ${source}, which isn't a folder in this repo.`);
        continue;
      }
      await readPlugin(root, dir, name, discovery);
    }
  } else if (await isFile(path.join(root, ".claude-plugin", "plugin.json"))) {
    await readPlugin(root, root, repoName, discovery);
  } else if (await isDir(path.join(root, "skills"))) {
    for (const entry of (await fs.readdir(path.join(root, "skills"), { withFileTypes: true })).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const folder = path.join(root, "skills", entry.name);
      if (await isFile(path.join(folder, "SKILL.md"))) discovery.found.push({ id: entry.name, dir: folder, repoPath: toRepoPath(root, folder) });
    }
  } else if (await isFile(path.join(root, "SKILL.md"))) {
    // A repo that is one skill: its id comes from the front matter, since the folder is the repo.
    let id = repoName.toLowerCase();
    try {
      const data = matter(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).data as Record<string, unknown>;
      if (typeof data.name === "string" && data.name.trim()) id = data.name.trim();
    } catch {
      // readSkill reports the bad front matter.
    }
    discovery.found.push({ id, dir: root, repoPath: "." });
  }

  for (const script of ["package.json", "install.sh", "setup.sh", "Makefile"]) {
    if (await isFile(path.join(root, script))) discovery.notInstalled.push(`${script} (never run)`);
  }
  if (discovery.found.length === 0 && discovery.problems.length === 0) {
    discovery.problems.push("No skills found. A skill repo needs a SKILL.md, a skills/ folder, or a .claude-plugin manifest.");
  }
  return discovery;
}

/** File count and size, refusing links: a skill folder must be plain files. */
async function measure(dir: string, skipRoot: Set<string>): Promise<{ files: number; bytes: number; errors: string[] }> {
  let files = 0;
  let bytes = 0;
  const errors: string[] = [];
  const walk = async (current: string) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (current === dir && skipRoot.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        errors.push(`Contains a symbolic link (${path.relative(dir, full)}), which isn't installed.`);
        continue;
      }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await fs.stat(full)).size;
      }
    }
  };
  await walk(dir);
  if (files > MAX_SKILL_FILES) errors.push(`Has ${files} files; the most a skill may have is ${MAX_SKILL_FILES}.`);
  if (bytes > MAX_SKILL_BYTES_TOTAL) errors.push(`Is ${Math.round(bytes / 1024 / 1024)} MB; the most a skill may be is 30 MB.`);
  return { files, bytes, errors: [...new Set(errors)].slice(0, 5) };
}

/** What a repo-root skill leaves behind: the repo's own furniture, not the skill. */
const ROOT_SKILL_SKIP = new Set([".git", ".github", ".claude-plugin", "node_modules"]);

async function inspect(found: Found, existing: SkillSummary[], repoName: string): Promise<MarketplaceCandidate> {
  const skill = await readSkill(found.dir);
  const errors: string[] = [];
  if (!SKILL_NAME_PATTERN.test(found.id)) errors.push(`"${found.id}" isn't a usable skill id: lowercase letters, digits and hyphens.`);
  // At the repo root the folder is named after the repo, so the folder-name rule is checked against the id instead.
  for (const error of skill?.errors ?? ["SKILL.md could not be read."]) {
    if (found.repoPath === "." && error.includes("must match the folder name")) continue;
    errors.push(error);
  }
  const size = await measure(found.dir, found.repoPath === "." ? ROOT_SKILL_SKIP : new Set());
  errors.push(...size.errors);

  const current = existing.find((entry) => entry.id === found.id);
  const sameRepo = current?.source === "marketplace" && current.origin?.repo.toLowerCase() === repoName.toLowerCase();
  const conflict = !current || sameRepo
    ? undefined
    : current.source === "marketplace"
      ? `Already installed from ${current.origin?.repo ?? "another repo"}. Remove that one first to install this.`
      : `AgentOS already has a ${current.source} skill called ${found.id}. Marketplace installs never replace it.`;

  const version = skill && skill.version !== "0.0.0" ? skill.version : found.plugin?.version && /^\d+\.\d+\.\d+$/.test(found.plugin.version) ? found.plugin.version : "0.0.0";
  return {
    id: found.id,
    name: skill?.name ?? found.id,
    description: skill?.description ?? "",
    version,
    ...(found.plugin ? { plugin: found.plugin.name } : {}),
    path: found.repoPath,
    files: size.files,
    bytes: size.bytes,
    errors,
    installed: Boolean(sameRepo),
    ...(conflict ? { conflict } : {}),
  };
}

/** Reads a repo for review. Installs nothing; the person confirms first. */
export async function previewMarketplaceRepo(input: string, deps: MarketplaceDeps): Promise<MarketplacePreview> {
  const ref = parseRepoRef(input);
  const repo = await (deps.download ?? downloadFromGithub)(ref);
  try {
    const name = `${ref.owner}/${ref.repo}`;
    const discovery = await discoverSkills(repo.root, ref.repo);
    if (discovery.found.length === 0) throw new SkillError(`${name}: ${discovery.problems.join(" ")}`, 422);
    const existing = await listSkills(deps);
    const skills = await Promise.all(discovery.found.map((found) => inspect(found, existing, name)));
    return {
      repo: name,
      url: `https://github.com/${name}`,
      branch: repo.branch,
      commit: repo.commit,
      private: repo.private,
      ...(discovery.marketplace ? { marketplace: discovery.marketplace } : {}),
      skills,
      notInstalled: [...new Set([...discovery.notInstalled, ...discovery.problems])],
    };
  } finally {
    await repo.cleanup();
  }
}

/**
 * Copies one checked skill into place. The new copy is staged beside the old
 * one and swapped in by rename, so a failed update leaves the old one working.
 */
async function placeSkill(found: Found): Promise<void> {
  const root = marketplaceSkillsDir();
  await fs.mkdir(root, { recursive: true });
  const staging = path.join(root, `.staging-${randomUUID()}`);
  const staged = path.join(staging, found.id);
  const target = path.join(root, found.id);
  try {
    await fs.cp(found.dir, staged, {
      recursive: true,
      // Links were refused at inspection; the filter makes sure none slip in. A repo-root skill leaves the repo's furniture behind.
      filter: async (source) => {
        if ((await fs.lstat(source)).isSymbolicLink()) return false;
        return !(found.repoPath === "." && path.dirname(source) === found.dir && ROOT_SKILL_SKIP.has(path.basename(source)));
      },
    });
    const exists = await isDir(target);
    if (exists) await fs.rename(target, path.join(staging, ".previous"));
    await fs.rename(staged, target);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function installFromDownload(
  ref: RepoRef,
  repo: DownloadedRepo,
  ids: readonly string[],
  deps: MarketplaceDeps,
  options: { update: boolean },
): Promise<SkillSummary[]> {
  const name = `${ref.owner}/${ref.repo}`;
  const discovery = await discoverSkills(repo.root, ref.repo);
  const existing = await listSkills(deps);
  const origins = await readOrigins();
  const enabled = await readEnablement();
  const installedAt = new Date().toISOString();

  // Check every pick before copying any, so a bad pick installs nothing.
  const picked: { found: Found; candidate: MarketplaceCandidate }[] = [];
  for (const id of ids) {
    const found = discovery.found.find((entry) => entry.id === id);
    if (!found) throw new SkillError(`${name} has no skill called ${id} at this commit.`, 404);
    const candidate = await inspect(found, existing, name);
    if (candidate.conflict) throw new SkillError(candidate.conflict, 409);
    if (candidate.errors.length > 0) throw new SkillError(`${id} can't be installed: ${candidate.errors.join(" ")}`, 422);
    const current = existing.find((entry) => entry.id === id);
    if (current && current.activeRuns > 0) throw new SkillError(`A run is using ${id}. Finish or cancel it before updating.`, 409);
    picked.push({ found, candidate });
  }

  for (const { found, candidate } of picked) {
    await placeSkill(found);
    origins[found.id] = {
      repo: name,
      branch: repo.branch,
      commit: repo.commit,
      path: found.repoPath,
      ...(found.plugin ? { plugin: found.plugin.name } : {}),
      installedAt,
      version: candidate.version,
    };
    // A new install was just chosen by a person after the trust warning: on. An update keeps the choice made before.
    if (!options.update && !candidate.installed) enabled[found.id] = true;
  }
  await writeOrigins(origins);
  await writeEnablement(enabled);

  const after = await listSkills(deps);
  return picked.map(({ found }) => {
    const saved = after.find((entry) => entry.id === found.id);
    if (!saved) throw new SkillError(`${found.id} was installed but could not be read back.`, 500);
    return saved;
  });
}

/** Installs the picked skills from exactly the commit the person reviewed. */
export async function installMarketplaceSkills(input: MarketplaceInstallInput, deps: MarketplaceDeps): Promise<SkillSummary[]> {
  const ref = parseRepoRef(input.repo);
  const repo = await (deps.download ?? downloadFromGithub)(ref, input.commit);
  try {
    if (repo.commit !== input.commit) throw new SkillError("The repo changed since it was reviewed. Review it again.", 409);
    return await installFromDownload(ref, repo, input.skills, deps, { update: false });
  } finally {
    await repo.cleanup();
  }
}

/** Re-reads the branch a skill was installed from and, when it has moved, replaces the skill with the new commit's copy. */
export async function updateMarketplaceSkill(id: string, deps: MarketplaceDeps): Promise<MarketplaceUpdateResult> {
  const current = (await listSkills(deps)).find((entry) => entry.id === id);
  if (!current) throw new SkillError("No such skill.", 404);
  if (current.source !== "marketplace" || !current.origin) throw new SkillError("Only skills installed from a repo can be updated from one.", 403);

  const ref = parseRepoRef(current.origin.repo);
  const repo = await (deps.download ?? downloadFromGithub)(ref, current.origin.branch);
  try {
    if (repo.commit === current.origin.commit) {
      return { skill: current, updated: false, previousVersion: current.version, previousCommit: current.origin.commit };
    }
    const [skill] = await installFromDownload(ref, repo, [id], deps, { update: true });
    return { skill, updated: true, previousVersion: current.version, previousCommit: current.origin.commit };
  } finally {
    await repo.cleanup();
  }
}
