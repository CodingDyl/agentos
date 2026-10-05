/**
 * Reading a client's current website: every public page we are allowed to
 * read, up to a limit, with what a rebuild needs from each one.
 *
 * Rules, in order: same site only; robots.txt is obeyed for `*`; pages, not
 * files; at most `MAX_PAGES`. Everything skipped is recorded with the reason,
 * so the transcript says what it does *not* cover instead of implying it is
 * the whole site.
 *
 * A real browser, as in `server/seo/crawler.ts`: plenty of small-business
 * sites build their content with JavaScript, and a plain fetch would miss it.
 */

export const MAX_PAGES = 15;
const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_TEXT_CHARS = 12_000;

const FILE_EXTENSION = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|mov|avi|css|js|json|xml|txt)$/i;

export interface CapturedForm {
  action: string;
  method: string;
  fields: { name: string; type: string; label: string; required: boolean }[];
}

export interface CapturedPage {
  url: string;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  headings: { level: number; text: string }[];
  navigation: { text: string; href: string }[];
  ctas: { text: string; href: string }[];
  forms: CapturedForm[];
  images: number;
  imagesWithoutAlt: number;
  text: string;
  internalLinks: string[];
}

export interface CaptureManifest {
  startUrl: string;
  capturedAt: string;
  robots: "obeyed" | "none" | "unreadable";
  captured: string[];
  skipped: { url: string; reason: string }[];
  failed: { url: string; reason: string }[];
}

export interface CaptureResult {
  pages: CapturedPage[];
  manifest: CaptureManifest;
}

/** `Disallow` prefixes that apply to every crawler (`User-agent: *`). Allow lines are ignored: stricter is safer. */
export function parseRobots(text: string): string[] {
  const disallowed: string[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key.toLowerCase() === "user-agent") {
      // Consecutive agent lines share one group.
      applies = (lastWasAgent && applies) || value.trim() === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (applies && key.toLowerCase() === "disallow" && value.trim()) disallowed.push(value.trim());
  }
  return disallowed;
}

export function robotsAllows(url: string, disallowed: readonly string[]): boolean {
  const { pathname, search } = new URL(url);
  const target = `${pathname}${search}`;
  return !disallowed.some((prefix) => {
    const pattern = prefix.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(target);
  });
}

/** One page, one key: no fragment, no trailing slash, tracking parameters dropped. */
export function normalizePageUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) parsed.searchParams.delete(key);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

/** Why a link is not worth loading as a page, or undefined if it is. */
export function skipReason(url: string, origin: string, disallowed: readonly string[]): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a valid address";
  }
  if (parsed.origin !== origin) return "another website";
  if (FILE_EXTENSION.test(parsed.pathname)) return "a file, not a page";
  if (!robotsAllows(parsed.toString(), disallowed)) return "disallowed by robots.txt";
  return undefined;
}

export interface CaptureDeps {
  fetchRobots: (origin: string) => Promise<string | undefined | null>;
  loadPage: (url: string) => Promise<CapturedPage>;
  now: () => Date;
  onProgress?: (message: string) => void;
}

/**
 * Breadth-first from the start page: the homepage's links first, which is
 * how a visitor meets the site. Stops at `MAX_PAGES`; whatever was left is
 * recorded as skipped, not silently dropped.
 */
export async function captureSite(startUrl: string, deps: CaptureDeps, maxPages = MAX_PAGES): Promise<CaptureResult> {
  const start = normalizePageUrl(startUrl);
  const origin = new URL(start).origin;

  const robotsText = await deps.fetchRobots(origin).catch(() => null);
  const disallowed = robotsText ? parseRobots(robotsText) : [];
  const manifest: CaptureManifest = {
    startUrl: start,
    capturedAt: deps.now().toISOString(),
    robots: robotsText === null ? "unreadable" : robotsText === undefined ? "none" : "obeyed",
    captured: [],
    skipped: [],
    failed: [],
  };

  const pages: CapturedPage[] = [];
  const queue = [start];
  const seen = new Set<string>([start]);

  if (!robotsAllows(start, disallowed)) {
    manifest.skipped.push({ url: start, reason: "disallowed by robots.txt" });
    return { pages, manifest };
  }

  while (queue.length > 0) {
    const url = queue.shift() as string;
    if (pages.length >= maxPages) {
      manifest.skipped.push({ url, reason: `over the ${maxPages}-page limit` });
      continue;
    }
    deps.onProgress?.(`Reading ${url} (${pages.length + 1} of up to ${maxPages})`);
    try {
      const page = await deps.loadPage(url);
      pages.push(page);
      manifest.captured.push(url);
      for (const link of page.internalLinks) {
        let key: string;
        try {
          key = normalizePageUrl(link);
        } catch {
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        const reason = skipReason(key, origin, disallowed);
        if (reason) manifest.skipped.push({ url: key, reason });
        else queue.push(key);
      }
    } catch (error) {
      manifest.failed.push({ url, reason: error instanceof Error ? error.message.slice(0, 300) : "could not be loaded" });
    }
  }

  return { pages, manifest };
}

// ------------------------------------------------------------- the browser

interface EvaluatedElement {
  tagName: string;
  textContent: string | null;
  innerText: string;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): EvaluatedElement[];
  closest(selector: string): EvaluatedElement | null;
  labels?: EvaluatedElement[] | null;
  /** Anchors and forms resolve these against the page address themselves. */
  href?: string;
  action?: string;
}

interface EvaluatedDocument {
  title: string;
  body: EvaluatedElement | null;
  querySelector(selector: string): EvaluatedElement | null;
  querySelectorAll(selector: string): EvaluatedElement[];
}

declare const document: EvaluatedDocument;
declare const window: { location: { href: string } };

async function chromium(): Promise<typeof import("@playwright/test")["chromium"]> {
  try {
    return (await import("@playwright/test")).chromium;
  } catch {
    throw new Error("Playwright is not installed, so the site could not be read. Run `npx playwright install chromium`.");
  }
}

/** Opens one browser for the whole capture and loads pages in it one at a time. */
export async function withBrowserLoader<T>(run: (loadPage: (url: string) => Promise<CapturedPage>) => Promise<T>): Promise<T> {
  const browser = await (await chromium()).launch();
  try {
    const context = await browser.newContext({ userAgent: "AgentOS website capture (+https://github.com/CodingDyl/agentos)" });
    const loadPage = async (url: string): Promise<CapturedPage> => {
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
        const status = response?.status();
        if (status !== undefined && status >= 400) throw new Error(`answered ${status}`);
        const contentType = response?.headers()["content-type"] ?? "";
        if (contentType && !contentType.includes("html")) throw new Error(`is ${contentType.split(";")[0]}, not a page`);

        // One flat callback with no helper functions: the source text runs in the page (see seo/crawler.ts).
        const captured = await page.evaluate((maxText) => {
          const origin = new URL(window.location.href).origin;
          return {
            url: window.location.href,
            title: document.title.trim() || undefined,
            metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || undefined,
            canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() || undefined,
            headings: Array.from(document.querySelectorAll("h1, h2, h3, h4")).map((element) => ({ level: Number(element.tagName[1]), text: (element.textContent ?? "").replace(/\s+/g, " ").trim() })).filter((heading) => heading.text),
            navigation: Array.from(document.querySelectorAll("nav a[href], header a[href]")).map((element) => ({ text: (element.textContent ?? "").replace(/\s+/g, " ").trim(), href: element.href || "" })).filter((link) => link.text && link.href).slice(0, 40),
            ctas: Array.from(document.querySelectorAll("button, a[role='button'], a[class*='btn'], a[class*='button'], a[class*='cta'], input[type='submit']")).map((element) => ({ text: (element.textContent || element.getAttribute("value") || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(), href: element.href || "" })).filter((cta) => cta.text).slice(0, 30),
            forms: Array.from(document.querySelectorAll("form")).map((form) => ({
              action: (typeof form.action === "string" && form.action) || window.location.href,
              method: (form.getAttribute("method") || "get").toLowerCase(),
              fields: Array.from(form.querySelectorAll("input, select, textarea"))
                .filter((field) => !["hidden", "submit", "button"].includes((field.getAttribute("type") || "").toLowerCase()))
                .map((field) => ({
                  name: field.getAttribute("name") || field.getAttribute("id") || "",
                  type: (field.getAttribute("type") || field.tagName.toLowerCase()).toLowerCase(),
                  label: ((field.labels && field.labels[0]?.textContent) || field.getAttribute("aria-label") || field.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim(),
                  required: field.getAttribute("required") !== null,
                })),
            })),
            images: document.querySelectorAll("img").length,
            imagesWithoutAlt: Array.from(document.querySelectorAll("img")).filter((image) => !(image.getAttribute("alt") || "").trim()).length,
            text: (document.body?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText),
            internalLinks: Array.from(new Set(Array.from(document.querySelectorAll("a[href]")).map((element) => element.href || "").filter((href) => href.startsWith(origin)))),
          };
        }, MAX_TEXT_CHARS);
        return captured;
      } finally {
        await page.close();
      }
    };
    return await run(loadPage);
  } finally {
    await browser.close();
  }
}

export async function fetchRobots(origin: string): Promise<string | undefined | null> {
  try {
    const response = await fetch(`${origin}/robots.txt`, { redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (response.status === 404 || response.status === 410) return undefined;
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
