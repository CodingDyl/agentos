import type { SeoAuditRun } from "../../shared/seo-types";
import { runAllChecks } from "./checks";
import { crawlPage, findBrokenLinks, urlReachable } from "./crawler";
import { recordAuditRun } from "./store";

/**
 * One audit: crawl the target, run every mechanical check, persist the run.
 *
 * Synchronous from the route's point of view, the same way Mail's sync is —
 * one page and a handful of `fetch` calls finishes in a few seconds, so this
 * does not need the worker-job system's async machinery.
 */
export async function runSeoAudit(projectSlug: string, targetUrl: string): Promise<SeoAuditRun> {
  const startedAt = new Date().toISOString();

  try {
    const page = await crawlPage(targetUrl);

    const [robotsTxt, sitemapXml, brokenLinks] = await Promise.all([
      urlReachable(`${page.origin}/robots.txt`),
      urlReachable(`${page.origin}/sitemap.xml`),
      findBrokenLinks(page.internalLinks),
    ]);

    const findings = runAllChecks(page, { reachable: { robotsTxt, sitemapXml }, brokenLinks });

    return recordAuditRun({
      projectSlug,
      targetUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "complete",
      findings,
    });
  } catch (error) {
    return recordAuditRun({
      projectSlug,
      targetUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: error instanceof Error ? error.message : "The audit could not be completed.",
      findings: [],
    });
  }
}
