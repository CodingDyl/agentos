import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  ArtifactSource,
  ArtifactType,
  CreateDocumentRequest,
  ProjectArtifact,
} from "../../../shared/agentos-types";
import { ArtifactTypeSchema } from "../../../shared/agentos-types";
import type { WorkerArtifact, WorkerJob } from "../../../shared/worker-types";
import { describeVaultDocument, isInside, safeMatter } from "../documents";
import { agentOSRoot, assertVaultRootPresent } from "../filesystem";
import { assertSlug, InvalidRequestError } from "./tasks";
import { editFile, projectFile, type EditResult } from "./writer";

/**
 * Writing documents into the vault.
 *
 * Two entrances, one rule: the file carries its own record. A document a
 * person creates from the Documents tab lands in `docs/`; one an agent
 * produced lands in `artifacts/<task or job>/`. Both get front matter naming
 * their title, type, source and provenance, so listing them later is a read of
 * the file and nothing else.
 *
 * Worker artifacts are the sensitive path. A worker *claims* it wrote a
 * document at a path; that claim is checked — the path resolves inside the
 * worktree, the file exists, it is Markdown, it is not absurdly large — before
 * a byte is copied. A model's path is input, never an instruction.
 */

const PROJECTS_DIR = "projects";
const DOCS_DIR = "docs";
const ARTIFACTS_DIR = "artifacts";
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const TASK_REF = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;

/** `Chef UX Analysis` → `chef-ux-analysis`. */
export function toFilename(title: string): string {
  const slug = title
    .trim()
    .replace(/\.(md|markdown)$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);

  return `${slug || "document"}.md`;
}

function today(): string {
  return new Date().toISOString();
}

/** Front matter, written the same way every time so diffs stay readable. */
export function withFrontMatter(
  body: string,
  meta: {
    title: string;
    type: ArtifactType;
    source: ArtifactSource;
    task?: string;
    job?: string;
    run?: string;
    created: string;
    detected?: boolean;
  },
): string {
  // An agent's own front matter is replaced, not stacked: one header per file.
  const content = safeMatter(body).content.replace(/^\s+/, "");

  const data: Record<string, unknown> = {
    title: meta.title,
    type: meta.type,
    source: meta.source,
    created: meta.created,
  };
  if (meta.task) data.task = meta.task;
  if (meta.job) data.job = meta.job;
  if (meta.run) data.run = meta.run;
  if (meta.detected) data.detected = true;

  // A blank line between the header and the body, so the file reads like the
  // rest of the vault rather than like a config file.
  const header = matter.stringify("", data).trimEnd();
  return `${header}\n\n${content.trimEnd()}\n`;
}

export interface DocumentWriteResult extends EditResult {
  artifact: ProjectArtifact;
}

/**
 * A document written from the console, or saved from a Hermes proposal.
 *
 * With a task it becomes that task's artifact; without one it is a project
 * document in `docs/`. Refuses to overwrite: a second document with the same
 * title gets a numbered filename rather than replacing the first.
 */
export async function createDocument(
  slug: string,
  input: CreateDocumentRequest,
): Promise<DocumentWriteResult> {
  const validSlug = assertSlug(slug);
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) throw new InvalidRequestError("A document needs a title.");

  const taskId = input.taskId?.trim().toUpperCase();
  if (taskId && !TASK_REF.test(taskId)) throw new InvalidRequestError(`Invalid task id: ${input.taskId}`);

  const folder = taskId ? `${ARTIFACTS_DIR}/${taskId}` : DOCS_DIR;
  const filename = await uniqueFilename(validSlug, folder, toFilename(input.filename ?? title));
  const within = `${folder}/${filename}`;
  const relativePath = projectFile(validSlug, within);
  const created = today();

  const contents = withFrontMatter(input.content, {
    title,
    type: input.type,
    source: input.source ?? "human",
    task: taskId,
    run: input.runId,
    created,
  });

  await assertVaultRootPresent();
  await fs.mkdir(path.join(agentOSRoot(), PROJECTS_DIR, validSlug, folder), { recursive: true });

  const result = await editFile({
    relativePath,
    label: "document.create",
    apply: () => contents,
  });

  return {
    ...result,
    artifact: describeVaultDocument({
      slug: validSlug,
      relativePath,
      raw: contents,
      stat: { size: Buffer.byteLength(contents, "utf8"), mtime: new Date(created), birthtime: new Date(created) },
    }),
  };
}

async function uniqueFilename(slug: string, folder: string, wanted: string): Promise<string> {
  const dir = path.join(agentOSRoot(), PROJECTS_DIR, slug, folder);
  const base = wanted.replace(/\.md$/i, "");

  for (let counter = 0; counter < 100; counter += 1) {
    const candidate = counter === 0 ? `${base}.md` : `${base}-${counter + 1}.md`;
    try {
      await fs.access(path.join(dir, candidate));
    } catch {
      return candidate;
    }
  }

  throw new InvalidRequestError("Could not find a free filename for that document.");
}

/**
 * The declaration lines a worker ends its summary with:
 *
 * ```text
 * Artifact: artifacts/implementation-plan.md — Implementation Plan (plan)
 * ```
 *
 * Plain text rather than JSON because the summary is prose a person reads
 * first, and a JSON block in the middle of it would be read by nobody.
 */
const DECLARATION = /^\s*artifact:\s*(\S+?\.(?:md|markdown))\s*(?:[—–-]+\s*(.*?))?\s*$/gim;

export function parseArtifactDeclarations(summary: string): WorkerArtifact[] {
  const declared: WorkerArtifact[] = [];

  for (const match of summary.matchAll(DECLARATION)) {
    const declaredPath = match[1].trim();
    const rest = (match[2] ?? "").trim();
    const typed = /^(.*?)\s*\(([a-z]+)\)\s*$/i.exec(rest);

    declared.push({
      path: declaredPath,
      title: (typed ? typed[1] : rest).trim() || path.posix.basename(declaredPath).replace(/\.(md|markdown)$/i, ""),
      type: typed ? typed[2].toLowerCase() : undefined,
    });
  }

  return declared;
}

/**
 * Registers what a worker produced.
 *
 * Declared artifacts are copied into the vault under the task (or, for a job
 * with no task, the job id) with front matter naming who made it and which run.
 * New top-level Markdown files the worker did not declare are registered too,
 * marked `detected`: a `TECH_DEBT_REPORT.md` dropped in the repo root is
 * exactly the kind of output that used to vanish into a worktree.
 *
 * Every path is validated against the worktree before it is read. Files that
 * fail a check are skipped and reported, not thrown — one bad path must not
 * lose the other three.
 */
export async function registerJobArtifacts(input: {
  job: WorkerJob;
  worktreePath: string;
  declared: readonly WorkerArtifact[];
  /** Worktree-relative paths git reports as changed, for detection. */
  changedFiles: readonly string[];
  taskId?: string;
  source: ArtifactSource;
}): Promise<{ registered: WorkerArtifact[]; skipped: { path: string; reason: string }[] }> {
  const slug = assertSlug(input.job.project);
  const folder = `${ARTIFACTS_DIR}/${input.taskId ?? input.job.id}`;

  const registered: WorkerArtifact[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();

  const declaredPaths = new Set(input.declared.map((entry) => path.posix.normalize(entry.path)));

  // Undeclared candidates: new/changed Markdown at the worktree root or in an
  // `artifacts/` folder, excluding the repository's own documentation.
  const detected: WorkerArtifact[] = input.changedFiles
    .filter((file) => /\.(md|markdown)$/i.test(file))
    .filter((file) => !file.includes("/") || file.startsWith("artifacts/"))
    .filter((file) => !/^(README|CONTRIBUTING|CHANGELOG|LICENSE)\.md$/i.test(file))
    .filter((file) => !declaredPaths.has(path.posix.normalize(file)))
    .map((file) => ({ path: file, title: "", detected: true }));

  for (const artifact of [...input.declared, ...detected]) {
    const normalised = path.posix.normalize(artifact.path).replace(/^\.\//, "");

    if (seen.has(normalised)) continue;
    seen.add(normalised);

    if (path.isAbsolute(normalised) || !isInside(input.worktreePath, normalised)) {
      skipped.push({ path: artifact.path, reason: "outside the worktree" });
      continue;
    }
    if (!/\.(md|markdown)$/i.test(normalised)) {
      skipped.push({ path: artifact.path, reason: "not Markdown" });
      continue;
    }

    const absolute = path.join(input.worktreePath, normalised);
    let raw: string;

    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw new Error("not a file");
      if (stat.size > MAX_ARTIFACT_BYTES) {
        skipped.push({ path: artifact.path, reason: "larger than 1 MB" });
        continue;
      }
      raw = await fs.readFile(absolute, "utf8");
    } catch {
      skipped.push({ path: artifact.path, reason: "does not exist" });
      continue;
    }

    if (raw.trim().length === 0) {
      skipped.push({ path: artifact.path, reason: "empty" });
      continue;
    }

    const own = safeMatter(raw);
    const title =
      artifact.title.trim() ||
      (typeof own.data.title === "string" ? own.data.title : undefined) ||
      /^#\s+(.+)$/m.exec(own.content)?.[1]?.trim() ||
      path.posix.basename(normalised).replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ");

    const typeParsed = ArtifactTypeSchema.safeParse(artifact.type ?? own.data.type);
    const type: ArtifactType = typeParsed.success ? typeParsed.data : artifact.detected ? "report" : "other";

    const filename = await uniqueFilename(slug, folder, toFilename(path.posix.basename(normalised)));
    const relativePath = projectFile(slug, `${folder}/${filename}`);

    const contents = withFrontMatter(raw, {
      title,
      type,
      source: input.source,
      task: input.taskId,
      job: input.job.id,
      created: today(),
      detected: artifact.detected,
    });

    await assertVaultRootPresent();
    await fs.mkdir(path.join(agentOSRoot(), PROJECTS_DIR, slug, folder), { recursive: true });
    await editFile({ relativePath, label: "artifact.register", apply: () => contents });

    registered.push({ ...artifact, title, type, registeredPath: relativePath });
  }

  return { registered, skipped };
}
