import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { TaskBrief, TaskReference } from "../../../shared/agentos-types";
import { TaskBriefSchema } from "../../../shared/agentos-types";
import {
  agentOSRoot,
  readAgentOSBytes,
  readOptionalFile,
  writeAgentOSBytes,
  writeAgentOSFile,
} from "../filesystem";
import { assertSlug, InvalidRequestError } from "./tasks";
import { projectFile } from "./writer";

/**
 * Extra detail for a task, stored beside TASKS.md rather than on the line.
 *
 * The board line stays a title. Desired outcome, scope, acceptance, constraints
 * and reference uploads live under `artifacts/<task-id>/` so a worker can be
 * handed them as context without rewriting the project's task list.
 */

const TASK_ID = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;
const MAX_REF_BYTES = 12 * 1024 * 1024;
const MAX_REFS = 12;
const MAX_TEXT = 8_000;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);
const ALLOWED_TYPES = new Set([
  ...IMAGE_TYPES,
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const EXT_FOR: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export function taskBriefPath(slug: string, taskId: string): string {
  return projectFile(slug, `artifacts/${taskId}/brief.md`);
}

export function taskRefsDir(slug: string, taskId: string): string {
  return projectFile(slug, `artifacts/${taskId}/refs`);
}

function assertTaskId(id: string): string {
  const trimmed = id.trim().toUpperCase();
  if (!TASK_ID.test(trimmed)) throw new InvalidRequestError(`Invalid task id: ${id}`);
  return trimmed;
}

function clip(value: string | undefined, limit = MAX_TEXT): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function clipList(values: readonly string[] | undefined, limit = 20): string[] | undefined {
  if (!values) return undefined;
  const entries = values.map((item) => item.trim()).filter(Boolean).slice(0, limit);
  return entries.length > 0 ? entries.map((item) => item.slice(0, 500)) : undefined;
}

function isImageName(name: string, mimeType?: string): boolean {
  if (mimeType && IMAGE_TYPES.has(mimeType)) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

const MIME_FOR_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function mimeForRefName(name: string): string {
  return MIME_FOR_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

export function safeRefName(original: string, mimeType?: string): string {
  const base = path.basename(original).replace(/[/\\]/g, "");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const hasExt = /\.[a-zA-Z0-9]{1,8}$/.test(cleaned);
  const ext = mimeType ? EXT_FOR[mimeType] : undefined;
  const name = cleaned || "reference";
  if (hasExt) return name;
  return `${name}${ext ?? ""}`;
}

export function parseTaskBrief(markdown: string, taskId: string): TaskBrief {
  const parsed = matter(markdown);
  const data = parsed.data as Record<string, unknown>;
  const list = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;

  return TaskBriefSchema.parse({
    taskId,
    desiredOutcome: typeof data.desiredOutcome === "string" ? data.desiredOutcome : undefined,
    scope: typeof data.scope === "string" ? data.scope : parsed.content.trim() || undefined,
    acceptanceCriteria: list(data.acceptance),
    constraints: list(data.constraints),
    links: list(data.links),
    references: undefined,
  });
}

export function serializeTaskBrief(brief: TaskBrief): string {
  const data: Record<string, unknown> = {};
  if (brief.desiredOutcome) data.desiredOutcome = brief.desiredOutcome;
  if (brief.acceptanceCriteria?.length) data.acceptance = brief.acceptanceCriteria;
  if (brief.constraints?.length) data.constraints = brief.constraints;
  if (brief.links?.length) data.links = brief.links;

  const body = brief.scope?.trim() ? `${brief.scope.trim()}\n` : "";
  return matter.stringify(body, data);
}

async function listReferences(slug: string, taskId: string): Promise<TaskReference[]> {
  const relative = taskRefsDir(slug, taskId);
  const directory = path.join(agentOSRoot(), relative);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }

  return names
    .filter((name) => name && !name.startsWith("."))
    .sort()
    .map((name) => ({
      name,
      relativePath: `${relative}/${name}`,
      image: isImageName(name),
    }));
}

export async function readTaskBrief(slug: string, taskId: string): Promise<TaskBrief | undefined> {
  const validSlug = assertSlug(slug);
  const id = assertTaskId(taskId);
  const markdown = await readOptionalFile(taskBriefPath(validSlug, id));
  const references = await listReferences(validSlug, id);
  if (!markdown && references.length === 0) return undefined;

  const parsed = markdown ? parseTaskBrief(markdown, id) : { taskId: id };
  return { ...parsed, taskId: id, references: references.length > 0 ? references : undefined };
}

export interface SaveTaskBriefInput {
  slug: string;
  taskId: string;
  desiredOutcome?: string;
  scope?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  links?: string[];
}

export async function saveTaskBrief(input: SaveTaskBriefInput): Promise<TaskBrief> {
  const slug = assertSlug(input.slug);
  const taskId = assertTaskId(input.taskId);
  const existing = await readTaskBrief(slug, taskId);

  const brief: TaskBrief = {
    taskId,
    desiredOutcome: clip(input.desiredOutcome) ?? existing?.desiredOutcome,
    scope: clip(input.scope) ?? existing?.scope,
    acceptanceCriteria: clipList(input.acceptanceCriteria) ?? existing?.acceptanceCriteria,
    constraints: clipList(input.constraints) ?? existing?.constraints,
    links: clipList(input.links) ?? existing?.links,
    references: existing?.references,
  };

  const empty =
    !brief.desiredOutcome &&
    !brief.scope &&
    !brief.acceptanceCriteria?.length &&
    !brief.constraints?.length &&
    !brief.links?.length;

  if (!empty) {
    await writeAgentOSFile(taskBriefPath(slug, taskId), serializeTaskBrief(brief));
  }

  return (await readTaskBrief(slug, taskId)) ?? brief;
}

export async function saveTaskReference(input: {
  slug: string;
  taskId: string;
  filename: string;
  mimeType?: string;
  body: Buffer;
}): Promise<TaskReference> {
  const slug = assertSlug(input.slug);
  const taskId = assertTaskId(input.taskId);

  if (input.body.length === 0) throw new InvalidRequestError("The upload was empty.");
  if (input.body.length > MAX_REF_BYTES) {
    throw new InvalidRequestError(`Reference files are limited to ${MAX_REF_BYTES / (1024 * 1024)} MB.`);
  }

  const mime = input.mimeType?.split(";")[0]?.trim().toLowerCase();
  if (mime && !ALLOWED_TYPES.has(mime) && !mime.startsWith("image/")) {
    throw new InvalidRequestError("That file type is not supported as a task reference.");
  }

  const existing = await listReferences(slug, taskId);
  if (existing.length >= MAX_REFS) {
    throw new InvalidRequestError(`A task can hold at most ${MAX_REFS} reference files.`);
  }

  const name = safeRefName(input.filename, mime);
  const relativePath = `${taskRefsDir(slug, taskId)}/${name}`;
  await writeAgentOSBytes(relativePath, input.body);

  return {
    name,
    relativePath,
    mimeType: mime,
    image: isImageName(name, mime),
  };
}

export async function readTaskReference(slug: string, taskId: string, name: string): Promise<{ body: Buffer; relativePath: string }> {
  const validSlug = assertSlug(slug);
  const id = assertTaskId(taskId);
  const safe = path.basename(name);
  if (safe !== name || safe.startsWith(".") || safe.includes("..")) {
    throw new InvalidRequestError("Invalid reference name.");
  }
  const relativePath = `${taskRefsDir(validSlug, id)}/${safe}`;
  return { body: await readAgentOSBytes(relativePath), relativePath };
}

/** Absolute paths a worker can open, plus the brief file itself. */
export async function taskBriefContextFiles(slug: string, taskId: string): Promise<string[]> {
  const brief = await readTaskBrief(slug, taskId);
  if (!brief) return [];

  const root = agentOSRoot();
  const files: string[] = [];
  const markdown = await readOptionalFile(taskBriefPath(slug, taskId));
  if (markdown) files.push(path.join(root, taskBriefPath(slug, taskId)));
  for (const ref of brief.references ?? []) {
    files.push(path.join(root, ref.relativePath));
  }
  return files;
}
