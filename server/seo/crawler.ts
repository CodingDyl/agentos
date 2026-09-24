/**
 * Loading the page whose SEO gets checked.
 *
 * A real browser, same reasoning as `server/visual-verification/capture.ts`:
 * a plain `fetch` of the HTML would miss anything a client-rendered app
 * injects after load, and title tags, meta descriptions and structured data
 * are exactly the kind of thing a React app often sets from JavaScript.
 * Playwright's part ends at reporting what it found — every judgement about
 * whether that is good SEO happens in `checks.ts`.
 */

const NAVIGATION_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * `document`/`window` below belong to the crawled page's browser context,
 * not this Node process. This project's server tsconfig deliberately
 * excludes the DOM lib, so they are declared locally with just the shape
 * `page.evaluate`'s callback actually uses — narrow rather than `any`, and
 * scoped to this module only: a `declare` in a file with imports/exports
 * never leaks to the global scope.
 */
interface EvaluatedElement {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

interface EvaluatedDocument {
  title: string;
  querySelector(selector: string): EvaluatedElement | null;
  querySelectorAll(selector: string): EvaluatedElement[];
}

declare const document: EvaluatedDocument;
declare const window: { location: { href: string } };

export interface CrawledPage {
  url: string;
  origin: string;
  title: string | undefined;
  metaDescription: string | undefined;
  metaViewport: string | undefined;
  canonical: string | undefined;
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | undefined }[];
  jsonLd: string[];
  /** Same-origin `<a href>`s found on the page, deduplicated. */
  internalLinks: string[];
}

async function chromium(): Promise<typeof import("@playwright/test")["chromium"]> {
  try {
    return (await import("@playwright/test")).chromium;
  } catch {
    throw new Error(
      "Playwright is not installed, so the site could not be crawled. Run `npm install -D @playwright/test` and `npx playwright install chromium`.",
    );
  }
}

/** Loads one page and reads what an SEO audit needs from its rendered DOM. */
export async function crawlPage(targetUrl: string): Promise<CrawledPage> {
  const launch = await chromium();
  const browser = await launch.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const response = await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    const status = response?.status();
    if (status !== undefined && status >= 400) {
      throw new Error(`${targetUrl} answered ${status}.`);
    }

    const origin = new URL(targetUrl).origin;

    // Deliberately one flat statement, with no nested helper function:
    // esbuild (via tsx) sometimes wraps a nested const/function inside a
    // transpiled closure with a `__name(...)` call for debugging names, and
    // since `page.evaluate` sends this function's *source text* into the
    // browser, a helper only defined in the Node process's compiled output
    // becomes a `ReferenceError` there. Every value below is trimmed inline
    // instead of through a shared helper, so nothing here can trigger that.
    return await page.evaluate((pageOrigin) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((element) => ({
        level: Number(element.tagName[1]),
        text: element.textContent?.trim() ?? "",
      }));

      const images = Array.from(document.querySelectorAll("img")).map((element) => ({
        src: element.getAttribute("src") ?? "",
        alt: element.getAttribute("alt")?.trim() || undefined,
      }));

      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
        (element) => element.textContent ?? "",
      );

      const internalLinks = Array.from(
        new Set(
          Array.from(document.querySelectorAll("a[href]"))
            .map((element) => element.getAttribute("href") ?? "")
            .filter((href) => href && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:"))
            .map((href) => {
              try {
                return new URL(href, window.location.href).href;
              } catch {
                return "";
              }
            })
            .filter((href) => href.startsWith(pageOrigin)),
        ),
      );

      return {
        url: window.location.href,
        origin: pageOrigin,
        title: document.title.trim() || undefined,
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || undefined,
        metaViewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content")?.trim() || undefined,
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() || undefined,
        headings,
        images,
        jsonLd,
        internalLinks,
      };
    }, origin);
  } finally {
    await browser.close();
  }
}

/** Whether a well-known path answers, without following redirects into an app's own 404 page. */
export async function urlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Checks a bounded sample of internal links for a broken (4xx/5xx/unreachable) response. */
export async function findBrokenLinks(links: readonly string[], limit = 20): Promise<string[]> {
  const sample = links.slice(0, limit);
  const broken: string[] = [];

  for (const link of sample) {
    try {
      const response = await fetch(link, { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) broken.push(link);
    } catch {
      broken.push(link);
    }
  }

  return broken;
}
