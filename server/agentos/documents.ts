import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  ArtifactSourceSchema,
  ArtifactTypeSchema,
  type ArtifactSource,
  type ArtifactType,
  type DocumentContent,
  type ProjectArtifact,
  type ProjectDocuments,
} from "../../shared/agentos-types";
import { agentOSRoot, readOptionalFile } from "./filesystem";
import { revisionOfOptional } from "./mutations/revision";
import { repositoryProblem } from "./git";
import { parseRepositoryPath } from "./projects";

/**
 * Project documents: the vault's, and the repository's.
 *
 * Two kinds of thing, one list, kept honest about which is which.
 *
 * **Vault documents** live under `projects/<slug>/docs/` (written by a
 * person) and `projects/<slug>/artifacts/<TASK>/` (produced by an agent). Each
 * identifies itself with front matter — `title`, `type`, `source`, `task`,
 * `job`, `run`, `created` — so the file is the record. There is no registry
 * to drift from it; listing is a scan of a few dozen files, and a file moved
 * or edited by hand is simply read as it now is.
 *
 * **Repository documents** — `README.md`, `docs/**` — are listed from the
 * project's checkout and read in place. Copying them into the vault would
 * make a second copy that goes stale the moment a worker edits the first.
 *
 * The canonical five (`PROJECT/STATUS/TASKS/DECISIONS/MILESTONES.md`) are
 * deliberately not documents. They control AgentOS; these describe the work.
 */

const PROJECTS_DIR = "projects";
const DOCS_DIR = "docs";
const ARTIFACTS_DIR = "artifacts";

/** Repository docs: how deep and how many before the list stops being useful. */
const REPO_DOC_DEPTH = 3;
const REPO_DOC_LIMIT = 60;
const REPO_DOC_ROOTS = ["docs", "doc", "documentation"];
const REPO_ROOT_FILES = ["README.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "CHANGELOG.md"];

/** Directories no documentation lives in, however deep. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor"]);

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** chars ÷ 4: the rough, provider-agnostic figure. */
export function estimateTokens(text: string | number): number {
  const chars = typeof text === "number" ? text : text.length;
  return Math.ceil(chars / 4);
}

const TASK_REF = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;

function readType(value: unknown, fallback: ArtifactType): ArtifactType {
  const parsed = ArtifactTypeSchema.safeParse(typeof value === "string" ? value.trim().toLowerCase() : value);
  return parsed.success ? parsed.data : fallback;
}

function readSource(value: unknown, fallback: ArtifactSource): ArtifactSource {
  const parsed = ArtifactSourceSchema.safeParse(typeof value === "string" ? value.trim().toLowerCase() : value);
  return parsed.success ? parsed.data : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return readString(value);
}

/** `chef-ux-analysis.md` → `Chef ux analysis`, when a file names no title. */
function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : filename;
}

/** The first `# Heading` in a body, when there is one. */
function titleFromBody(body: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim();
}

/** Turns one vault Markdown file into an artifact record. Exported for tests. */
export function describeVaultDocument(input: {
  slug: string;
  /** Vault-relative, e.g. `projects/pantry-pilot/artifacts/PP-024/plan.md`. */
  relativePath: string;
  raw: string;
  stat?: { size: number; mtime: Date; birthtime: Date };
}): ProjectArtifact {
  const parsed = safeMatter(input.raw);
  const data = parsed.data;
  const filename = path.posix.basename(input.relativePath);
  const withinProject = input.relativePath.split("/").slice(2).join("/"); // docs/… or artifacts/…
  const isArtifact = withinProject.startsWith(`${ARTIFACTS_DIR}/`);

  // An artifact's folder names its task, unless the front matter says otherwise.
  const folder = isArtifact ? withinProject.split("/")[1] : undefined;
  const taskFromFolder = folder && TASK_REF.test(folder.toUpperCase()) ? folder.toUpperCase() : undefined;

  return {
    id: withinProject.replace(/\.(md|markdown)$/i, ""),
    project: input.slug,
    origin: "agentos",
    taskId: readString(data.task)?.toUpperCase() ?? taskFromFolder,
    jobId: readString(data.job),
    runId: readString(data.run),
    title: readString(data.title) ?? titleFromBody(parsed.content) ?? titleFromFilename(filename),
    filename,
    relativePath: input.relativePath,
    type: readType(data.type, isArtifact ? "other" : "notes"),
    source: readSource(data.source, "human"),
    createdAt: readDate(data.created) ?? input.stat?.birthtime.toISOString(),
    updatedAt: readDate(data.updated) ?? input.stat?.mtime.toISOString(),
    sizeBytes: input.stat?.size ?? Buffer.byteLength(input.raw, "utf8"),
    tokenEstimate: estimateTokens(parsed.content),
    detected: data.detected === true ? true : undefined,
  };
}

/**
 * `gray-matter` throws on malformed YAML; a document with a broken header is
 * still a document, read as one with no front matter at all.
 */
export function safeMatter(raw: string): { data: Record<string, unknown>; content: string } {
  try {
    const parsed = matter(raw);
    // The body starts at its first line of text, not at the blank line that
    // separated it from the header.
    return { data: (parsed.data ?? {}) as Record<string, unknown>, content: parsed.content.replace(/^\s*\n/, "") };
  } catch {
    return { data: {}, content: raw };
  }
}

async function walk(
  root: string,
  relative: string,
  depth: number,
  out: string[],
  limit: number,
): Promise<void> {
  if (depth < 0 || out.length >= limit) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name.startsWith(".")) continue;

    const next = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, next, depth - 1, out, limit);
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      out.push(next);
    }
  }
}

/** Every vault document for a project, artifacts first (newest first), then docs. */
export async function listVaultDocuments(slug: string): Promise<ProjectArtifact[]> {
  const projectDir = path.join(agentOSRoot(), PROJECTS_DIR, slug);
  const found: string[] = [];

  await walk(projectDir, ARTIFACTS_DIR, 3, found, 500);
  await walk(projectDir, DOCS_DIR, 3, found, 500);

  const documents = await Promise.all(
    found.map(async (within) => {
      const absolute = path.join(projectDir, within);
      try {
        const [raw, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
        return describeVaultDocument({
          slug,
          relativePath: `${PROJECTS_DIR}/${slug}/${within}`,
          raw,
          stat: { size: stat.size, mtime: stat.mtime, birthtime: stat.birthtime },
        });
      } catch {
        return undefined;
      }
    }),
  );

  return documents
    .filter((document): document is ProjectArtifact => document !== undefined)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** The repository's own documentation, listed from disk. Never copied. */
export async function listRepoDocuments(
  slug: string,
  repoPath: string,
): Promise<ProjectArtifact[]> {
  const found: string[] = [];

  for (const file of REPO_ROOT_FILES) {
    try {
      await fs.access(path.join(repoPath, file));
      found.push(file);
    } catch {
      // Not every repository has every file.
    }
  }

  for (const root of REPO_DOC_ROOTS) {
    await walk(repoPath, root, REPO_DOC_DEPTH, found, REPO_DOC_LIMIT);
  }

  const documents = await Promise.all(
    [...new Set(found)].map(async (relative): Promise<ProjectArtifact | undefined> => {
      try {
        const absolute = path.join(repoPath, relative);
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_DOCUMENT_BYTES) return undefined;

        // Only the head is read for a title; the rest is read on open.
        const handle = await fs.open(absolute, "r");
        const buffer = Buffer.alloc(Math.min(stat.size, 4096));
        await handle.read(buffer, 0, buffer.length, 0);
        await handle.close();
        const head = buffer.toString("utf8");
        const parsed = safeMatter(head);

        return {
          id: `repo:${relative.replace(/\.(md|markdown)$/i, "")}`,
          project: slug,
          origin: "repo",
          title: readString(parsed.data.title) ?? titleFromBody(parsed.content) ?? titleFromFilename(path.posix.basename(relative)),
          filename: path.posix.basename(relative),
          relativePath: relative,
          type: relative === "README.md" ? "notes" : readType(parsed.data.type, "spec"),
          source: "human",
          updatedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
          tokenEstimate: estimateTokens(stat.size),
        };
      } catch {
        return undefined;
      }
    }),
  );

  return documents.filter((document): document is ProjectArtifact => document !== undefined);
}

const CANONICAL = ["PROJECT.md", "STATUS.md", "TASKS.md", "DECISIONS.md", "MILESTONES.md"];

/** The control files as pickable context, priced. They are never listed as documents. */
async function listCanonical(slug: string): Promise<ProjectArtifact[]> {
  const entries = await Promise.all(
    CANONICAL.map(async (file): Promise<ProjectArtifact | undefined> => {
      const relativePath = `${PROJECTS_DIR}/${slug}/${file}`;
      const raw = await readOptionalFile(relativePath);
      if (raw === undefined) return undefined;

      return {
        id: `canonical:${file}`,
        project: slug,
        origin: "agentos",
        title: file,
        filename: file,
        relativePath,
        type: "notes",
        source: "human",
        sizeBytes: Buffer.byteLength(raw, "utf8"),
        tokenEstimate: estimateTokens(raw),
      };
    }),
  );

  return entries.filter((entry): entry is ProjectArtifact => entry !== undefined);
}

/** Both origins, for the Documents tab. */
export async function getProjectDocuments(slug: string): Promise<ProjectDocuments> {
  const projectMarkdown = await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`);
  const repoPath = projectMarkdown ? parseRepositoryPath(projectMarkdown) : undefined;

  const [canonical, agentos] = await Promise.all([listCanonical(slug), listVaultDocuments(slug)]);

  if (!repoPath) {
    return { project: slug, canonical, agentos, repo: [], repoUnavailable: "No local repository is linked." };
  }

  try {
    await fs.access(repoPath);
  } catch {
    return { project: slug, canonical, agentos, repo: [], repoUnavailable: await repositoryProblem(repoPath) };
  }

  return { project: slug, canonical, agentos, repo: await listRepoDocuments(slug, repoPath) };
}

/**
 * Whether a relative path stays inside its root once resolved. The one check
 * that lets a route accept a path from a request at all.
 */
export function isInside(root: string, relative: string): boolean {
  const resolved = path.resolve(root, relative);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

/**
 * One document's body, with its record and a revision.
 *
 * `origin=agentos` paths are vault-relative and must sit under this project's
 * `docs/` or `artifacts/`; `origin=repo` paths are repo-relative and must sit
 * under the linked repository. Anything else is refused before a read.
 */
export async function readProjectDocument(
  slug: string,
  relativePath: string,
  origin: "agentos" | "repo",
): Promise<DocumentContent | undefined> {
  if (!/\.(md|markdown)$/i.test(relativePath)) return undefined;

  if (origin === "agentos") {
    const projectPrefix = `${PROJECTS_DIR}/${slug}/`;
    const within = relativePath.startsWith(projectPrefix) ? relativePath.slice(projectPrefix.length) : relativePath;

    if (!(within.startsWith(`${DOCS_DIR}/`) || within.startsWith(`${ARTIFACTS_DIR}/`))) return undefined;

    const projectDir = path.join(agentOSRoot(), PROJECTS_DIR, slug);
    if (!isInside(projectDir, within)) return undefined;

    const absolute = path.join(projectDir, within);

    try {
      const [raw, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
      const artifact = describeVaultDocument({
        slug,
        relativePath: `${projectPrefix}${within}`,
        raw,
        stat: { size: stat.size, mtime: stat.mtime, birthtime: stat.birthtime },
      });

      return { artifact, content: safeMatter(raw).content, revision: revisionOfOptional(raw) };
    } catch {
      return undefined;
    }
  }

  const projectMarkdown = await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`);
  const repoPath = projectMarkdown ? parseRepositoryPath(projectMarkdown) : undefined;
  if (!repoPath || !isInside(repoPath, relativePath)) return undefined;

  try {
    const absolute = path.join(repoPath, relativePath);
    const [raw, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
    if (stat.size > MAX_DOCUMENT_BYTES) return undefined;

    const parsed = safeMatter(raw);
    const artifact: ProjectArtifact = {
      id: `repo:${relativePath.replace(/\.(md|markdown)$/i, "")}`,
      project: slug,
      origin: "repo",
      title: readString(parsed.data.title) ?? titleFromBody(parsed.content) ?? titleFromFilename(path.posix.basename(relativePath)),
      filename: path.posix.basename(relativePath),
      relativePath,
      type: relativePath === "README.md" ? "notes" : readType(parsed.data.type, "spec"),
      source: "human",
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      tokenEstimate: estimateTokens(parsed.content),
    };

    return { artifact, content: parsed.content, revision: revisionOfOptional(raw) };
  } catch {
    return undefined;
  }
}

/** The newest vault documents across every project, for Mission Control. */
export async function listRecentDocuments(
  projects: readonly { slug: string; name: string }[],
  limit = 6,
): Promise<(ProjectArtifact & { projectName?: string })[]> {
  const all = await Promise.all(
    projects.map(async (project) =>
      (await listVaultDocuments(project.slug).catch(() => [])).map((document) => ({
        ...document,
        projectName: project.name,
      })),
    ),
  );

  return all
    .flat()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, limit);
}
