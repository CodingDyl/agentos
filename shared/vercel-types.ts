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

/** Whether a site will draw inside an AgentOS frame, read from its own response headers. */
export const SiteEmbedSchema = z.object({
  allowed: z.boolean(),
  /** Why not, in the operator's terms — e.g. the site sends `X-Frame-Options: DENY`. */
  reason: z.string().optional(),
});

/**
 * Everything a workspace's Site tab needs in one read: the production URL to
 * frame, the deployment behind it, and whether framing will work at all.
 *
 * Expected states — nothing linked, no token, a rejected token — come back as
 * a `status` rather than an HTTP error, so the tab can say which one it is
 * and offer the matching fix.
 */
export const ProjectSiteSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unlinked") }),
  z.object({ status: z.literal("not-configured"), message: z.string() }),
  z.object({
    status: z.literal("unavailable"),
    projectName: z.string(),
    /** `unauthorized` means the token was rejected; anything else is Vercel or the network. */
    reason: z.string(),
    message: z.string(),
  }),
  z.object({
    status: z.literal("linked"),
    projectId: z.string(),
    projectName: z.string(),
    /** The address framed and shown: the shortest verified domain, else the production deployment's own URL. */
    url: z.string().optional(),
    urlSource: z.enum(["domain", "deployment"]).optional(),
    domains: z.array(VercelDomainSchema),
    /** The newest production deployment, whatever its state. */
    production: VercelDeploymentSchema.optional(),
    /** The newest production deployment that is serving — what the URL actually shows. */
    serving: VercelDeploymentSchema.optional(),
    embed: SiteEmbedSchema.optional(),
    checkedAt: z.string(),
  }),
]);

export type SiteEmbed = z.infer<typeof SiteEmbedSchema>;
export type ProjectSite = z.infer<typeof ProjectSiteSchema>;
export type LinkedProjectSite = Extract<ProjectSite, { status: "linked" }>;
