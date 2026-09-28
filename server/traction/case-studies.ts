import type { ProjectSummary } from "../../shared/agentos-types";
import type {
  CaseStudy,
  CaseStudyOpportunity,
  Icp,
  Offer,
  QueueItem,
} from "../../shared/traction-types";
import { formatRand, type VirtecProject, type VirtecQuote, type VirtecSnapshot } from "../../shared/virtec-types";

/**
 * The case-study engine, as plain functions.
 *
 * A finished project is the cheapest evidence Virtara will ever have, and it
 * goes stale fast — the client's enthusiasm, the before-and-after, the
 * screenshots. So every finished project with no case study is raised as an
 * opportunity, once, until it is started or waved away.
 *
 * Nothing here calls Hermes. It decides *which* projects deserve a case study
 * and *what Hermes is told* about one; the call itself is in
 * `case-study-draft.ts`.
 */

function isFinished(project: VirtecProject): boolean {
  return project.status === "completed" || (project.completion ?? 0) >= 100;
}

/**
 * Whether a finished project has a story worth telling.
 *
 * A maintenance retainer "completes" every cycle but has no before-and-after:
 * it is ongoing care, not a build. Recognised by its type or its recurring
 * SKU, since Virtec records maintenance both ways.
 */
function isCaseStudyMaterial(project: VirtecProject): boolean {
  const type = (project.projectType ?? "").toLowerCase();
  if (type.includes("maintenance") || type.includes("retainer")) return false;
  if (project.maintenanceFrequency && !project.amount) return false;
  return true;
}

/**
 * Finished projects that have earned a case study and do not have one.
 *
 * Two places know a project is finished: Virtec (status completed, or 100%
 * complete) and the AgentOS portfolio (a workspace marked completed). A
 * Virtec project whose client is already a workspace's subject is still
 * listed on its own — they are different claims, and the person decides.
 */
export function buildOpportunities(
  snapshot: VirtecSnapshot | undefined,
  projects: readonly ProjectSummary[],
  studies: readonly CaseStudy[],
  dismissed: readonly string[],
): CaseStudyOpportunity[] {
  const taken = new Set([...studies.map((study) => study.source).filter(Boolean), ...dismissed]);
  const opportunities: CaseStudyOpportunity[] = [];

  // Biggest builds first: the most substantial work is the strongest evidence.
  const finished = (snapshot?.projects ?? [])
    .filter((project) => isFinished(project) && isCaseStudyMaterial(project))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  for (const project of finished) {
    const source = `virtec:project:${project.id}`;
    if (taken.has(source)) continue;
    opportunities.push({
      source,
      client: project.clientName ?? "Client",
      title: project.projectType ?? "Project",
      origin: "virtec",
      // No amount is shown rather than "R 0" — zero is almost always "not recorded".
      detail: [project.projectType, project.amount ? formatRand(project.amount) : undefined, "completed in Virtec"].filter(Boolean).join(" · "),
    });
  }

  for (const project of projects) {
    const source = `workspace:${project.slug}`;
    if (project.state !== "completed" || taken.has(source)) continue;
    opportunities.push({
      source,
      client: project.name,
      title: project.name,
      workspace: project.slug,
      origin: "workspace",
      detail: "Workspace marked completed",
    });
  }

  return opportunities;
}

/** Each opportunity as today's work. After warm referrals, before new outreach. */
/**
 * Each opportunity as a queue candidate. After warm referrals, before new
 * outreach — and only `CASE_STUDIES_PER_DAY` of them reach the queue (the
 * engine applies the cap after snoozes, so snoozing today's pick lets the
 * next one in). The rest wait in the Case studies tab: a backlog of write-ups
 * must not crowd out the outreach the queue exists for.
 */
export const CASE_STUDIES_PER_DAY = 1;

export function caseStudyQueueItems(opportunities: readonly CaseStudyOpportunity[]): (QueueItem & { rank: number })[] {
  const waiting = opportunities.length;
  return opportunities.map((opportunity) => ({
    id: `case_study:${opportunity.source}`,
    kind: "case_study",
    caseStudySource: opportunity.source,
    title: `Start a case study: ${opportunity.client}`,
    detail: [opportunity.detail, waiting > 1 ? `1 of ${waiting} finished projects without one; the rest are in Case studies` : "Easier to write while the project is fresh"],
    rank: 3.3,
  }));
}

const MAX_CONTEXT_CHARS = 4_000;

function clip(text: string | undefined, label: string): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return `--- ${label} ---\n${trimmed.length > MAX_CONTEXT_CHARS ? `${trimmed.slice(0, MAX_CONTEXT_CHARS)}\n…(truncated)` : trimmed}`;
}

export interface CaseStudyContext {
  study: CaseStudy;
  icp?: Icp;
  offers: readonly Offer[];
  virtecProject?: VirtecProject;
  virtecQuote?: VirtecQuote;
  projectMarkdown?: string;
  statusMarkdown?: string;
}

/**
 * What Hermes is told about one case study.
 *
 * Only facts AgentOS holds: the Virtec project and its quote's features, the
 * workspace's own PROJECT.md and STATUS.md, and whatever the person has
 * already written. Amounts are left out on purpose — a case study is public,
 * and what a client paid is theirs to share, not ours.
 */
export function buildDraftPacket(context: CaseStudyContext): string {
  const { study } = context;

  return [
    "DRAFT A CASE STUDY",
    "",
    "Write a short, specific case study for Virtara's website from the facts below.",
    "It is read by prospective clients deciding whether Virtara can solve their problem.",
    "",
    "Rules:",
    "- Use only the facts given. Never invent numbers, quotes, timelines or outcomes.",
    "- Any result that was not measured becomes `[NEEDS DATA: what would prove it]`, and is listed in `missing`.",
    "- Do not mention prices, fees or what the client paid.",
    "- Plain, confident English. No hype words (\"revolutionary\", \"seamless\", \"cutting-edge\").",
    "- Each section 2–5 sentences. Markdown allowed inside a section (short lists are fine).",
    "- Never write the testimonial. It must come from the client.",
    "",
    `CLIENT: ${study.client}`,
    `WORKING TITLE: ${study.title}`,
    context.icp ? `VIRTARA'S FOCUS: ${context.icp.name}, ${context.icp.offer}` : undefined,
    context.virtecProject
      ? [
          "--- PROJECT (from Virtec) ---",
          context.virtecProject.projectType ? `Type: ${context.virtecProject.projectType}` : undefined,
          context.virtecProject.serviceSku ? `Ongoing service: ${context.virtecProject.serviceSku}` : undefined,
          context.virtecProject.maintenanceFrequency ? `Maintenance: ${context.virtecProject.maintenanceFrequency}` : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      : undefined,
    context.virtecQuote && context.virtecQuote.features.length > 0
      ? `--- WHAT WAS DELIVERED (quote features) ---\n${context.virtecQuote.features.map((feature) => `- ${feature}`).join("\n")}`
      : undefined,
    clip(context.projectMarkdown, "PROJECT.md"),
    clip(context.statusMarkdown, "STATUS.md"),
    clip(
      [
        study.problem && `Problem: ${study.problem}`,
        study.solution && `Solution: ${study.solution}`,
        study.implementation && `Implementation: ${study.implementation}`,
        study.result && `Result: ${study.result}`,
        study.testimonial && `Client's words: ${study.testimonial}`,
      ]
        .filter(Boolean)
        .join("\n"),
      "ALREADY WRITTEN BY DYLAN (keep consistent with it)",
    ),
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "title": "a specific headline naming the outcome, not the technology",',
    '  "problem": "…",',
    '  "solution": "…",',
    '  "implementation": "…",',
    '  "result": "…",',
    '  "missing": ["each fact that would make this stronger and is not known yet"]',
    "}",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function asText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Hermes' reply, read defensively. Anything unexpected is dropped rather
 * than trusted; a reply with no sections at all is no draft.
 */
export function readDraft(payload: unknown):
  | (Partial<Pick<CaseStudy, "title" | "problem" | "solution" | "implementation" | "result">> & { missing: string[] })
  | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;

  const draft = {
    title: asText(record.title, 160),
    problem: asText(record.problem, 6000),
    solution: asText(record.solution, 6000),
    implementation: asText(record.implementation, 6000),
    result: asText(record.result, 6000),
    missing: Array.isArray(record.missing)
      ? record.missing.map((entry) => asText(entry, 300)).filter((entry): entry is string => Boolean(entry)).slice(0, 20)
      : [],
  };

  return draft.problem || draft.solution || draft.implementation || draft.result ? draft : undefined;
}
