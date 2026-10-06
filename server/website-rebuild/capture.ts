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

/** An image the brand kit may use. `data` is the file, already checked to be a raster image. */
export interface CapturedImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  /** Where on the page it was found: logos in the header count for more. */
  placement: "header" | "icon" | "content" | "social";
  data?: Buffer;
  /** One of `BRAND_IMAGE_TYPES`. */
  contentType?: string;
}

/** A computed colour, as the browser reports it (`rgb(…)`/`rgba(…)`), and what it was used for. */
export interface CapturedColor {
  value: string;
  role: "background" | "text" | "heading" | "header" | "accent" | "link";
}

export interface CapturedBrand {
  logos: CapturedImage[];
  photos: CapturedImage[];
  colors: CapturedColor[];
  fonts: { family: string; role: "body" | "heading" }[];
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
  /** Branding signals. Absent when the page was read without a browser. */
  brand?: CapturedBrand;
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
  /** Images. */
  currentSrc?: string;
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

interface EvaluatedDocument {
  title: string;
  body: EvaluatedElement | null;
  querySelector(selector: string): EvaluatedElement | null;
  querySelectorAll(selector: string): EvaluatedElement[];
}

declare const document: EvaluatedDocument;
declare const window: {
  location: { href: string };
  getComputedStyle(element: EvaluatedElement): { backgroundColor: string; color: string; fontFamily: string; backgroundImage: string };
};

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
    const budget: DownloadBudget = { remaining: MAX_BRAND_TOTAL_BYTES, seen: new Set() };

    const rasterise = await sandboxRasteriser(browser);

    const loadPage = async (url: string): Promise<CapturedPage> => {
      const page = await context.newPage();
      const responses = new Map<string, PlaywrightResponse>();
      page.on("response", (response) => {
        if (response.request().resourceType() === "image" && response.ok()) responses.set(response.url(), response);
      });
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
        const brand = await readBrand(page, responses, budget, rasterise).catch(() => undefined);
        return { ...captured, brand };
      } finally {
        await page.close();
      }
    };
    return await run(loadPage);
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------ the branding

/** The image formats a brand kit stores as they are. Anything else is rasterised to PNG or dropped. */
export const BRAND_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"] as const;
export const MAX_BRAND_IMAGE_BYTES = 5 * 1024 * 1024;
/** A file a person uploads: a camera photo or a print-quality logo can be large, and it is one file, not a crawl. */
export const MAX_BRAND_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Across the whole capture, so a photo-heavy site cannot fill the disk or the memory. */
const MAX_BRAND_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_LOGOS_PER_PAGE = 3;
const MAX_PHOTOS_PER_PAGE = 6;

/**
 * What a file really is, from its first bytes. The server's content type is
 * not trusted: a hostile site can call anything `image/png`.
 */
export function sniffImage(data: Buffer): (typeof BRAND_IMAGE_TYPES)[number] | "image/svg+xml" | "image/x-icon" | undefined {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && data.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp" && /^avi[fs]$/.test(data.toString("ascii", 8, 12))) return "image/avif";
  if (data.length >= 4 && data.readUInt32BE(0) === 0x00000100) return "image/x-icon";
  const head = data.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return undefined;
}

type Browser = Awaited<ReturnType<Awaited<ReturnType<typeof chromium>>["launch"]>>;

/**
 * SVG and ICO files become PNGs in a page of their own: shown through an <img>, which never runs
 * a script, with every network request refused, so a hostile logo can neither execute nor call out.
 */
async function sandboxRasteriser(browser: Browser): Promise<Rasterise> {
  const sandbox = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
  await sandbox.route("**/*", (route) => route.abort());
  return async (data, contentType) => {
    const page = await sandbox.newPage();
    try {
      await page.setContent(`<body style="margin:0;background:transparent"><img id="asset" style="display:block;max-width:1200px;max-height:1200px;min-width:${contentType === "image/svg+xml" ? 480 : 16}px" src="data:${contentType};base64,${data.toString("base64")}"></body>`);
      const image = page.locator("#asset");
      const loaded = await image.evaluate((element) => (element as unknown as { complete: boolean; naturalWidth: number }).complete && (element as unknown as { naturalWidth: number }).naturalWidth > 0);
      return loaded ? await image.screenshot({ omitBackground: true, type: "png" }) : undefined;
    } finally {
      await page.close();
    }
  };
}

/**
 * One image, made safe to store: a raster file as it is, SVG or ICO as a PNG,
 * anything else refused. For uploads, which arrive without a capture's browser.
 */
export async function toSafeRaster(data: Buffer, maxBytes = MAX_BRAND_UPLOAD_BYTES): Promise<{ data: Buffer; contentType: (typeof BRAND_IMAGE_TYPES)[number] } | undefined> {
  if (data.length === 0 || data.length > maxBytes) return undefined;
  const sniffed = sniffImage(data);
  if (!sniffed) return undefined;
  if (sniffed !== "image/svg+xml" && sniffed !== "image/x-icon") return { data, contentType: sniffed };
  const browser = await (await chromium()).launch();
  try {
    const png = await (await sandboxRasteriser(browser))(data, sniffed);
    return png ? { data: png, contentType: "image/png" } : undefined;
  } finally {
    await browser.close();
  }
}

interface DownloadBudget {
  remaining: number;
  /** URLs already downloaded on an earlier page: the brand kit dedupes by URL, so they are not fetched twice. */
  seen: Set<string>;
}

type Rasterise = (data: Buffer, contentType: "image/svg+xml" | "image/x-icon") => Promise<Buffer | undefined>;

type PlaywrightPage = Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof chromium>>["launch"]>>["newPage"]>>;
type PlaywrightResponse = NonNullable<Awaited<ReturnType<PlaywrightPage["goto"]>>>;

/**
 * Logos, photos, colours and fonts from a loaded page.
 *
 * Image bytes come from the responses the browser already received while
 * loading the page, so nothing new is requested from a hostile address. The
 * one exception, an icon the browser never fetched, is requested only from
 * the page's own origin, which capture is reading anyway.
 */
async function readBrand(page: PlaywrightPage, responses: Map<string, PlaywrightResponse>, budget: DownloadBudget, rasterise: Rasterise): Promise<CapturedBrand> {
  // One flat callback with no helper functions: the source text runs in the page (see seo/crawler.ts).
  const found = await page.evaluate(() => {
    const logoSelector = "header img, nav img, [class*='logo' i] img, img[class*='logo' i], img[id*='logo' i], img[alt*='logo' i], img[src*='logo' i], a[href='/'] img";
    const logoElements = Array.from(document.querySelectorAll(logoSelector));
    const logoSources = new Set(logoElements.map((element) => element.currentSrc || element.src || ""));
    const logos = logoElements
      .map((element) => ({ url: element.currentSrc || element.src || "", alt: (element.getAttribute("alt") || "").trim(), width: element.naturalWidth || 0, height: element.naturalHeight || 0, placement: element.closest("header, nav") ? "header" : "content" }))
      .filter((image) => /^https?:/.test(image.url));
    const icons = Array.from(document.querySelectorAll("link[rel~='icon' i], link[rel='apple-touch-icon' i]"))
      .map((element) => ({ url: element.href || "", alt: "", width: 0, height: 0, placement: "icon" }))
      .filter((image) => /^https?:/.test(image.url));
    const photos = Array.from(document.querySelectorAll("main img, section img, article img, body img"))
      .map((element) => ({ url: element.currentSrc || element.src || "", alt: (element.getAttribute("alt") || "").trim(), width: element.naturalWidth || 0, height: element.naturalHeight || 0, placement: "content" }))
      .filter((image) => /^https?:/.test(image.url) && !logoSources.has(image.url) && image.width >= 400 && image.height >= 250);
    const backgrounds = Array.from(document.querySelectorAll("header, section, [class*='hero' i], [class*='banner' i], [class*='slide' i]"))
      .slice(0, 60)
      .map((element) => /url\(["']?(https?:[^"')]+)["']?\)/.exec(window.getComputedStyle(element).backgroundImage)?.[1] || "")
      .filter((url) => url)
      .map((url) => ({ url, alt: "", width: 0, height: 0, placement: "content" }));
    const social = Array.from(document.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']"))
      .map((element) => ({ url: element.getAttribute("content") ? new URL(element.getAttribute("content") || "", window.location.href).href : "", alt: "", width: 0, height: 0, placement: "social" }))
      .filter((image) => /^https?:/.test(image.url));

    const colors: { value: string; role: string }[] = [];
    const body = document.querySelector("body");
    if (body) {
      colors.push({ value: window.getComputedStyle(body).backgroundColor, role: "background" });
      colors.push({ value: window.getComputedStyle(body).color, role: "text" });
    }
    const header = document.querySelector("header") || document.querySelector("nav");
    if (header) colors.push({ value: window.getComputedStyle(header).backgroundColor, role: "header" });
    for (const element of Array.from(document.querySelectorAll("h1, h2")).slice(0, 6)) colors.push({ value: window.getComputedStyle(element).color, role: "heading" });
    for (const element of Array.from(document.querySelectorAll("button, a[role='button'], a[class*='btn' i], a[class*='button' i], a[class*='cta' i], input[type='submit']")).slice(0, 12)) colors.push({ value: window.getComputedStyle(element).backgroundColor, role: "accent" });
    for (const element of Array.from(document.querySelectorAll("main a[href]:not([class*='btn' i]):not([class*='button' i]):not([class*='cta' i]):not([role='button']), p a[href]")).slice(0, 12)) colors.push({ value: window.getComputedStyle(element).color, role: "link" });

    const fonts: { family: string; role: string }[] = [];
    if (body) fonts.push({ family: window.getComputedStyle(body).fontFamily, role: "body" });
    const heading = document.querySelector("h1") || document.querySelector("h2");
    if (heading) fonts.push({ family: window.getComputedStyle(heading).fontFamily, role: "heading" });

    return { logos: [...logos, ...icons], photos: [...photos, ...backgrounds, ...social], colors, fonts };
  });

  const pageOrigin = new URL(page.url()).origin;
  const download = async (candidate: { url: string; alt: string; width: number; height: number; placement: string }): Promise<CapturedImage | undefined> => {
    const image: CapturedImage = {
      url: candidate.url,
      alt: candidate.alt || undefined,
      width: candidate.width || undefined,
      height: candidate.height || undefined,
      placement: candidate.placement as CapturedImage["placement"],
    };
    if (budget.seen.has(candidate.url)) return image;
    budget.seen.add(candidate.url);
    let data: Buffer | undefined;
    try {
      const response = responses.get(candidate.url);
      if (response) data = await response.body();
      else if (new URL(candidate.url).origin === pageOrigin) {
        const fetched = await page.request.get(candidate.url, { timeout: 15_000, maxRedirects: 0 });
        if (fetched.ok()) data = await fetched.body();
      }
    } catch {
      return image;
    }
    if (!data || data.length === 0 || data.length > MAX_BRAND_IMAGE_BYTES || data.length > budget.remaining) return image;
    const sniffed = sniffImage(data);
    if (!sniffed) return image;
    if (sniffed === "image/svg+xml" || sniffed === "image/x-icon") {
      const png = await rasterise(data, sniffed).catch(() => undefined);
      if (!png) return image;
      data = png;
      image.contentType = "image/png";
    } else {
      image.contentType = sniffed;
    }
    budget.remaining -= data.length;
    image.data = data;
    return image;
  };

  const logos: CapturedImage[] = [];
  for (const candidate of found.logos.slice(0, MAX_LOGOS_PER_PAGE + 2)) {
    if (logos.length >= MAX_LOGOS_PER_PAGE) break;
    const image = await download(candidate);
    if (image) logos.push(image);
  }
  const photos: CapturedImage[] = [];
  const byArea = [...found.photos].sort((a, b) => b.width * b.height - a.width * a.height);
  for (const candidate of byArea) {
    if (photos.length >= MAX_PHOTOS_PER_PAGE) break;
    if (photos.some((photo) => photo.url === candidate.url)) continue;
    const image = await download(candidate);
    if (image) photos.push(image);
  }
  return {
    logos,
    photos,
    colors: found.colors.filter((color) => color.value) as CapturedColor[],
    fonts: found.fonts.filter((font) => font.family) as CapturedBrand["fonts"],
  };
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
