import { z } from "zod";

/**
 * SEO findings, from a mechanical audit of a project's live site.
 *
 * Every finding here comes from deterministic checks against the rendered
 * page — title/meta tags, headings, alt text, canonical/robots/sitemap,
 * structured data, and same-origin links — never from an LLM's judgement.
 * That is a deliberate v1 boundary: content strategy and keyword work are a
 * person (or an agent, asked directly) reading the site with intent, not
 * something a crawler can decide on its own.
 */

export const SeoCategorySchema = z.enum(["technical", "on-page", "schema", "links"]);

export const SeoSeveritySchema = z.enum(["critical", "warning", "info"]);

export const SeoFindingSchema = z.object({
  id: z.string(),
  category: SeoCategorySchema,
  severity: SeoSeveritySchema,
  title: z.string(),
  description: z.string(),
  /** The page this finding is about. Always the audit's target in v1 (one page per audit). */
  pageUrl: z.string(),
  /** Set once a task has been filed for this finding, so it is not offered twice. */
  taskId: z.string().optional(),
});

export const SeoAuditRunSchema = z.object({
  id: z.string(),
  targetUrl: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["complete", "failed"]),
  error: z.string().optional(),
  findings: z.array(SeoFindingSchema),
});

/** The tab's whole read: the latest run in full, and prior runs as a compact history. */
export const ProjectSeoSchema = z.object({
  latest: SeoAuditRunSchema.optional(),
  history: z.array(
    SeoAuditRunSchema.omit({ findings: true }).extend({ findingCount: z.number().int().nonnegative() }),
  ),
});

export const RunSeoAuditRequestSchema = z.object({
  /** Overrides the project's linked Vercel domain, for a project not on Vercel yet. */
  targetUrl: z.string().url().optional(),
});

export type SeoCategory = z.infer<typeof SeoCategorySchema>;
export type SeoSeverity = z.infer<typeof SeoSeveritySchema>;
export type SeoFinding = z.infer<typeof SeoFindingSchema>;
export type SeoAuditRun = z.infer<typeof SeoAuditRunSchema>;
export type ProjectSeo = z.infer<typeof ProjectSeoSchema>;
export type RunSeoAuditRequest = z.infer<typeof RunSeoAuditRequestSchema>;
