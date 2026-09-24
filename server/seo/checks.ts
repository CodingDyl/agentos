import type { CrawledPage } from "./crawler";
import type { NewFinding } from "./store";

/**
 * The rubric itself — deliberately small and deliberately boring.
 *
 * Each check is something a person could verify by reading the page's source,
 * turned into a rule so it never gets skipped on a busy day. Thresholds
 * (title/description length, link sample size) come from long-standing SEO
 * convention, not from any one site's audit.
 */

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

function finding(
  category: NewFinding["category"],
  severity: NewFinding["severity"],
  title: string,
  description: string,
  pageUrl: string,
): NewFinding {
  return { category, severity, title, description, pageUrl };
}

export function checkTitleAndDescription(page: CrawledPage): NewFinding[] {
  const findings: NewFinding[] = [];

  if (!page.title) {
    findings.push(finding("on-page", "critical", "Missing title tag", "The page has no <title>. Search results fall back to the URL or an arbitrary heading.", page.url));
  } else if (page.title.length < TITLE_MIN || page.title.length > TITLE_MAX) {
    findings.push(
      finding(
        "on-page",
        "warning",
        "Title tag length is off",
        `"${page.title}" is ${page.title.length} characters. ${TITLE_MIN}-${TITLE_MAX} is the range search engines display without truncating.`,
        page.url,
      ),
    );
  }

  if (!page.metaDescription) {
    findings.push(finding("on-page", "warning", "Missing meta description", "No <meta name=\"description\">. Search engines will pull a snippet from the page body instead.", page.url));
  } else if (page.metaDescription.length < DESCRIPTION_MIN || page.metaDescription.length > DESCRIPTION_MAX) {
    findings.push(
      finding(
        "on-page",
        "info",
        "Meta description length is off",
        `${page.metaDescription.length} characters. ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} is the range that reliably avoids truncation.`,
        page.url,
      ),
    );
  }

  return findings;
}

export function checkHeadings(page: CrawledPage): NewFinding[] {
  const h1s = page.headings.filter((heading) => heading.level === 1);

  if (h1s.length === 0) {
    return [finding("on-page", "warning", "No H1 on the page", "Every page should have exactly one H1 stating what the page is about.", page.url)];
  }

  if (h1s.length > 1) {
    return [
      finding(
        "on-page",
        "info",
        `${h1s.length} H1 headings found`,
        "Multiple H1s dilute which one search engines treat as the page's main heading.",
        page.url,
      ),
    ];
  }

  return [];
}

export function checkImageAltText(page: CrawledPage): NewFinding[] {
  const missing = page.images.filter((image) => !image.alt && image.src);
  if (missing.length === 0) return [];

  return [
    finding(
      "on-page",
      "warning",
      `${missing.length} image${missing.length === 1 ? "" : "s"} missing alt text`,
      "Alt text is how search engines (and screen readers) understand an image. Missing on: " +
        missing
          .slice(0, 5)
          .map((image) => image.src)
          .join(", ") +
        (missing.length > 5 ? `, and ${missing.length - 5} more.` : "."),
      page.url,
    ),
  ];
}

export function checkMobileAndCanonical(page: CrawledPage): NewFinding[] {
  const findings: NewFinding[] = [];

  if (!page.metaViewport) {
    findings.push(finding("technical", "warning", "No viewport meta tag", "Without <meta name=\"viewport\">, mobile browsers render the page at desktop width and zoom out — a mobile-friendliness signal search engines check for.", page.url));
  }

  if (!page.canonical) {
    findings.push(finding("technical", "info", "No canonical tag", "A <link rel=\"canonical\"> tells search engines which URL is authoritative when a page is reachable more than one way.", page.url));
  }

  return findings;
}

export function checkStructuredData(page: CrawledPage): NewFinding[] {
  if (page.jsonLd.length === 0) {
    return [finding("schema", "info", "No structured data found", "No <script type=\"application/ld+json\"> on the page. Structured data helps search engines show rich results.", page.url)];
  }

  const invalid = page.jsonLd.filter((block) => {
    try {
      JSON.parse(block);
      return false;
    } catch {
      return true;
    }
  });

  if (invalid.length > 0) {
    return [
      finding(
        "schema",
        "warning",
        `${invalid.length} invalid structured data block${invalid.length === 1 ? "" : "s"}`,
        "A JSON-LD script tag on the page does not parse as JSON, so search engines will ignore it.",
        page.url,
      ),
    ];
  }

  return [];
}

export function checkWellKnownFiles(
  page: CrawledPage,
  reachable: { robotsTxt: boolean; sitemapXml: boolean },
): NewFinding[] {
  const findings: NewFinding[] = [];

  if (!reachable.robotsTxt) {
    findings.push(finding("technical", "warning", "robots.txt not found", `${page.origin}/robots.txt did not answer. Without it, crawlers assume everything is allowed, but can't be told about a sitemap.`, page.url));
  }

  if (!reachable.sitemapXml) {
    findings.push(finding("technical", "info", "sitemap.xml not found", `${page.origin}/sitemap.xml did not answer. A sitemap helps search engines discover every page, not just what they find by following links.`, page.url));
  }

  return findings;
}

export function checkBrokenLinks(page: CrawledPage, broken: readonly string[]): NewFinding[] {
  if (broken.length === 0) return [];

  return [
    finding(
      "links",
      "critical",
      `${broken.length} broken internal link${broken.length === 1 ? "" : "s"}`,
      "These same-origin links did not return a successful response: " + broken.join(", "),
      page.url,
    ),
  ];
}

/** Runs every check and flattens the result. Order here is the order findings are shown in. */
export function runAllChecks(
  page: CrawledPage,
  extra: { reachable: { robotsTxt: boolean; sitemapXml: boolean }; brokenLinks: readonly string[] },
): NewFinding[] {
  return [
    ...checkTitleAndDescription(page),
    ...checkHeadings(page),
    ...checkImageAltText(page),
    ...checkMobileAndCanonical(page),
    ...checkStructuredData(page),
    ...checkWellKnownFiles(page, extra.reachable),
    ...checkBrokenLinks(page, extra.brokenLinks),
  ];
}
