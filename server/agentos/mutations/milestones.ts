import type {
  CreateMilestoneRequest,
  MilestoneStatus,
  PatchMilestoneRequest,
  ProjectMilestone,
} from "../../../shared/agentos-types";
import {
  newMilestoneRecord,
  parseMilestoneDocument,
  serializeMilestoneDocument,
  toMilestoneId,
  type MilestoneDocument,
  type MilestoneRecord,
} from "./milestone-document";
import { assertSlug, InvalidRequestError, NotFoundError } from "./tasks";
import { editFile, projectFile, readForEdit, type EditResult } from "./writer";

/**
 * Milestone CRUD against `MILESTONES.md`.
 *
 * Same discipline as tasks: read with a revision, change the document, write
 * through the guarded writer. The decisions that matter are about meaning:
 *
 * - **Ids are minted once.** A slug of the title at creation, made unique by
 *   suffix if needed, and never changed by a rename — tasks, jobs and usage
 *   point at it.
 * - **Completion is a human act.** `completeMilestone` records the date and
 *   whatever review was written; nothing here inspects progress or criteria to
 *   decide for the operator. 100% of tasks done is a fact, not a verdict.
 * - **Archive, never delete, once anything references it.** A milestone with
 *   tasks or a review is history; it can be put away, not erased.
 */

const MILESTONES_FILE = "MILESTONES.md";
const TASK_REF = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;

export const MILESTONE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertMilestoneId(id: string): string {
  const cleaned = id.trim().toLowerCase();
  if (!MILESTONE_ID.test(cleaned)) throw new InvalidRequestError(`Invalid milestone id: ${id}`);
  return cleaned;
}

/** `pantry-pilot` → `Pantry Pilot`, for a new file's heading. */
function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleanTaskIds(ids: readonly string[]): string[] {
  return [
    ...new Set(
      ids.map((id) => id.trim().toUpperCase()).filter((id) => TASK_REF.test(id)),
    ),
  ];
}

function toMilestone(slug: string, record: MilestoneRecord): ProjectMilestone {
  return {
    id: record.id,
    project: slug,
    title: record.title,
    outcome: record.outcome,
    status: record.status,
    targetDate: record.targetDate,
    criteria: record.criteria,
    taskIds: record.taskIds,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    review: record.review,
  };
}

export async function readMilestones(slug: string): Promise<{
  revision: string;
  milestones: ProjectMilestone[];
}> {
  assertSlug(slug);

  const { data, revision } = await readForEdit(projectFile(slug, MILESTONES_FILE));
  const document = parseMilestoneDocument(data ?? "");

  return { revision, milestones: document.milestones.map((record) => toMilestone(slug, record)) };
}

function findRecord(document: MilestoneDocument, id: string): MilestoneRecord {
  const record = document.milestones.find((entry) => entry.id === id);
  if (!record) throw new NotFoundError(`No milestone ${id}.`);
  return record;
}

/** A unique id for a new milestone: the slug, or the slug with a counter. */
function uniqueId(document: MilestoneDocument, title: string): string {
  const base = toMilestoneId(title) || "milestone";
  const taken = new Set(document.milestones.map((entry) => entry.id));

  if (!taken.has(base)) return base;

  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${base}-${counter}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new InvalidRequestError("Could not find a free milestone id.");
}

async function edit(
  slug: string,
  label: string,
  expectedRevision: string | undefined,
  change: (document: MilestoneDocument) => void,
): Promise<EditResult> {
  const validSlug = assertSlug(slug);

  return editFile({
    relativePath: projectFile(validSlug, MILESTONES_FILE),
    expectedRevision,
    label,
    apply: (current) => {
      const document = parseMilestoneDocument(current ?? "");
      change(document);
      return serializeMilestoneDocument(document, titleCase(validSlug));
    },
  });
}

export interface MilestoneMutationResult extends EditResult {
  milestoneId: string;
}

export async function createMilestone(
  slug: string,
  input: CreateMilestoneRequest,
): Promise<MilestoneMutationResult> {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) throw new InvalidRequestError("A milestone needs a title.");

  let milestoneId = "";

  const result = await edit(slug, "milestone.create", input.expectedRevision, (document) => {
    milestoneId = uniqueId(document, title);

    // Only one milestone is active at a time; a new active one demotes the
    // current one to planned rather than leaving two "now"s.
    if (input.status === "active") {
      for (const entry of document.milestones) {
        if (entry.status === "active") entry.status = "planned";
      }
    }

    document.milestones.push(
      newMilestoneRecord({
        title,
        id: milestoneId,
        outcome: input.outcome,
        status: input.status,
        targetDate: input.targetDate,
        criteria: input.criteria,
        taskIds: cleanTaskIds(input.taskIds ?? []),
        createdAt: today(),
      }),
    );
  });

  return { ...result, milestoneId };
}

export async function patchMilestone(
  slug: string,
  id: string,
  input: PatchMilestoneRequest,
): Promise<MilestoneMutationResult> {
  const milestoneId = assertMilestoneId(id);

  const result = await edit(slug, "milestone.update", input.expectedRevision, (document) => {
    const record = findRecord(document, milestoneId);

    if (input.title !== undefined) {
      const title = input.title.replace(/\s+/g, " ").trim();
      if (!title) throw new InvalidRequestError("A milestone needs a title.");
      record.title = title;
    }
    if (input.outcome !== undefined) record.outcome = input.outcome.trim() || undefined;
    if (input.targetDate !== undefined) record.targetDate = input.targetDate || undefined;
    if (input.criteria !== undefined) {
      record.criteria = input.criteria
        .map((criterion) => ({ text: criterion.text.trim(), done: criterion.done }))
        .filter((criterion) => criterion.text.length > 0);
    }
    if (input.taskIds !== undefined) record.taskIds = cleanTaskIds(input.taskIds);
    if (input.review !== undefined) record.review = input.review.trim() || undefined;

    if (input.status !== undefined) setStatus(document, record, input.status);
  });

  return { ...result, milestoneId };
}

function setStatus(document: MilestoneDocument, record: MilestoneRecord, status: MilestoneStatus): void {
  if (status === "active") {
    for (const entry of document.milestones) {
      if (entry !== record && entry.status === "active") entry.status = "planned";
    }
  }

  if (status === "completed" && !record.completedAt) record.completedAt = today();
  if (status !== "completed") record.completedAt = undefined;

  record.status = status;
}

/**
 * Closes a milestone, with whatever review the operator (or Hermes, edited by
 * the operator) wrote. Deliberately does not check progress or criteria: the
 * review screen showed them, and the person clicked anyway.
 */
export async function completeMilestone(
  slug: string,
  id: string,
  input: { review?: string; expectedRevision?: string },
): Promise<MilestoneMutationResult> {
  const milestoneId = assertMilestoneId(id);

  const result = await edit(slug, "milestone.complete", input.expectedRevision, (document) => {
    const record = findRecord(document, milestoneId);
    if (input.review?.trim()) record.review = input.review.trim();
    setStatus(document, record, "completed");
  });

  return { ...result, milestoneId };
}

export async function setMilestoneStatus(
  slug: string,
  id: string,
  status: MilestoneStatus,
  expectedRevision?: string,
): Promise<MilestoneMutationResult> {
  const milestoneId = assertMilestoneId(id);

  const result = await edit(slug, `milestone.${status}`, expectedRevision, (document) => {
    setStatus(document, findRecord(document, milestoneId), status);
  });

  return { ...result, milestoneId };
}

/** Roadmap order. Ids not mentioned keep their relative order at the end. */
export async function reorderMilestones(
  slug: string,
  ids: readonly string[],
  expectedRevision?: string,
): Promise<EditResult> {
  const wanted = ids.map((id) => assertMilestoneId(id));

  return edit(slug, "milestone.reorder", expectedRevision, (document) => {
    const byId = new Map(document.milestones.map((entry) => [entry.id, entry]));
    const ordered: MilestoneRecord[] = [];

    for (const id of wanted) {
      const record = byId.get(id);
      if (record && !ordered.includes(record)) ordered.push(record);
    }
    for (const record of document.milestones) {
      if (!ordered.includes(record)) ordered.push(record);
    }

    document.milestones = ordered;
  });
}

/**
 * Removes a milestone outright. Only for one nothing references: no tasks, no
 * review. Everything else goes through archive.
 */
export async function deleteMilestone(
  slug: string,
  id: string,
  expectedRevision?: string,
): Promise<EditResult> {
  const milestoneId = assertMilestoneId(id);

  return edit(slug, "milestone.delete", expectedRevision, (document) => {
    const record = findRecord(document, milestoneId);

    if (record.taskIds.length > 0 || record.review) {
      throw new InvalidRequestError(
        `${record.title} has tasks or a review. Archive it instead of deleting it.`,
      );
    }

    document.milestones = document.milestones.filter((entry) => entry !== record);
  });
}

/**
 * Files a task under a milestone — and under only that one. A task belongs to
 * at most one milestone, so assigning moves it rather than copying it.
 */
export async function assignTask(
  slug: string,
  taskId: string,
  milestoneId: string | undefined,
  expectedRevision?: string,
): Promise<EditResult> {
  const cleanId = taskId.trim().toUpperCase();
  if (!TASK_REF.test(cleanId)) throw new InvalidRequestError(`Invalid task id: ${taskId}`);

  const target = milestoneId === undefined ? undefined : assertMilestoneId(milestoneId);

  return edit(slug, "milestone.assign", expectedRevision, (document) => {
    if (target !== undefined) findRecord(document, target);

    for (const record of document.milestones) {
      record.taskIds = record.taskIds.filter((id) => id !== cleanId);
      if (record.id === target) record.taskIds.push(cleanId);
    }
  });
}

/** Ticks or unticks one success criterion. */
export async function setCriterion(
  slug: string,
  id: string,
  index: number,
  done: boolean,
  expectedRevision?: string,
): Promise<EditResult> {
  const milestoneId = assertMilestoneId(id);

  return edit(slug, "milestone.criterion", expectedRevision, (document) => {
    const record = findRecord(document, milestoneId);
    const criterion = record.criteria[index];
    if (!criterion) throw new NotFoundError(`No criterion ${index} on ${record.title}.`);
    criterion.done = done;
  });
}
