import type { DocumentProposal } from "../../shared/agentos-types";
import { ArtifactTypeSchema } from "../../shared/agentos-types";
import { toFilename } from "../agentos/mutations/documents";
import { HermesError, sendToHermes } from "./client";
import { PlanningUnavailableError } from "./project-planning";
import { extractJson } from "./worker-review";

/**
 * Hermes writing a project document — as a proposal.
 *
 * "Research the options for X and save it as a project document" is a
 * reasonable thing to ask, and the answer is worth keeping. But the vault is
 * the operator's, so the document comes back as a draft with a title, a type
 * and a target path, and is written only when the operator saves it. Same
 * rule as every other agent write: propose, then a person decides.
 */

const DOCUMENT_SKILL = "/write-document";

const MAX_DOCUMENT_CHARS = 4_000;
const MAX_CONTENT_CHARS = 60_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function clip(document: string | undefined, label: string): string | undefined {
  const trimmed = document?.trim();
  if (!trimmed) return undefined;
  const body = trimmed.length > MAX_DOCUMENT_CHARS ? `${trimmed.slice(0, MAX_DOCUMENT_CHARS)}\n…(truncated)` : trimmed;
  return `--- ${label} ---\n${body}`;
}

export interface DocumentProposalInput {
  project: string;
  brief: string;
  taskId?: string;
  taskTitle?: string;
  projectMarkdown?: string;
  statusMarkdown?: string;
  decisionsMarkdown?: string;
  /** Titles of documents that already exist, so Hermes does not rewrite one. */
  existing?: readonly string[];
}

export function buildDocumentPacket(input: DocumentProposalInput): string {
  return [
    "WRITE ONE PROJECT DOCUMENT",
    "",
    "Write the document described in the brief, for the project below. It will",
    "be kept in the project's files and read by people and by later agents, so",
    "make it complete, specific and honest about uncertainty. Markdown only:",
    "headings, lists, tables and code blocks. No front matter; AgentOS adds it.",
    "",
    `PROJECT: ${input.project}`,
    input.taskId ? `TASK: ${input.taskId}${input.taskTitle ? `: ${input.taskTitle}` : ""}` : undefined,
    "",
    "--- BRIEF ---",
    input.brief.trim(),
    "",
    clip(input.projectMarkdown, "PROJECT.md"),
    clip(input.statusMarkdown, "STATUS.md"),
    clip(input.decisionsMarkdown, "DECISIONS.md"),
    input.existing && input.existing.length > 0
      ? `--- EXISTING DOCUMENTS ---\n${input.existing.map((title) => `- ${title}`).join("\n")}`
      : undefined,
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "title": "a short document title",',
    '  "type": "plan" | "research" | "spec" | "design" | "review" | "report" | "notes",',
    '  "content": "the full Markdown document"',
    "}",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function readDocumentProposal(text: string, taskId?: string): DocumentProposal | undefined {
  const payload = asRecord(extractJson(text));
  if (!payload) return undefined;

  const title = asString(payload.title)?.slice(0, 160);
  const content = asString(payload.content);
  if (!title || !content) return undefined;

  const type = ArtifactTypeSchema.safeParse(asString(payload.type)?.toLowerCase());

  return {
    title,
    type: type.success ? type.data : "notes",
    filename: toFilename(title),
    taskId,
    content: content.slice(0, MAX_CONTENT_CHARS),
    plannedBy: "hermes",
  };
}

export async function proposeDocument(input: DocumentProposalInput): Promise<DocumentProposal> {
  let reply: string;

  try {
    reply = await sendToHermes(`${DOCUMENT_SKILL}\n\n${buildDocumentPacket(input)}`, {
      operation: "planning",
      project: input.project,
      taskId: input.taskId,
    });
  } catch (error) {
    throw new PlanningUnavailableError(
      error instanceof HermesError ? error.message : "Hermes could not be reached.",
    );
  }

  const proposal = readDocumentProposal(reply, input.taskId);

  if (!proposal) {
    throw new PlanningUnavailableError("Hermes answered, but not with a document AgentOS could read.");
  }

  return proposal;
}
