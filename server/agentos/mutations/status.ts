import { readSection, setSection } from "./prose-document";
import { assertSlug, InvalidRequestError } from "./tasks";
import { editFile, projectFile, readForEdit, type EditResult } from "./writer";

/**
 * The prose an operator edits in place: status, and a project's purpose.
 *
 * These are the `[ EDIT ]` affordances on the overview — a heading, a
 * paragraph, and a pencil. No dialog, no approval, no model. The whole point of
 * 53.1's rule change is that a person editing their own notes should not have
 * to ask an agent for permission, and the shortest possible path from "this
 * sentence is out of date" to "it is not any more" is the feature.
 */

const STATUS_FILE = "STATUS.md";
const PROJECT_FILE = "PROJECT.md";

/**
 * The headings each field is written under, in preference order.
 *
 * A list rather than a constant because the vault is hand-written and not
 * uniform: one project calls it `Current Stage`, another `Status`. The first
 * that exists is edited; when none does, the first is created.
 */
const STATUS_HEADINGS = ["Current Stage", "Status", "Summary"] as const;
const PURPOSE_HEADINGS = ["Purpose", "Goal", "Overview"] as const;
const MILESTONE_HEADINGS = ["Next Milestone", "Milestone", "Next Up"] as const;

export type ProseField = "status" | "purpose" | "milestone";

export const PROSE_FIELDS: readonly ProseField[] = ["status", "purpose", "milestone"];

/** Which file each field lives in, and the headings it may be written under. */
const FIELDS: Record<
  ProseField,
  { file: string; headings: readonly string[]; label: string; fallback: string }
> = {
  status: { file: STATUS_FILE, headings: STATUS_HEADINGS, label: "status.update", fallback: "# Status\n" },
  purpose: { file: PROJECT_FILE, headings: PURPOSE_HEADINGS, label: "purpose.update", fallback: "# Project\n" },
  milestone: {
    file: STATUS_FILE,
    headings: MILESTONE_HEADINGS,
    label: "milestone.update",
    fallback: "# Status\n",
  },
};

export function isProseField(value: string): value is ProseField {
  return (PROSE_FIELDS as readonly string[]).includes(value);
}

function firstPresent(
  markdown: string,
  headings: readonly string[],
): string | undefined {
  return headings.find((heading) => readSection(markdown, heading) !== undefined);
}

function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n/g, "\n").trim();

  if (body.length === 0) throw new InvalidRequestError("That field cannot be empty.");

  return body.slice(0, 20_000);
}

export interface EditProseInput {
  slug: string;
  body: string;
  expectedRevision?: string;
}

export interface ProseRead {
  revision: string;
  heading: string;
  body?: string;
}

export async function readProse(slug: string, field: ProseField): Promise<ProseRead> {
  assertSlug(slug);

  const spec = FIELDS[field];
  const { data, revision } = await readForEdit(projectFile(slug, spec.file));
  const markdown = data ?? "";
  const heading = firstPresent(markdown, spec.headings) ?? spec.headings[0];

  return { revision, heading, body: readSection(markdown, heading) };
}

export async function writeProse(field: ProseField, input: EditProseInput): Promise<EditResult> {
  const slug = assertSlug(input.slug);
  const body = cleanBody(input.body);
  const spec = FIELDS[field];

  return editFile({
    relativePath: projectFile(slug, spec.file),
    expectedRevision: input.expectedRevision,
    label: spec.label,
    apply: (current) => {
      const markdown = current ?? spec.fallback;
      const heading = firstPresent(markdown, spec.headings) ?? spec.headings[0];

      return setSection(markdown, heading, body);
    },
  });
}

export const readStatus = (slug: string) => readProse(slug, "status");
export const writeStatus = (input: EditProseInput) => writeProse("status", input);
export const readPurpose = (slug: string) => readProse(slug, "purpose");
export const writePurpose = (input: EditProseInput) => writeProse("purpose", input);
export const readMilestone = (slug: string) => readProse(slug, "milestone");

/** The raw markdown behind a project file, for `⋯ → View source`. */
export async function readProjectSource(
  slug: string,
  file: string,
): Promise<{ revision: string; contents?: string } | undefined> {
  assertSlug(slug);

  const allowed = ["PROJECT.md", "STATUS.md", "TASKS.md", "DECISIONS.md"];

  // A closed list, not a sanitised path. The console never names a file this
  // layer has not already agreed to show.
  if (!allowed.includes(file)) return undefined;

  const { data, revision } = await readForEdit(projectFile(slug, file));

  return { revision, contents: data };
}
