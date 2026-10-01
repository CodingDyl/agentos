import { createHash } from "node:crypto";
import {
  PROPOSABLE_MEMORY_TYPES,
  type MemoryDecision,
  type MemoryOutcome,
  type MemoryProposal,
  type ProposableMemoryType,
} from "../../shared/task-closeout-types";
import { noteFileName } from "../../shared/memory-paths";
import type { MemoryDuplicateMatch } from "../../shared/memory-types";
import { readDecisions, writeDecision } from "../agentos/mutations/decisions";
import { RevisionConflictError } from "../agentos/mutations/revision";
import { CreateNoteError, createMemoryNote } from "./create-note";
import { findDuplicates } from "./duplicate-detection";
import { HUMAN, MemoryMutationError, updateMemoryFromProposal } from "./mutations";
import type { MemoryService } from "./service";

/**
 * Memory an agent proposes, and what a person does with it.
 *
 * A worker proposes memory the same way it names an artifact: one line per
 * item at the end of its closing summary, in a fixed shape AgentOS reads
 * without a model —
 *
 * ```text
 * Remember: pattern | Recipe fallback handling | When external lookup returns no suitable recipe, use the internal generation fallback.
 * Status update: Chef fallback is complete and validated. Next focus is performance and loading UX.
 * ```
 *
 * Nothing proposed is written. It is shown at closeout, where a person can
 * edit it, untick it or dismiss it; only what they save becomes memory. A
 * gate in front of that keeps out the noise memory is not for — routine
 * implementation detail and temporary debugging findings — so the closeout
 * screen is not a list of things to dismiss.
 */

/** Where saved notes go inside a project. Decisions go to DECISIONS.md instead. */
export const PROJECT_MEMORY_FOLDER = "memory";

const MAX_PROPOSALS = 6;

const REMEMBER = /^\s*(?:[-*]\s+)?Remember:\s*(.+)$/i;
const STATUS = /^\s*(?:[-*]\s+)?Status update:\s*(.+)$/i;
const ARTIFACT = /^\s*(?:[-*]\s+)?Artifact:\s*/i;

/** Type words as a worker might write them. */
const TYPE_ALIASES: Record<string, ProposableMemoryType> = {
  pattern: "pattern",
  lesson: "lesson",
  learning: "lesson",
  decision: "decision",
  constraint: "constraint",
  "business-rule": "business-rule",
  "business rule": "business-rule",
  rule: "business-rule",
  fact: "fact",
};

export interface RawProposal {
  type: ProposableMemoryType;
  title: string;
  body: string;
}

export interface ParsedCloseoutLines {
  proposals: RawProposal[];
  /** Lines that looked like proposals and were left out, and why. */
  rejected: Array<{ line: string; reason: string }>;
  statusUpdate?: string;
  /** The summary with the machine-read lines taken out. */
  summary: string;
}

/**
 * What is not durable memory. Deliberately narrow: a false positive drops a
 * proposal a person would have wanted, so only the clear cases are refused.
 */
const NOISE: ReadonlyArray<[RegExp, string]> = [
  [/\b(temporar(?:y|ily)|for now|for the time being)\b/i, "temporary"],
  [/\b(console\.log|print statement|debug (?:log|output|print)|added logging)\b/i, "debugging detail"],
  [/\b(typo|whitespace|formatting|lint(?:ing)? (?:error|warning|fix)|renamed (?:a |the )?variable|bumped (?:the )?version)\b/i, "routine implementation detail"],
  [/\b(this (?:run|session|commit)|in this (?:pr|change))\b/i, "about this run, not the project"],
];

/** Why a proposal is refused, or `undefined` when it may be shown. */
export function proposalNoise(proposal: RawProposal): string | undefined {
  if (proposal.title.length < 3) return "no title";
  if (proposal.title.length > 160) return "title too long";
  if (proposal.body.length < 20) return "too short to be worth remembering";
  if (proposal.body.length > 2000) return "too long — memory should be a note, not a report";
  const text = `${proposal.title} ${proposal.body}`;
  for (const [pattern, reason] of NOISE) if (pattern.test(text)) return reason;
  return undefined;
}

export function parseRememberLine(rest: string): RawProposal | { error: string } {
  const parts = rest.split("|").map((part) => part.trim());
  if (parts.length < 3) return { error: "expected `type | title | what to remember`" };
  const type = TYPE_ALIASES[parts[0].toLowerCase()];
  if (!type) return { error: `“${parts[0]}” is not a type that can be proposed` };
  return { type, title: parts[1].replace(/\s+/g, " "), body: parts.slice(2).join(" | ").trim() };
}

/** Reads `Remember:` and `Status update:` lines out of a worker's summary. */
export function parseCloseoutLines(summary: string): ParsedCloseoutLines {
  const proposals: RawProposal[] = [];
  const rejected: ParsedCloseoutLines["rejected"] = [];
  let statusUpdate: string | undefined;
  const kept: string[] = [];

  for (const line of summary.replace(/\r\n/g, "\n").split("\n")) {
    const remember = REMEMBER.exec(line);
    if (remember) {
      const parsed = parseRememberLine(remember[1]);
      if ("error" in parsed) {
        rejected.push({ line: line.trim(), reason: parsed.error });
        continue;
      }
      const noise = proposalNoise(parsed);
      if (noise) rejected.push({ line: line.trim(), reason: noise });
      else if (proposals.some((existing) => existing.title.toLowerCase() === parsed.title.toLowerCase())) {
        rejected.push({ line: line.trim(), reason: "proposed twice" });
      } else if (proposals.length >= MAX_PROPOSALS) rejected.push({ line: line.trim(), reason: `more than ${MAX_PROPOSALS} proposals` });
      else proposals.push(parsed);
      continue;
    }

    const status = STATUS.exec(line);
    if (status) {
      const text = status[1].trim();
      if (text.length >= 10) statusUpdate = statusUpdate ? `${statusUpdate} ${text}` : text;
      continue;
    }

    if (ARTIFACT.test(line)) continue;
    kept.push(line);
  }

  return { proposals, rejected, statusUpdate, summary: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** A stable id, so the same proposal reads the same across reloads of the closeout. */
export function proposalId(project: string, taskId: string, title: string): string {
  return `mp-${createHash("sha256").update(`${project}\u0000${taskId}\u0000${title.toLowerCase()}`).digest("hex").slice(0, 12)}`;
}

/** Ticked by default: the kinds that are reusable by nature. Lessons and facts are a person's call. */
const DEFAULT_SELECTED: ReadonlySet<ProposableMemoryType> = new Set(["pattern", "decision", "constraint", "business-rule"]);

export function toProposal(
  raw: RawProposal,
  context: { project: string; taskId: string; proposedBy: string; sourceRun?: string; sourceArtifact?: string },
): MemoryProposal {
  return {
    id: proposalId(context.project, context.taskId, raw.title),
    type: raw.type,
    title: raw.title,
    body: raw.body,
    project: context.project,
    sourceTask: context.taskId,
    sourceRun: context.sourceRun,
    sourceArtifact: context.sourceArtifact,
    proposedBy: context.proposedBy,
    selected: DEFAULT_SELECTED.has(raw.type),
  };
}

export function isProposableType(value: unknown): value is ProposableMemoryType {
  return typeof value === "string" && (PROPOSABLE_MEMORY_TYPES as readonly string[]).includes(value);
}

export class ProposalDuplicateError extends Error {
  constructor(readonly duplicates: MemoryDuplicateMatch[]) {
    super("This looks like memory that already exists.");
  }
}

/**
 * Checks a decision can be carried out, without writing anything. Run for
 * every decision before any is applied, so a closeout either writes what the
 * person chose or stops before writing anything.
 */
export async function precheckDecision(service: MemoryService, decision: MemoryDecision): Promise<MemoryDuplicateMatch[] | undefined> {
  if (decision.action !== "create" || decision.acknowledgedDuplicates) return undefined;
  const duplicates = await findDuplicates(service, decision.proposal.project, decision.proposal);
  return duplicates.length > 0 ? duplicates : undefined;
}

function decisionBody(proposal: MemoryProposal): string {
  const source = proposal.sourceTask ?? proposal.sourceUrl ?? proposal.sourceLearning;
  return source ? `${proposal.body.trim()}\n\nSource: ${source}${proposal.sourceRun ? ` (run ${proposal.sourceRun})` : ""}` : proposal.body.trim();
}

/** Carries out one person's choice about one proposal. Never throws; reports. */
export async function applyDecision(
  service: MemoryService,
  decision: MemoryDecision,
  approver = HUMAN,
): Promise<MemoryOutcome> {
  const { proposal } = decision;
  const base = { proposalId: proposal.id, title: proposal.title };

  try {
    if (decision.action === "dismiss") return { ...base, outcome: "dismissed" };

    if (!decision.acknowledgedDuplicates && decision.action === "create") {
      const duplicates = await findDuplicates(service, proposal.project, proposal);
      if (duplicates.length > 0) throw new ProposalDuplicateError(duplicates);
    }

    if (proposal.type === "decision") {
      // Durable decisions live in DECISIONS.md, as topic sections.
      if (decision.action === "create") {
        const { decisions } = await readDecisions(proposal.project);
        if (decisions.some((existing) => existing.title.toLowerCase() === proposal.title.trim().toLowerCase())) {
          return { ...base, outcome: "failed", error: "A decision with that title already exists. Choose “update existing” instead." };
        }
      }
      const title = decision.action === "update" ? decision.targetId ?? proposal.title : proposal.title;
      await writeDecision({
        slug: proposal.project,
        title,
        body: decisionBody(proposal),
        decidedOn: new Date().toISOString().slice(0, 10),
        expectedRevision: decision.action === "update" ? decision.targetRevision : undefined,
      });
      await service.reindex(new Set([`projects/${proposal.project}/DECISIONS.md`]));
      return { ...base, outcome: decision.action === "update" ? "updated" : "created", target: `DECISIONS.md § ${title}` };
    }

    if (decision.action === "update") {
      if (!decision.targetId || !decision.targetRevision) {
        return { ...base, outcome: "failed", error: "An update needs the note it updates." };
      }
      await updateMemoryFromProposal(
        service,
        {
          id: decision.targetId,
          expectedRevision: decision.targetRevision,
          title: proposal.title,
          body: proposal.body,
          type: proposal.type,
          sourceTask: proposal.sourceTask,
        },
        approver,
      );
      return { ...base, outcome: "updated", target: decision.targetId };
    }

    const folder = `projects/${proposal.project}/${PROJECT_MEMORY_FOLDER}`;
    const provenance = {
      createdBy: proposal.proposedBy,
      sourceProject: proposal.project,
      sourceTask: proposal.sourceTask,
      sourceRun: proposal.sourceRun,
      sourceArtifact: proposal.sourceArtifact,
      sourceLearning: proposal.sourceLearning,
      sourceUrl: proposal.sourceUrl,
      approvedBy: approver,
    };
    const request = { folder, title: proposal.title, body: proposal.body, tags: [proposal.type], type: proposal.type };

    try {
      const created = await createMemoryNote(service, request, provenance);
      return { ...base, outcome: "created", target: created.id };
    } catch (error) {
      // The person chose "create new" over a note with the very same name:
      // keep both, the new one named for the task it came from.
      const suffix = proposal.sourceTask ?? new Date().toISOString().slice(0, 10);
      if (error instanceof CreateNoteError && error.status === 409 && noteFileName(`${proposal.title} (${suffix})`)) {
        const created = await createMemoryNote(service, { ...request, title: `${proposal.title} (${suffix})` }, provenance);
        return { ...base, outcome: "created", target: created.id };
      }
      throw error;
    }
  } catch (error) {
    const message =
      error instanceof ProposalDuplicateError
        ? "Possible existing memory — choose to update it or create a new note."
        : error instanceof RevisionConflictError
          ? "The note changed since the closeout was opened. Reopen it and choose again."
          : error instanceof MemoryMutationError || error instanceof CreateNoteError
            ? error.message
            : "It could not be written to the vault.";
    if (!(error instanceof ProposalDuplicateError || error instanceof MemoryMutationError || error instanceof CreateNoteError || error instanceof RevisionConflictError)) {
      console.error("[memory] could not save a proposal:", error);
    }
    return { ...base, outcome: "failed", error: message };
  }
}
