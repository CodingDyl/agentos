import type { AgentFailureReason } from "../../shared/agentos-types";
import type { ProjectVercelInfo, VercelDeployment, VercelDomain, VercelProjectSummary } from "../../shared/vercel-types";
import { authorize } from "../connectors/policy";

/**
 * Vercel, read-only.
 *
 * Every function here issues a `GET` and nothing else — Vercel's API also
 * exposes deploy, domain-move and delete endpoints, and none of them are
 * called from this file. A personal access token carries the same
 * permissions as the account it was created under, so this file is the
 * actual read-only boundary, not the token.
 */

const API_BASE = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 15_000;

export class VercelError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "VercelError";
  }
}

export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN?.trim());
}

function requireToken(): string {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  if (!token) {
    throw new VercelError("VERCEL_API_TOKEN is not set. Copy .env.example to .env and add it.", "not-configured");
  }
  return token;
}

/** Every call is scoped to a team when one is configured — omitted, it reads the token's personal account. */
function withTeam(path: string): string {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!teamId) return path;

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}teamId=${encodeURIComponent(teamId)}`;
}

type VercelRead = "vercel.read_projects" | "vercel.read_deployments";

async function vercelGet<T>(path: string, capability: VercelRead): Promise<T> {
  const token = requireToken();
  const decision = authorize(capability, { initiator: "system" });
  if (!decision.allowed) throw new VercelError(decision.reason, "not-configured");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${withTeam(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new VercelError(`Vercel did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`, "timed-out");
    }
    throw new VercelError("Could not reach Vercel.", "offline");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new VercelError("Vercel rejected the API token.", "unauthorized");
    }
    if (response.status === 404) {
      throw new VercelError("Vercel found no such project.", "failed");
    }
    throw new VercelError(`Vercel responded with ${response.status}.`, "failed");
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new VercelError("Vercel returned an unreadable response.", "failed");
  }
}

/** The account the token belongs to, by its public username. The Connectors page's connection test. */
export async function readVercelUser(): Promise<string> {
  const data = await vercelGet<{ user?: { username?: string; email?: string } }>("/v2/user", "vercel.read_projects");
  return data.user?.username ?? "the token's account";
}

interface VercelProjectsListResponse {
  projects: { id: string; name: string; framework?: string | null }[];
}

/** Every project the token can see, for the "connect a Vercel project" picker. */
export async function listVercelProjects(): Promise<VercelProjectSummary[]> {
  const data = await vercelGet<VercelProjectsListResponse>("/v10/projects?limit=100", "vercel.read_projects");

  return data.projects.map((project) => ({
    id: project.id,
    name: project.name,
    framework: project.framework ?? undefined,
  }));
}

interface VercelDomainsResponse {
  domains: { name: string; verified: boolean }[];
}

export async function getVercelProjectDomains(projectId: string): Promise<VercelDomain[]> {
  const data = await vercelGet<VercelDomainsResponse>(`/v9/projects/${encodeURIComponent(projectId)}/domains`, "vercel.read_deployments");
  return data.domains.map((domain) => ({ name: domain.name, verified: domain.verified }));
}

interface VercelDeploymentsResponse {
  deployments: { uid: string; url: string; state?: string; target?: string | null; createdAt: number }[];
}

export async function getVercelDeployments(projectId: string, limit = 5): Promise<VercelDeployment[]> {
  const data = await vercelGet<VercelDeploymentsResponse>(
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`,
    "vercel.read_deployments",
  );

  return data.deployments.map((deployment) => ({
    id: deployment.uid,
    url: deployment.url,
    state: deployment.state,
    target: deployment.target ?? undefined,
    createdAt: new Date(deployment.createdAt).toISOString(),
  }));
}

/** The shortest verified domain, which is almost always the production one a person would visit. */
export function primaryDomain(domains: readonly VercelDomain[]): string | undefined {
  const verified = domains.filter((domain) => domain.verified);
  if (verified.length === 0) return undefined;

  return [...verified].sort((a, b) => a.name.length - b.name.length)[0].name;
}

/** Everything a linked project's tabs need: its live URL, domains, and recent deployments. */
export async function getProjectVercelInfo(
  projectId: string,
  projectName: string,
): Promise<ProjectVercelInfo> {
  const [domains, deployments] = await Promise.all([
    getVercelProjectDomains(projectId),
    getVercelDeployments(projectId),
  ]);

  const domain = primaryDomain(domains);

  return {
    projectId,
    projectName,
    liveUrl: domain ? `https://${domain}` : undefined,
    domains,
    deployments,
  };
}
