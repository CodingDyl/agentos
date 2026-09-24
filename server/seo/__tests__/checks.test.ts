import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkBrokenLinks,
  checkHeadings,
  checkImageAltText,
  checkMobileAndCanonical,
  checkStructuredData,
  checkTitleAndDescription,
  checkWellKnownFiles,
  runAllChecks,
} from "../checks";
import type { CrawledPage } from "../crawler";

function page(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com/",
    origin: "https://example.com",
    title: "A Perfectly Reasonable Title",
    metaDescription: "A description that sits comfortably inside the recommended length for search engines to show in full.",
    metaViewport: "width=device-width, initial-scale=1",
    canonical: "https://example.com/",
    headings: [{ level: 1, text: "Welcome" }],
    images: [],
    jsonLd: ['{"@context":"https://schema.org","@type":"WebSite"}'],
    internalLinks: [],
    ...overrides,
  };
}

describe("checkTitleAndDescription", () => {
  it("flags a missing title as critical", () => {
    const findings = checkTitleAndDescription(page({ title: undefined }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "critical");
  });

  it("flags a title outside the recommended length as a warning", () => {
    const findings = checkTitleAndDescription(page({ title: "Hi" }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
  });

  it("says nothing about a well-formed title and description", () => {
    assert.deepEqual(checkTitleAndDescription(page()), []);
  });

  it("flags a missing meta description as a warning", () => {
    const findings = checkTitleAndDescription(page({ metaDescription: undefined }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
  });
});

describe("checkHeadings", () => {
  it("flags no H1", () => {
    const findings = checkHeadings(page({ headings: [{ level: 2, text: "Sub" }] }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
  });

  it("flags more than one H1", () => {
    const findings = checkHeadings(
      page({ headings: [{ level: 1, text: "A" }, { level: 1, text: "B" }] }),
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");
  });

  it("says nothing about exactly one H1", () => {
    assert.deepEqual(checkHeadings(page()), []);
  });
});

describe("checkImageAltText", () => {
  it("flags images missing alt text, naming them", () => {
    const findings = checkImageAltText(
      page({ images: [{ src: "/a.png", alt: undefined }, { src: "/b.png", alt: "A cat" }] }),
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0].description, /a\.png/);
    assert.doesNotMatch(findings[0].description, /b\.png/);
  });

  it("says nothing when every image has alt text", () => {
    assert.deepEqual(checkImageAltText(page({ images: [{ src: "/a.png", alt: "A cat" }] })), []);
  });
});

describe("checkMobileAndCanonical", () => {
  it("flags a missing viewport tag and a missing canonical", () => {
    const findings = checkMobileAndCanonical(page({ metaViewport: undefined, canonical: undefined }));
    assert.equal(findings.length, 2);
  });
});

describe("checkStructuredData", () => {
  it("flags no structured data as info", () => {
    const findings = checkStructuredData(page({ jsonLd: [] }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");
  });

  it("flags unparseable structured data as a warning", () => {
    const findings = checkStructuredData(page({ jsonLd: ["{not json"] }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
  });
});

describe("checkWellKnownFiles", () => {
  it("flags a missing robots.txt and sitemap.xml separately", () => {
    const findings = checkWellKnownFiles(page(), { robotsTxt: false, sitemapXml: false });
    assert.equal(findings.length, 2);
    assert.equal(findings[0].severity, "warning");
    assert.equal(findings[1].severity, "info");
  });
});

describe("checkBrokenLinks", () => {
  it("says nothing when nothing is broken", () => {
    assert.deepEqual(checkBrokenLinks(page(), []), []);
  });

  it("reports broken links as critical, naming them", () => {
    const findings = checkBrokenLinks(page(), ["https://example.com/dead"]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "critical");
    assert.match(findings[0].description, /\/dead/);
  });
});

describe("runAllChecks", () => {
  it("finds nothing wrong with a fully well-formed page", () => {
    const findings = runAllChecks(page(), { reachable: { robotsTxt: true, sitemapXml: true }, brokenLinks: [] });
    assert.deepEqual(findings, []);
  });

  it("accumulates findings from every check", () => {
    const findings = runAllChecks(
      page({ title: undefined, metaViewport: undefined }),
      { reachable: { robotsTxt: false, sitemapXml: true }, brokenLinks: ["https://example.com/dead"] },
    );

    const categories = new Set(findings.map((f) => f.category));
    assert.ok(categories.has("on-page"));
    assert.ok(categories.has("technical"));
    assert.ok(categories.has("links"));
  });
});
