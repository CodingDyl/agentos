import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProjectConfiguration,
  ProjectConfigurationPatch,
  ProjectPatchResponse,
  ProjectPriority,
  ProjectState,
  TaskSectionName,
} from "../../../shared/agentos-types";
import { DEFAULT_PROJECT_CONFIGURATION } from "../../../shared/agentos-types";
import { agentOSRoot, listDirectory, readOptionalFile } from "../filesystem";
import {
  applyConfiguration,
  isDefaultConfiguration,
  mergeConfiguration,
  parseConfiguration,
  renderConfiguration,
} from "./configuration";
import { writeDecision } from "./decisions";
import { findSection, setSection } from "./prose-document";
import { createTask } from "./tasks";
import {
  appendEntry,
  findEntry,
  setEntryField,
  setEntryGoal,
} from "./portfolio-document";
import { assertSlug, InvalidRequestError, NotFoundError } from "./tasks";
import { editFile, projectFile, readForEdit, type EditResult } from "./writer";

/**
 * Creating and configuring projects.
 *
 * Two files, not one. A project's *identity* — name, type, state, priority,
 * goal — lives in `PORTFOLIO.md`, and its *substance* lives in
 * `projects/<slug>/`. Creating one means writing both, and changing its state
 * means editing the portfolio rather than the project's own files. That is the
 * vault's existing shape, not a choice made here, and mutations that ignored it
 * would produce projects the reader could not see.
 *
 * No model is involved in any of this. Creating a project is four files from
 * templates and one block appended to a list; asking an LLM to do it would add
 * latency, cost and non-determinism to an operation with exactly one right
 * answer.
 */

const PORTFOLIO = "projects/PORTFOLIO.md";
const PROJECTS_DIR = "projects";

const STATE_LABELS: Record<ProjectState, string> = {
  active: "Active",
  blocked: "Blocked",
  incubating: "Incubating",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Turns a display name into the directory name the reader will resolve to. */
export function toSlug(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  goal?: string;
  type?: string;
  state?: ProjectState;
  priority?: ProjectPriority;
  repoPath?: string;
  configuration?: ProjectConfigurationPatch;
  /** Seeded tasks — what "create from plan" arrives with. */
  tasks?: { title: string; section?: TaskSectionName }[];
  decisions?: { title: string; body: string }[];
}

/** The four files every project has, from templates rather than from a model. */
function templates(input: {
  name: string;
  goal?: string;
  state: ProjectState;
  repoPath?: string;
  configuration: ProjectConfiguration;
}): Record<string, string> {
  const goal = input.goal?.trim();

  return {
    "PROJECT.md": [
      `# ${input.name}`,
      "",
      "## Purpose",
      "",
      goal ?? "_Describe what this project is for._",
      "",
      "## Connected Systems",
      "",
      input.repoPath
        ? `- Local repository: ${input.repoPath}`
        : "- Local repository: _not set_",
      "",
      // Only a project that was configured gets the section. Defaults are
      // defaults; writing them out would only give a person something to
      // wonder about.
      ...(isDefaultConfiguration(input.configuration)
        ? []
        : ["## Configuration", "", renderConfiguration(input.configuration), ""]),
    ].join("\n"),

    "STATUS.md": [
      `# ${input.name} Status`,
      "",
      "## Current Stage",
      "",
      `${STATE_LABELS[input.state]}. Nothing recorded yet.`,
      "",
    ].join("\n"),

    "TASKS.md": [`# ${input.name} Tasks`, "", "## Now", "", "## Next", "", "## Later", ""].join("\n"),

    "DECISIONS.md": [
      `# ${input.name} Decisions`,
      "",
      "No confirmed decisions recorded yet.",
      "",
    ].join("\n"),
  };
}

export interface CreateProjectResult {
  slug: string;
  name: string;
}

/**
 * Creates a project.
 *
 * Refuses a slug that already has a directory *or* a portfolio entry: the two
 * can disagree, and creating over either half would produce a project whose
 * files and identity belong to different things.
 */
export async function createProject(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const name = input.name.replace(/\s+/g, " ").trim();

  if (name.length === 0) throw new InvalidRequestError("A project needs a name.");

  const slug = assertSlug(input.slug?.trim() || toSlug(name));

  const existing = await listDirectory(PROJECTS_DIR);

  if (existing.includes(slug)) {
    throw new InvalidRequestError(`A project directory named ${slug} already exists.`);
  }

  const portfolio = (await readOptionalFile(PORTFOLIO)) ?? "# Project Portfolio\n\n## Projects\n";

  if (findEntry(portfolio.split(/\r?\n/), slug)) {
    throw new InvalidRequestError(`${name} is already in the portfolio.`);
  }

  const state = input.state ?? "incubating";
  const priority = input.priority ?? "low";
  const configuration = mergeConfiguration(
    DEFAULT_PROJECT_CONFIGURATION,
    input.configuration ?? {},
  );

  const files = templates({
    name,
    goal: input.goal,
    state,
    repoPath: input.repoPath?.trim() || undefined,
    configuration,
  });

  // The directory first: a portfolio entry pointing at nothing is a worse
  // half-finished state than a directory the portfolio has not noticed yet.
  await fs.mkdir(path.join(agentOSRoot(), PROJECTS_DIR, slug), { recursive: true });

  for (const [file, contents] of Object.entries(files)) {
    await editFile({
      relativePath: projectFile(slug, file),
      label: "project.create",
      apply: () => contents,
    });
  }

  await editFile({
    relativePath: PORTFOLIO,
    label: "project.create",
    apply: (current) =>
      appendEntry(current ?? portfolio, {
        name,
        type: input.type?.trim() || "Product",
        state: STATE_LABELS[state],
        priority: PRIORITY_LABELS[priority],
        goal: input.goal?.replace(/\s+/g, " ").trim(),
      }),
  });

  // Seeds go through the ordinary task and decision mutations so ids are
  // minted the same way and the files end up exactly as if typed in one by one.
  for (const task of input.tasks ?? []) {
    if (!task.title.trim()) continue;
    await createTask({ slug, title: task.title, section: task.section ?? "later" });
  }

  for (const decision of input.decisions ?? []) {
    if (!decision.title.trim()) continue;
    await writeDecision({ slug, title: decision.title, body: decision.body });
  }

  return { slug, name };
}

export interface PatchProjectInput {
  slug: string;
  name?: string;
  goal?: string;
  type?: string;
  state?: ProjectState;
  priority?: ProjectPriority;
  repoPath?: string;
  configuration?: ProjectConfigurationPatch;
  /** The portfolio revision. Kept for callers that only edit identity. */
  expectedRevision?: string;
  expectedRevisions?: { portfolio?: string; project?: string };
}

/** Which of the two files a patch actually touches. */
function touchesPortfolio(input: PatchProjectInput): boolean {
  return (
    input.name !== undefined ||
    input.goal !== undefined ||
    input.type !== undefined ||
    input.state !== undefined ||
    input.priority !== undefined
  );
}

function touchesProjectFile(input: PatchProjectInput): boolean {
  return input.repoPath !== undefined || input.configuration !== undefined;
}

const REPOSITORY_FIELD = /^(\s*(?:[-*+]\s+)?)(Local repo(?:sitory)?)\s*:\s*.*$/i;

/**
 * Sets `Local repository` under `## Connected Systems`, where the reader and
 * the delegation pipeline already look for it.
 *
 * Rewrites the existing line in place when there is one, so the bullet style
 * and any neighbouring fields stay as written; adds the section when the file
 * has none.
 */
export function applyRepositoryPath(markdown: string, repoPath: string): string {
  const value = repoPath.trim() || "_not set_";
  const lines = markdown.split(/\r?\n/);
  const section = findSection(lines, "Connected Systems");

  if (section) {
    for (let index = section.start; index < section.end; index += 1) {
      const match = REPOSITORY_FIELD.exec(lines[index]);

      if (match) {
        lines[index] = `${match[1]}${match[2]}: ${value}`;
        return lines.join("\n");
      }
    }

    // A section with no repository line yet: add one at the top of it.
    lines.splice(section.start, 0, "", `- Local repository: ${value}`);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  return setSection(markdown, "Connected Systems", `- Local repository: ${value}`);
}

/**
 * Changes a project's identity and configuration.
 *
 * Identity — name, type, state, priority, goal — is a portfolio edit, because
 * that is where the reader looks. Repository and configuration live in the
 * project's own `PROJECT.md`. Each file is edited only when a field in it
 * changed, and each is checked against its own revision, so a settings sheet
 * that only touched validation commands cannot conflict on the portfolio.
 *
 * Renaming is deliberately *not* offered as a slug change: the slug is the
 * directory name and the key that worker jobs, usage records, designs and
 * sessions all reference, so a rename changes the display name and leaves the
 * identity alone.
 */
export async function patchProject(
  input: PatchProjectInput,
): Promise<ProjectPatchResponse> {
  const slug = assertSlug(input.slug);
  const response: ProjectPatchResponse = {};

  if (touchesPortfolio(input)) {
    response.portfolio = await editFile({
      relativePath: PORTFOLIO,
      expectedRevision: input.expectedRevisions?.portfolio ?? input.expectedRevision,
      label: "project.update",
      apply: (current) => {
        if (current === undefined) {
          throw new NotFoundError("The portfolio could not be read.");
        }

        const trailingNewline = current.endsWith("\n");
        const lines = current.split(/\r?\n/);

        if (trailingNewline) lines.pop();

        const range = findEntry(lines, slug);

        if (!range) throw new NotFoundError(`${slug} is not in the portfolio.`);

        if (input.name) {
          const heading = lines[range.headingIndex].match(/^(#{1,6})\s+/);

          lines[range.headingIndex] = `${heading?.[1] ?? "###"} ${input.name.trim()}`;
        }

        if (input.type) setEntryField(lines, range, "Type", input.type.trim());
        if (input.state) setEntryField(lines, range, "State", STATE_LABELS[input.state]);
        if (input.priority) {
          setEntryField(lines, range, "Priority", PRIORITY_LABELS[input.priority]);
        }

        if (input.goal !== undefined) {
          setEntryGoal(lines, range, input.goal.replace(/\s+/g, " ").trim());
        }

        const body = lines.join("\n");

        return trailingNewline ? `${body}\n` : body;
      },
    });
  }

  if (touchesProjectFile(input)) {
    response.project = await editFile({
      relativePath: projectFile(slug, "PROJECT.md"),
      expectedRevision: input.expectedRevisions?.project,
      label: "project.configure",
      apply: (current) => {
        if (current === undefined) {
          throw new NotFoundError(`${slug} has no PROJECT.md.`);
        }

        let next = current;

        if (input.repoPath !== undefined) {
          next = applyRepositoryPath(next, input.repoPath);
        }

        if (input.configuration) {
          next = applyConfiguration(
            next,
            mergeConfiguration(parseConfiguration(next), input.configuration),
          );
        }

        return next;
      },
    });
  }

  return response;
}

/**
 * Puts a project away.
 *
 * A state change, never a deletion and never a move. Worker jobs, usage
 * records, designs, decisions, sessions and the activity timeline all reference
 * the slug — removing the directory would leave every one of those pointing at
 * nothing, and moving it would break the paths without even the courtesy of an
 * error.
 */
export async function archiveProject(
  slug: string,
  expectedRevision?: string,
): Promise<EditResult> {
  const result = await patchProject({ slug, state: "archived", expectedRevision });

  return result.portfolio ?? { revision: "" };
}

/** Brings one back, to whatever state the operator says it is now in. */
export async function restoreProject(
  slug: string,
  state: ProjectState = "incubating",
  expectedRevision?: string,
): Promise<EditResult> {
  if (state === "archived") {
    throw new InvalidRequestError("Restoring to archived is not a restore.");
  }

  const result = await patchProject({ slug, state, expectedRevision });

  return result.portfolio ?? { revision: "" };
}

/** The portfolio, with the revision an edit to it must be composed against. */
export async function readPortfolioForEdit(): Promise<{
  revision: string;
  contents?: string;
}> {
  const { data, revision } = await readForEdit(PORTFOLIO);

  return { revision, contents: data };
}
