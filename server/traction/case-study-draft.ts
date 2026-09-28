import type { CaseStudy } from "../../shared/traction-types";
import { readOptionalFile } from "../agentos/filesystem";
import { getProjects } from "../agentos/projects";
import { HermesError, sendToHermes } from "../hermes/client";
import { extractJson } from "../hermes/worker-review";
import { getVirtecSnapshot } from "../virtec/snapshot";
import { isVirtecConfigured } from "../virtec/client";
import { buildDraftPacket, readDraft } from "./case-studies";
import { applyCaseStudyDraft, readCaseStudy, readState } from "./store";

/** A draft asks a lot of one reply; give Hermes room. */
const DRAFT_TIMEOUT_MS = 120_000;

export class CaseStudyDraftError extends Error {}

/**
 * Asks Hermes to draft a case study, and folds the answer into empty sections.
 *
 * The one agent call in Traction that writes back into AgentOS, and only into
 * AgentOS's own store: sections a person already wrote are never replaced,
 * and the testimonial is never drafted at all. It runs only when asked.
 *
 * The workspace's files are read only for a slug the portfolio actually
 * lists — a case study's `workspace` field is never used as a path on trust.
 */
export async function draftCaseStudy(id: string): Promise<CaseStudy> {
  const study = await readCaseStudy(id);
  const state = await readState();

  const virtecId = study.source?.startsWith("virtec:project:") ? study.source.slice("virtec:project:".length) : undefined;
  const snapshot = virtecId && isVirtecConfigured() ? await getVirtecSnapshot().catch(() => undefined) : undefined;
  const virtecProject = snapshot?.projects.find((project) => project.id === virtecId);
  const virtecQuote = virtecProject ? snapshot?.quotes.find((quote) => quote.projectId === virtecProject.id) : undefined;

  const slug = study.workspace ?? (study.source?.startsWith("workspace:") ? study.source.slice("workspace:".length) : undefined);
  const known = slug ? (await getProjects()).some((project) => project.slug === slug) : false;
  const [projectMarkdown, statusMarkdown] = known
    ? await Promise.all([readOptionalFile(`projects/${slug}/PROJECT.md`), readOptionalFile(`projects/${slug}/STATUS.md`)])
    : [undefined, undefined];

  if (!virtecProject && !projectMarkdown && !study.problem && !study.solution) {
    throw new CaseStudyDraftError(
      "Not enough to draft from: link a workspace, start it from a Virtec project, or write the problem in a line or two first.",
    );
  }

  let reply: string;
  try {
    reply = await sendToHermes(
      buildDraftPacket({ study, icp: state.icp, offers: state.offers, virtecProject, virtecQuote, projectMarkdown, statusMarkdown }),
      { operation: "other", project: known ? slug : undefined, timeoutMs: DRAFT_TIMEOUT_MS },
    );
  } catch (error) {
    throw new CaseStudyDraftError(error instanceof HermesError ? error.message : "Hermes could not be reached.");
  }

  const draft = readDraft(extractJson(reply));
  if (!draft) throw new CaseStudyDraftError("Hermes answered, but not with a case study AgentOS could read.");

  return applyCaseStudyDraft(id, draft);
}
