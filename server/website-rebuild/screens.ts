import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { routeName } from "../../shared/website-rebuild-types";

/**
 * Screenshots for the review checkpoints: every concept or page at a desktop
 * and a phone width, so approval is given on what the work looks like, not
 * on a description of it.
 */

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export interface Shot {
  name: string;
  viewport: ViewportName;
  /** Absolute path of the PNG written. */
  file: string;
  /** The page was taller than the browser can capture in one image, so the bottom is missing. */
  cropped?: boolean;
}

export interface ScreenshotOptions {
  /** The whole page, top to bottom, instead of the first screen. */
  fullPage?: boolean;
}

/** Chromium cannot make an image taller than this. */
export const MAX_SHOT_HEIGHT = 16_384;

async function chromium(): Promise<typeof import("@playwright/test")["chromium"]> {
  try {
    return (await import("@playwright/test")).chromium;
  } catch {
    throw new Error("Playwright is not installed, so screenshots could not be taken. Run `npx playwright install chromium`.");
  }
}

/** Photographs each target at both widths. Targets are `http(s)://` or absolute file paths. */
export async function screenshot(targets: readonly { name: string; target: string }[], outputDir: string, options: ScreenshotOptions = {}): Promise<Shot[]> {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await (await chromium()).launch();
  const shots: Shot[] = [];
  try {
    for (const [viewport, size] of Object.entries(VIEWPORTS) as [ViewportName, { width: number; height: number }][]) {
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
      for (const { name, target } of targets) {
        const page = await context.newPage();
        const url = /^https?:\/\//.test(target) ? target : pathToFileURL(target).href;
        await page.goto(url, { waitUntil: "load", timeout: 45_000 });
        // Let web fonts and entrance animations settle; a half-faded hero is not what will be shipped.
        await page.waitForTimeout(800);
        const file = path.join(outputDir, `${name}-${viewport}.png`);
        const height = options.fullPage ? Number(await page.evaluate("document.documentElement.scrollHeight")) : 0;
        await page.screenshot({ path: file, fullPage: options.fullPage === true });
        shots.push({ name, viewport, file, ...(height > MAX_SHOT_HEIGHT ? { cropped: true } : {}) });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return shots;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port"))));
    });
  });
}

/**
 * Serves a built Next.js app from `directory` on a free local port. The build
 * is the one validation already produced; nothing is rebuilt here.
 */
export async function serveBuiltNextApp(directory: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child: ChildProcess = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: directory,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The site did not start (next start exited with ${child.exitCode}). Was it built?`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return { url, stop };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stop();
  throw new Error("The site did not answer within a minute of starting.");
}

/** The routes to photograph: the worker's `sitemap.json` if it wrote one, else the home page. At most `limit`. */
export function routesFrom(sitemapJson: string | undefined, limit = 6): string[] {
  return routeList(sitemapJson, limit).routes;
}

/** The routes to photograph, and how many the sitemap listed beyond `limit`. */
export function routeList(sitemapJson: string | undefined, limit = 6): { routes: string[]; dropped: number } {
  if (!sitemapJson) return { routes: ["/"], dropped: 0 };
  try {
    const parsed: unknown = JSON.parse(sitemapJson);
    const list = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed && "routes" in parsed ? (parsed as { routes: unknown }).routes : [];
    const routes = (Array.isArray(list) ? list : [])
      .map((entry) => (typeof entry === "string" ? entry : typeof entry === "object" && entry && "path" in entry ? String((entry as { path: unknown }).path) : ""))
      .filter((route) => /^\/[A-Za-z0-9\-._~/]*$/.test(route) && !route.includes(".."));
    const unique = [...new Set(["/", ...routes])];
    return { routes: unique.slice(0, limit), dropped: Math.max(0, unique.length - limit) };
  } catch {
    return { routes: ["/"], dropped: 0 };
  }
}

export { routeName };
