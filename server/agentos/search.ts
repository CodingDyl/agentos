import type {
  SearchGroup,
  SearchHit,
  SearchHitKind,
  SearchResponse,
} from "../../shared/agentos-types";
import { getLibrary } from "../designs/library";
import { listSessions } from "../hermes/sessions";
import { listJobs } from "../workers/job-store";
import { readDecisions } from "./mutations/decisions";
import { readMilestones } from "./mutations/milestones";
import { listVaultDocuments, safeMatter } from "./documents";
import { readOptionalFile } from "./filesystem";
import { readTasks } from "./mutations/tasks";
import { getProjects } from "./projects";

/**
 * Global search: one query, every kind of thing AgentOS knows about.
 *
 * Deliberately no index. The whole corpus — a handful of projects, a few
 * hundred tasks, some decisions, boards, jobs and sessions — fits in memory
 * many times over, and it is read from the same readers the screens use, so a
 * result is never stale relative to what the operator would see by navigating
 * there. When the vault is large enough for this to be slow, that is the
 * moment to add an index, and not before.
 *
 * Ranking is simple and legible: a title that *starts with* the query beats
 * one that *contains* it, which beats a match only in the detail line. Ties
 * keep source order, which for jobs and sessions is newest first.
 */

const GROUP_ORDER: readonly SearchHitKind[] = [
  "project",
  "milestone",
  "task",
  "decision",
  "document",
  "design",
  "job",
  "session",
];

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 25;
const MIN_QUERY = 2;

/** How much of a document body is searched and shown. */
const DOCUMENT_BODY_CHARS = 6_000;

interface Scored {
  hit: SearchHit;
  score: number;
}

/** 0 for a title prefix, 1 for a title substring, 2 for detail-only, undefined for none. */
function scoreHit(hit: SearchHit, needle: string): number | undefined {
  const title = hit.title.toLowerCase();
  if (title.startsWith(needle)) return 0;
  if (title.includes(needle)) return 1;
  if (hit.id.toLowerCase().includes(needle)) return 1;
  if (hit.detail?.toLowerCase().includes(needle)) return 2;
  return undefined;
}

function rank(hits: SearchHit[], needle: string, limit: number): { hits: SearchHit[]; cut: boolean } {
  const scored = hits
    .flatMap((hit) => {
      const score = scoreHit(hit, needle);
      return score === undefined ? [] : [{ hit, score } satisfies Scored];
    })
    .sort((a, b) => a.score - b.score);

  return { hits: scored.slice(0, limit).map((entry) => entry.hit), cut: scored.length > limit };
}

function humanStatus(status: string): string {
  return status.replace(/_/g, " ");
}

/** Every searchable thing, gathered without failing the whole search if one source is down. */
async function gather(): Promise<Record<SearchHitKind, SearchHit[]>> {
  const projects = await getProjects("all").catch(() => []);

  const projectHits: SearchHit[] = projects.map((project) => ({
    kind: "project",
    id: project.slug,
    title: project.name,
    detail: [project.type, project.state].filter(Boolean).join(" · "),
    project: project.slug,
    href: `/workspaces/${project.slug}`,
  }));

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const [tasks, decisions, milestones, documents] = await Promise.all([
        readTasks(project.slug).catch(() => ({ tasks: [] })),
        readDecisions(project.slug).catch(() => ({ decisions: [] })),
        readMilestones(project.slug).catch(() => ({ milestones: [] })),
        listVaultDocuments(project.slug).catch(() => []),
      ]);

      // Document *content* is searchable, not only titles: "MealDB fallback"
      // should find the research that discussed it. The body is read here
      // and clipped into the detail, where the ranker looks.
      const documentHits: SearchHit[] = await Promise.all(
        documents.map(async (document): Promise<SearchHit> => {
          const raw = await readOptionalFile(document.relativePath).catch(() => undefined);
          const body = raw ? safeMatter(raw).content : "";

          return {
            kind: "document",
            id: `${project.slug}:${document.id}`,
            title: document.title,
            detail: [project.name, document.type, document.taskId, document.source, body.replace(/\s+/g, " ").slice(0, DOCUMENT_BODY_CHARS)]
              .filter(Boolean)
              .join(" · "),
            project: project.slug,
            href: `/workspaces/${project.slug}?tab=documents&doc=${encodeURIComponent(document.relativePath)}`,
          };
        }),
      );

      const milestoneHits: SearchHit[] = milestones.milestones.map((milestone) => ({
        kind: "milestone",
        id: `${project.slug}:${milestone.id}`,
        title: milestone.title,
        detail: [project.name, milestone.status, milestone.outcome?.slice(0, 100)].filter(Boolean).join(" · "),
        project: project.slug,
        href: `/workspaces/${project.slug}?tab=roadmap&milestone=${encodeURIComponent(milestone.id)}`,
      }));

      const taskHits: SearchHit[] = tasks.tasks
        .filter((task) => task.id !== undefined)
        .map((task) => ({
          kind: "task",
          id: task.id as string,
          title: `${task.id} ${task.title}`,
          detail: `${project.name} · ${task.section ?? "unfiled"}${task.completed ? " · done" : ""}`,
          project: project.slug,
          href: `/workspaces/${project.slug}?tab=tasks&task=${encodeURIComponent(task.id as string)}`,
        }));

      const decisionHits: SearchHit[] = decisions.decisions.map((decision) => ({
        kind: "decision",
        id: `${project.slug}:${decision.title}`,
        title: decision.title,
        detail: `${project.name}${decision.body ? ` · ${decision.body.slice(0, 120)}` : ""}`,
        project: project.slug,
        href: `/workspaces/${project.slug}?tab=decisions`,
      }));

      return { taskHits, decisionHits, milestoneHits, documentHits };
    }),
  );

  const library = await getLibrary().catch(() => ({ assets: [], boards: [] }));

  const designHits: SearchHit[] = [
    ...library.boards.map(
      (board): SearchHit => ({
        kind: "design",
        id: board.id,
        title: board.name,
        detail: ["Board", board.project, board.description].filter(Boolean).join(" · "),
        project: board.project,
        href: `/designs/boards/${board.id}`,
      }),
    ),
    ...library.assets.map(
      (asset): SearchHit => ({
        kind: "design",
        id: asset.id,
        title: asset.filename,
        detail: ["Asset", asset.project, ...asset.tags].filter(Boolean).join(" · "),
        project: asset.project,
        href: asset.project
          ? `/designs?project=${encodeURIComponent(asset.project)}`
          : "/designs",
      }),
    ),
  ];

  const jobs = await listJobs(200).catch(() => []);

  const jobHits: SearchHit[] = jobs.map((job) => ({
    kind: "job",
    id: job.id,
    title: job.objective,
    detail: `${job.project} · ${humanStatus(job.status)}${job.resolvedWorker ? ` · ${job.resolvedWorker}` : ""}`,
    project: job.project,
    href: `/workers/jobs/${job.id}`,
  }));

  const sessions = await listSessions(100).catch(() => []);

  const sessionHits: SearchHit[] = sessions.map((session) => ({
    kind: "session",
    id: session.id,
    title: session.title ?? "Untitled session",
    detail: [session.project, session.messageCount !== undefined ? `${session.messageCount} messages` : undefined]
      .filter(Boolean)
      .join(" · "),
    project: session.project,
    // The console opens on the project's lane; it has no per-session route yet.
    href: session.project ? `/agent?project=${encodeURIComponent(session.project)}` : "/agent",
  }));

  return {
    project: projectHits,
    milestone: perProject.flatMap((entry) => entry.milestoneHits),
    task: perProject.flatMap((entry) => entry.taskHits),
    decision: perProject.flatMap((entry) => entry.decisionHits),
    document: perProject.flatMap((entry) => entry.documentHits),
    design: designHits,
    job: jobHits,
    session: sessionHits,
  };
}

/** Pure ranking over an already-gathered corpus. Exported so it can be tested without a vault. */
export function searchCorpus(
  corpus: Record<SearchHitKind, SearchHit[]>,
  query: string,
  limit = DEFAULT_LIMIT,
): SearchResponse {
  const needle = query.trim().toLowerCase();
  const perGroup = Math.min(Math.max(limit, 1), MAX_LIMIT);

  if (needle.length < MIN_QUERY) {
    return { query: query.trim(), groups: [], truncated: false };
  }

  let truncated = false;
  const groups: SearchGroup[] = [];

  for (const kind of GROUP_ORDER) {
    const { hits, cut } = rank(corpus[kind], needle, perGroup);
    if (cut) truncated = true;
    if (hits.length > 0) groups.push({ kind, hits });
  }

  return { query: query.trim(), groups, truncated };
}

export async function search(query: string, limit = DEFAULT_LIMIT): Promise<SearchResponse> {
  if (query.trim().length < MIN_QUERY) {
    return { query: query.trim(), groups: [], truncated: false };
  }

  return searchCorpus(await gather(), query, limit);
}
