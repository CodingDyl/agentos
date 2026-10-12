import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MotionDraftSchema,
  MotionRunSchema,
  type MotionDraft,
  type MotionRun,
} from "../../shared/motion-design-types";
import { uiStateDir } from "../agentos/session-store";

export class MotionDesignError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "MotionDesignError";
  }
}

function rootDir(): string {
  return path.join(uiStateDir(), "motion-design");
}

function runFile(id: string): string {
  if (!/^mdn_[a-f0-9]{16}$/.test(id)) throw new MotionDesignError("Invalid Motion Design id.", 400);
  return path.join(rootDir(), `${id}.json`);
}

function draftFile(): string {
  return path.join(rootDir(), "draft.json");
}

function indexFile(): string {
  return path.join(rootDir(), "by-workspace.json");
}

export function createMotionRunId(): string {
  return `mdn_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function saveDraft(draft: MotionDraft): Promise<MotionDraft> {
  const parsed = MotionDraftSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
  await writeJson(draftFile(), parsed);
  return parsed;
}

export async function readDraft(): Promise<MotionDraft | undefined> {
  const raw = await readJson<unknown>(draftFile());
  if (!raw) return undefined;
  const parsed = MotionDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function clearDraft(): Promise<void> {
  await fs.rm(draftFile(), { force: true });
}

async function workspaceIndex(): Promise<Record<string, string>> {
  return (await readJson<Record<string, string>>(indexFile())) ?? {};
}

export async function saveRun(run: MotionRun): Promise<MotionRun> {
  const parsed = MotionRunSchema.parse({ ...run, updatedAt: new Date().toISOString() });
  await writeJson(runFile(parsed.id), parsed);
  const index = await workspaceIndex();
  index[parsed.workspaceSlug] = parsed.id;
  await writeJson(indexFile(), index);
  return parsed;
}

export async function readRun(id: string): Promise<MotionRun> {
  const raw = await readJson<unknown>(runFile(id));
  if (!raw) throw new MotionDesignError("That Motion Design run could not be found.", 404);
  const parsed = MotionRunSchema.safeParse(raw);
  if (!parsed.success) throw new MotionDesignError("That Motion Design run could not be read.", 500);
  return parsed.data;
}

export async function runForWorkspace(slug: string): Promise<MotionRun | undefined> {
  const index = await workspaceIndex();
  const id = index[slug];
  if (!id) return undefined;
  try {
    return await readRun(id);
  } catch {
    return undefined;
  }
}

export function draftFilesDir(): string {
  return path.join(rootDir(), "draft-files");
}

export async function saveDraftFile(filename: string, bytes: Buffer): Promise<{ id: string; filename: string; path: string }> {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "reference";
  const id = `ref_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const dest = path.join(draftFilesDir(), `${id}-${safe}`);
  await fs.mkdir(draftFilesDir(), { recursive: true });
  await fs.writeFile(dest, bytes);
  return { id, filename: safe, path: dest };
}

export async function listRuns(): Promise<MotionRun[]> {
  await fs.mkdir(rootDir(), { recursive: true });
  const names = await fs.readdir(rootDir());
  const runs: MotionRun[] = [];
  for (const name of names) {
    if (!name.startsWith("mdn_") || !name.endsWith(".json")) continue;
    try {
      runs.push(await readRun(name.slice(0, -".json".length)));
    } catch {
      // Skip a corrupt record rather than failing the list.
    }
  }
  return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
