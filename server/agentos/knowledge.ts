import type { KnowledgeItem, KnowledgeResponse, ProjectArtifact, ProjectSummary } from "../../shared/agentos-types";
import { getProjectDocuments } from "./documents";
import { fileModifiedAt, readOptionalFile } from "./filesystem";
import { parseProjectDecisions } from "./projects";

/**
 * Knowledge: every document and decision across every workspace, in one list.
 *
 * Built from what already exists — the same listing the Documents tab uses and
 * the same parse the Decisions tab uses — and never copied. Each item carries
 * the route to where it is actually read, so there is still exactly one viewer
 * per file.
 *
 * Deliberately no index: a portfolio is a handful of workspaces and a few
 * hundred files, which is a directory walk, not a search engine.
 */

export function workspaceHref(slug: string, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `/workspaces/${encodeURIComponent(slug)}${query}`;
}

export function documentItem(document: ProjectArtifact, project: ProjectSummary): KnowledgeItem {
  const params: Record<string, string> = { tab: "documents", doc: document.relativePath };
  if (document.origin === "repo") params.origin = "repo";

  return {
    id: `${document.origin}:${project.slug}:${document.id}`,
    kind: "document",
    title: document.title,
    project: project.slug,
    projectName: project.name,
    workspaceType: project.workspaceType,
    type: document.type,
    source: document.source,
    origin: document.origin,
    taskId: document.taskId,
    updatedAt: document.updatedAt ?? document.createdAt,
    detail: document.origin === "repo" ? `Repository · ${document.relativePath}` : undefined,
    href: workspaceHref(project.slug, params),
  };
}

async function decisionItems(project: ProjectSummary): Promise<KnowledgeItem[]> {
  const path = `projects/${project.slug}/DECISIONS.md`;
  const [markdown, modified] = await Promise.all([readOptionalFile(path), fileModifiedAt(path).catch(() => undefined)]);
  if (!markdown) return [];

  return parseProjectDecisions(markdown).map((decision, index) => ({
    id: `decision:${project.slug}:${index}`,
    kind: "decision" as const,
    title: decision.title,
    project: project.slug,
    projectName: project.name,
    workspaceType: project.workspaceType,
    type: "decision" as const,
    updatedAt: modified?.toISOString(),
    detail: decision.detail,
    href: workspaceHref(project.slug, { tab: "decisions" }),
  }));
}

export async function getKnowledge(projects: readonly ProjectSummary[]): Promise<KnowledgeResponse> {
  const unavailable: KnowledgeResponse["unavailable"] = [];

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const [documents, decisions] = await Promise.all([
        getProjectDocuments(project.slug).catch(() => undefined),
        decisionItems(project).catch(() => []),
      ]);

      // "No repository linked" is a fact about the workspace, not a failure
      // worth reporting; a linked repository that cannot be read is.
      if (documents?.repoUnavailable && !/no local repository/i.test(documents.repoUnavailable)) {
        unavailable.push({ project: project.slug, reason: documents.repoUnavailable });
      }

      return [
        ...(documents?.agentos ?? []).map((document) => documentItem(document, project)),
        ...(documents?.repo ?? []).map((document) => documentItem(document, project)),
        ...decisions,
      ];
    }),
  );

  const items = perProject
    .flat()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.title.localeCompare(b.title));

  return { generatedAt: new Date().toISOString(), items, unavailable };
}
