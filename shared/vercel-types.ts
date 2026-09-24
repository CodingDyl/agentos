import { z } from "zod";

/**
 * Vercel, read-only.
 *
 * AgentOS never deploys, never changes a domain, never deletes a project —
 * every call this feature makes is a `GET`. A personal access token carries
 * the same permissions as the account it belongs to, so the read-only
 * guarantee is enforced here, in the server code, not by the token itself.
 */

export const VercelProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  framework: z.string().optional(),
});

export const VercelDomainSchema = z.object({
  name: z.string(),
  verified: z.boolean(),
});

export const VercelDeploymentSchema = z.object({
  id: z.string(),
  url: z.string(),
  /** Vercel's own state, e.g. `READY`, `ERROR`, `BUILDING`. */
  state: z.string().optional(),
  target: z.string().optional(),
  createdAt: z.string(),
});

/** What a project's Settings sheet offers in the "connect a Vercel project" picker. */
export const VercelProjectsResponseSchema = z.object({
  projects: z.array(VercelProjectSummarySchema),
});

/**
 * What a linked project resolves to: the site AgentOS actually crawls for
 * SEO, plus the domains and recent deployments shown alongside it.
 */
export const ProjectVercelInfoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  /** The domain SEO audits target — the shortest verified one, or undefined if none verified yet. */
  liveUrl: z.string().optional(),
  domains: z.array(VercelDomainSchema),
  deployments: z.array(VercelDeploymentSchema),
});

export type VercelProjectSummary = z.infer<typeof VercelProjectSummarySchema>;
export type VercelDomain = z.infer<typeof VercelDomainSchema>;
export type VercelDeployment = z.infer<typeof VercelDeploymentSchema>;
export type VercelProjectsResponse = z.infer<typeof VercelProjectsResponseSchema>;
export type ProjectVercelInfo = z.infer<typeof ProjectVercelInfoSchema>;
