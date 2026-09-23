import type { BulkTaskAction } from "../../../shared/agentos-types";
import { readOptionalFile } from "../filesystem";
import { parseConfiguration } from "./configuration";
import { readForEdit, editFile, projectFile, type EditResult } from "./writer";
import { nextTaskId } from "./task-ids";
import {
  allTasks,
  findTask,
  insertTask,
  moveTask,
  parseTaskDocument,
  removeTask,
  reorderSection,
  serializeTaskDocument,
  updateTask as updateInDocument,
  type TaskSectionName,
} from "./task-document";

/**
 * Task CRUD against `TASKS.md`.
 *
 * Every function here follows the same three steps — read with a revision,
 * change the document, write through the guarded writer — and none of them
 * touches the filesystem directly. The interesting decisions are about what a
 * change *means*, not about how it is written.
 *
 * These are human mutations: they take effect immediately, with no approval
 * step. That is the rule change this whole layer exists for. An operator
 * ticking their own checkbox does not need permission from an agent; an agent
 * proposing a change to the same file still does.
 */

const TASKS_FILE = "TASKS.md";

/** Slugs are directory names. Nothing else may reach a path. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Ids are generated here and matched here. Nothing else may reach a document. */
const TASK_ID = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;

export class NotFoundError extends Error {
  readonly code = "not_found";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class InvalidRequestError extends Error {
  readonly code = "invalid_request";

  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export function assertSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new InvalidRequestError(`Invalid project: ${slug}`);

  return slug;
}

function assertTaskId(id: string): string {
  if (!TASK_ID.test(id)) throw new InvalidRequestError(`Invalid task id: ${id}`);

  return id;
}

/**
 * A title, cleaned enough to be one line of a markdown list.
 *
 * Newlines are collapsed rather than rejected, because a paste from anywhere
 * carries them and refusing the paste would be the wrong answer. A leading
 * `[XX-001]` is stripped: the id belongs to AgentOS, and letting a title carry
 * one would produce a line with two of them.
 */
export function cleanTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const withoutId = collapsed.replace(/^\[[A-Z][A-Z0-9]{0,7}-\d{1,5}\]\s*/, "");

  if (withoutId.length === 0) {
    throw new InvalidRequestError("A task needs a title.");
  }

  return withoutId.slice(0, 500);
}

const SECTIONS: readonly TaskSectionName[] = ["now", "next", "later", "done", "archived"];

export function assertSection(section: string): TaskSectionName {
  const normalised = section.trim().toLowerCase();

  if (!(SECTIONS as readonly string[]).includes(normalised)) {
    throw new InvalidRequestError(`Unknown section: ${section}`);
  }

  return normalised as TaskSectionName;
}

/** Reads a project's tasks together with the revision they were read at. */
export async function readTasks(slug: string): Promise<{
  revision: string;
  tasks: {
    id?: string;
    title: string;
    completed: boolean;
    section: TaskSectionName | undefined;
    ready?: boolean;
    after?: string[];
  }[];
}> {
  assertSlug(slug);

  const { data, revision } = await readForEdit(projectFile(slug, TASKS_FILE));
  const document = parseTaskDocument(data ?? "");

  return {
    revision,
    tasks: allTasks(document).map((block) => {
      const found = block.id ? findTask(document, block.id) : undefined;

      return {
        id: block.id,
        title: block.title,
        completed: block.completed,
        section: found?.section,
        ready: block.ready,
        after: block.after,
      };
    }),
  };
}

export interface CreateTaskInput {
  slug: string;
  title: string;
  section?: string;
  expectedRevision?: string;
}

export interface TaskMutationResult extends EditResult {
  taskId: string;
}

/**
 * Adds a task.
 *
 * The id is allocated against the file's current contents *and* the durable
 * high-water mark, inside the same read that the write is checked against — so
 * two tasks created at once cannot be handed the same number.
 */
export async function createTask(
  input: CreateTaskInput,
): Promise<TaskMutationResult> {
  const slug = assertSlug(input.slug);
  const section = assertSection(input.section ?? "now");
  const title = cleanTitle(input.title);

  const relativePath = projectFile(slug, TASKS_FILE);
  const [{ data }, projectMarkdown] = await Promise.all([
    readForEdit(relativePath),
    readOptionalFile(projectFile(slug, "PROJECT.md")),
  ]);

  const existing = allTasks(parseTaskDocument(data ?? ""))
    .map((task) => task.id)
    .filter((id): id is string => id !== undefined);

  const taskId = await nextTaskId(slug, existing, {
    preferredPrefix: parseConfiguration(projectMarkdown).taskPrefix,
  });

  const result = await editFile({
    relativePath,
    expectedRevision: input.expectedRevision,
    label: "task.create",
    apply: (current) => {
      // A project whose TASKS.md does not exist yet gets the smallest file that
      // is still a document, rather than a heading-less fragment.
      const document = parseTaskDocument(current ?? `# Tasks\n`);

      insertTask(document, section, { id: taskId, title });

      return serializeTaskDocument(document);
    },
  });

  return { ...result, taskId };
}

export interface UpdateTaskInput {
  slug: string;
  taskId: string;
  title?: string;
  completed?: boolean;
  section?: string;
  position?: number;
  ready?: boolean;
  /** Replaces the dependency list. An empty array clears it. */
  after?: string[];
  expectedRevision?: string;
}

/**
 * Edits a task: its title, whether it is done, and where it sits.
 *
 * One function rather than four endpoints because they are one operation from
 * the file's point of view — a title change and a move are both "rewrite this
 * document once" — and splitting them would mean an operator who renamed and
 * re-sectioned a task in the same dialog hit a conflict against themselves.
 */
export async function updateTask(
  input: UpdateTaskInput,
): Promise<TaskMutationResult> {
  const slug = assertSlug(input.slug);
  const taskId = assertTaskId(input.taskId);
  const title = input.title === undefined ? undefined : cleanTitle(input.title);
  const section = input.section === undefined ? undefined : assertSection(input.section);
  const after =
    input.after === undefined
      ? undefined
      : input.after.map((id) => assertTaskId(id)).filter((id) => id !== taskId);

  const result = await editFile({
    relativePath: projectFile(slug, TASKS_FILE),
    expectedRevision: input.expectedRevision,
    label: input.completed === true ? "task.complete" : "task.update",
    apply: (current) => {
      const document = parseTaskDocument(current ?? "");

      if (!findTask(document, taskId)) {
        throw new NotFoundError(`${taskId} is not in ${slug}.`);
      }

      if (
        title !== undefined ||
        input.completed !== undefined ||
        input.ready !== undefined ||
        after !== undefined
      ) {
        updateInDocument(document, taskId, {
          title,
          completed: input.completed,
          ready: input.ready,
          after,
        });
      }

      if (section !== undefined) {
        moveTask(document, taskId, section, input.position);
      }

      return serializeTaskDocument(document);
    },
  });

  return { ...result, taskId };
}

/**
 * Ticks a task off.
 *
 * Marks it done and moves it to `Done` in one write. Completion is the most
 * common action on this screen and the least dangerous, so it is one click with
 * no confirmation — the backup the writer takes is the safety net, and undo is
 * a better answer than a dialog on every checkbox.
 */
export async function completeTask(input: {
  slug: string;
  taskId: string;
  expectedRevision?: string;
}): Promise<TaskMutationResult> {
  return updateTask({ ...input, completed: true, section: "done" });
}

/** Puts a completed task back into circulation. */
export async function reopenTask(input: {
  slug: string;
  taskId: string;
  section?: string;
  expectedRevision?: string;
}): Promise<TaskMutationResult> {
  return updateTask({
    ...input,
    completed: false,
    section: input.section ?? "now",
  });
}

export interface ReorderInput {
  slug: string;
  section: string;
  taskIds: string[];
  expectedRevision?: string;
}

export async function reorderTasks(input: ReorderInput): Promise<EditResult> {
  const slug = assertSlug(input.slug);
  const section = assertSection(input.section);
  const taskIds = input.taskIds.map((id) => assertTaskId(id));

  return editFile({
    relativePath: projectFile(slug, TASKS_FILE),
    expectedRevision: input.expectedRevision,
    label: "task.reorder",
    apply: (current) => {
      const document = parseTaskDocument(current ?? "");

      reorderSection(document, section, taskIds);

      return serializeTaskDocument(document);
    },
  });
}

/**
 * Removes a task from the file.
 *
 * The id is *not* released. Whatever happens to the line, `PP-014` stays spent
 * — a worker job, a review and a row of usage may already refer to it, and
 * handing the number to a different piece of work would make all of that
 * quietly wrong.
 */
export async function deleteTask(input: {
  slug: string;
  taskId: string;
  expectedRevision?: string;
}): Promise<TaskMutationResult> {
  const slug = assertSlug(input.slug);
  const taskId = assertTaskId(input.taskId);

  const result = await editFile({
    relativePath: projectFile(slug, TASKS_FILE),
    expectedRevision: input.expectedRevision,
    label: "task.delete",
    apply: (current) => {
      const document = parseTaskDocument(current ?? "");

      if (!removeTask(document, taskId)) {
        throw new NotFoundError(`${taskId} is not in ${slug}.`);
      }

      return serializeTaskDocument(document);
    },
  });

  return { ...result, taskId };
}

/**
 * Puts a task out of sight without finishing or deleting it.
 *
 * The line moves to `## Archived` with its id intact, so everything that
 * references the id — jobs, reviews, usage, activity — still resolves to a
 * readable task. This is the normal way to drop a task; deletion is for the
 * one that was created by mistake and has no history behind it.
 */
export async function archiveTask(input: {
  slug: string;
  taskId: string;
  expectedRevision?: string;
}): Promise<TaskMutationResult> {
  const slug = assertSlug(input.slug);
  const taskId = assertTaskId(input.taskId);

  const result = await editFile({
    relativePath: projectFile(slug, TASKS_FILE),
    expectedRevision: input.expectedRevision,
    label: "task.archive",
    apply: (current) => {
      const document = parseTaskDocument(current ?? "");

      if (!moveTask(document, taskId, "archived")) {
        throw new NotFoundError(`${taskId} is not in ${slug}.`);
      }

      return serializeTaskDocument(document);
    },
  });

  return { ...result, taskId };
}

/** Brings an archived task back into circulation, in `Later` unless told otherwise. */
export async function restoreTask(input: {
  slug: string;
  taskId: string;
  section?: string;
  expectedRevision?: string;
}): Promise<TaskMutationResult> {
  const slug = assertSlug(input.slug);
  const taskId = assertTaskId(input.taskId);
  const section = assertSection(input.section ?? "later");

  if (section === "archived") {
    throw new InvalidRequestError("Restoring to archived is not a restore.");
  }

  const result = await editFile({
    relativePath: projectFile(slug, TASKS_FILE),
    expectedRevision: input.expectedRevision,
    label: "task.restore",
    apply: (current) => {
      const document = parseTaskDocument(current ?? "");
      const found = findTask(document, taskId);

      if (!found) throw new NotFoundError(`${taskId} is not in ${slug}.`);

      updateInDocument(document, taskId, { completed: false });
      moveTask(document, taskId, section);

      return serializeTaskDocument(document);
    },
  });

  return { ...result, taskId };
}

/**
 * One change to many tasks, in one write.
 *
 * Server-side rather than a loop in the browser, because five sequential
 * edits against a revision-checked file are four guaranteed conflicts. Here
 * the document is read once, every task is changed, and the file is written
 * once — one backup, one undo, one revision to reload against.
 *
 * Ids that are not in the file are reported rather than failing the batch: a
 * selection made a minute ago may include a task someone else just finished,
 * and refusing to move the other four because of it helps nobody.
 */
export async function bulkTasks(
  slug: string,
  input: BulkTaskAction,
): Promise<EditResult & { applied: string[]; missing: string[] }> {
  const validSlug = assertSlug(slug);
  const taskIds = [...new Set(input.taskIds.map((id) => assertTaskId(id)))];

  const target =
    input.action === "complete"
      ? "done"
      : input.action === "archive"
        ? "archived"
        : input.action === "restore"
          ? assertSection(input.section ?? "later")
          : input.section === undefined
            ? undefined
            : assertSection(input.section);

  if (target === undefined) {
    throw new InvalidRequestError("Moving tasks needs a section.");
  }

  if (input.action === "restore" && target === "archived") {
    throw new InvalidRequestError("Restoring to archived is not a restore.");
  }

  const applied: string[] = [];
  const missing: string[] = [];

  const result = await editFile({
    relativePath: projectFile(validSlug, TASKS_FILE),
    expectedRevision: input.expectedRevision,
    label: `task.bulk.${input.action}`,
    apply: (current) => {
      const document = parseTaskDocument(current ?? "");

      for (const taskId of taskIds) {
        if (!findTask(document, taskId)) {
          missing.push(taskId);
          continue;
        }

        if (input.action === "complete") {
          updateInDocument(document, taskId, { completed: true });
        } else if (target === "now" || target === "next" || target === "later") {
          // Landing in an open section reopens the task, wherever it came
          // from. Archiving leaves its state alone: a finished task that is
          // put away is still finished.
          updateInDocument(document, taskId, { completed: false });
        }

        moveTask(document, taskId, target);
        applied.push(taskId);
      }

      if (applied.length === 0) {
        throw new NotFoundError(`None of those tasks are in ${validSlug}.`);
      }

      return serializeTaskDocument(document);
    },
  });

  return { ...result, applied, missing };
}
