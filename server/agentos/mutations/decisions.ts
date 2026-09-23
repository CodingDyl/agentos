import { readOptionalFile } from "../filesystem";
import {
  isPlaceholder,
  readSection,
  removeSection,
  sectionTitles,
  setSection,
} from "./prose-document";
import { assertSlug, InvalidRequestError, NotFoundError } from "./tasks";
import { editFile, projectFile, readForEdit, type EditResult } from "./writer";

/**
 * Decisions, written directly.
 *
 * A note on shape, because it differs from the obvious design: the vault does
 * **not** keep decisions as a dated log. It keeps them as topic sections —
 * `## Navigation`, `## AI Chef`, `## Engineering` — each holding the current
 * position on that topic, revised as thinking changes.
 *
 * That is a better structure for the thing it holds, and AgentOS adopts it
 * rather than imposing a reverse-chronological feed on top: a dated log answers
 * "what did I decide on the 5th", which nobody asks, while a topic section
 * answers "what did we settle about navigation", which is the question a
 * decision file exists for. The date is recorded as a field inside the section
 * so it is still visible without becoming the organising principle.
 */

const DECISIONS_FILE = "DECISIONS.md";

export interface Decision {
  title: string;
  body: string;
  decidedOn?: string;
}

/** A decision's date line, written the way the vault writes other fields. */
function withDate(body: string, decidedOn?: string): string {
  if (!decidedOn) return body.trim();

  return `Decided: ${decidedOn}\n\n${body.trim()}`;
}

export async function readDecisions(slug: string): Promise<{
  revision: string;
  decisions: Decision[];
}> {
  assertSlug(slug);

  const { data, revision } = await readForEdit(projectFile(slug, DECISIONS_FILE));
  const markdown = data ?? "";

  if (isPlaceholder(markdown)) return { revision, decisions: [] };

  const decisions = sectionTitles(markdown).map((title) => {
    const body = readSection(markdown, title) ?? "";
    const dated = /^Decided:\s*(.+)$/im.exec(body);

    return {
      title,
      body: body.replace(/^Decided:\s*.+$/im, "").trim(),
      decidedOn: dated?.[1]?.trim(),
    };
  });

  return { revision, decisions };
}

export interface WriteDecisionInput {
  slug: string;
  title: string;
  body: string;
  decidedOn?: string;
  expectedRevision?: string;
}

function cleanHeading(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "");

  if (title.length === 0) throw new InvalidRequestError("A decision needs a title.");

  return title.slice(0, 200);
}

/**
 * Records a decision, or revises one already recorded.
 *
 * The same call for both, because at the file's level they are the same
 * operation — a section either exists and is rewritten, or does not and is
 * appended. Splitting them would mean the console had to know which case it was
 * in before it could offer the form.
 */
export async function writeDecision(
  input: WriteDecisionInput,
): Promise<EditResult> {
  const slug = assertSlug(input.slug);
  const title = cleanHeading(input.title);

  if (input.body.trim().length === 0) {
    throw new InvalidRequestError("A decision needs a body.");
  }

  return editFile({
    relativePath: projectFile(slug, DECISIONS_FILE),
    expectedRevision: input.expectedRevision,
    label: "decision.write",
    apply: (current) => {
      // The placeholder sentence is replaced by the first real decision rather
      // than left above it insisting nothing has been decided.
      const base =
        current === undefined || isPlaceholder(current)
          ? `# Decisions\n`
          : current;

      return setSection(base, title, withDate(input.body, input.decidedOn));
    },
  });
}

export async function deleteDecision(input: {
  slug: string;
  title: string;
  expectedRevision?: string;
}): Promise<EditResult> {
  const slug = assertSlug(input.slug);
  const title = cleanHeading(input.title);

  const existing = await readOptionalFile(projectFile(slug, DECISIONS_FILE));

  if (!existing || readSection(existing, title) === undefined) {
    throw new NotFoundError(`${title} is not a recorded decision in ${slug}.`);
  }

  return editFile({
    relativePath: projectFile(slug, DECISIONS_FILE),
    expectedRevision: input.expectedRevision,
    label: "decision.delete",
    apply: (current) => removeSection(current ?? "", title),
  });
}
