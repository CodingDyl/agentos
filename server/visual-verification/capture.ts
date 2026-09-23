import type { VisualRoute } from "../../shared/visual-verification-types";
import { readDimensions } from "../designs/media";
import { screenshotName } from "./storage";

/**
 * Taking the pictures.
 *
 * A real browser, because a real browser is the only thing that can say what
 * the implementation actually looks like. Playwright's part ends there: it
 * captures, deterministically, and makes no judgement about anything it sees.
 * Everything about whether the result is *right* happens elsewhere.
 *
 * Determinism is the property worth protecting here — animations paused, one
 * device pixel per CSS pixel, the network settled before the shutter — so that
 * two captures of the same page differ only when the page does.
 */

/** Long enough for a dev server's first compile of a route. */
const NAVIGATION_TIMEOUT_MS = 45_000;

/** The page has already loaded by here; this only covers a slow first render. */
const PAGE_ID_TIMEOUT_MS = 10_000;

/** How a screen says who it is. Stamped by `AppShell` on every page's `<main>`. */
const PAGE_ID_ATTRIBUTE = "data-agentos-page";

export interface Capture {
  route: string;
  viewport: string;
  width: number;
  height: number;
  filename: string;
  data: Buffer;
}

export interface CaptureOutcome {
  captures: Capture[];
  /** Routes that could not be captured, said plainly rather than skipped. */
  failures: string[];
  /**
   * A route that loaded the wrong screen, which stops everything.
   *
   * Unlike a failure, this is not a flaky route to note and work around — it
   * means the acceptance context itself is wrong, and every verdict that came
   * out of this run would be an authoritative statement about the wrong pages.
   */
  mismatch?: string;
}

/**
 * Playwright's chromium, loaded only when a capture is actually wanted.
 *
 * Imported lazily and behind a readable failure: most jobs never need a
 * browser, and a project that has not installed one should get an explanation
 * it can act on rather than a module-resolution error at server start.
 */
async function chromium(): Promise<typeof import("@playwright/test")["chromium"]> {
  try {
    return (await import("@playwright/test")).chromium;
  } catch {
    throw new Error(
      "Playwright is not installed, so no screenshots could be taken. Run `npm install -D @playwright/test` and `npx playwright install chromium`.",
    );
  }
}

/** `http://127.0.0.1:5310` + `/designs`, without doubling or dropping a slash. */
export function routeUrl(previewUrl: string, route: string): string {
  const base = previewUrl.replace(/\/+$/, "");
  const suffix = route.startsWith("/") ? route : `/${route}`;

  return `${base}${suffix}`;
}

/**
 * Captures every route at every viewport it was given.
 *
 * One route *failing* does not stop the rest: a verification that got three of
 * four screens is worth more than one that got none, and the missing one is
 * reported so the verdict can account for it.
 *
 * One route rendering the *wrong screen* does stop everything, because it is a
 * different kind of problem. A failure means a page is broken; a mismatch means
 * the list of routes is wrong, and carrying on would produce a confident verdict
 * about screens nobody asked about.
 */
export async function captureRoutes(
  previewUrl: string,
  routes: readonly VisualRoute[],
): Promise<CaptureOutcome> {
  if (routes.length === 0) {
    return {
      captures: [],
      failures: ["No routes were given, so there was nothing to capture."],
    };
  }

  const launch = await chromium();

  const browser = await launch.launch({
    args: ["--disable-lcd-text", "--force-color-profile=srgb"],
  });

  const captures: Capture[] = [];
  const failures: string[] = [];

  let mismatch: string | undefined;

  try {
    for (const route of routes) {
      for (const viewport of route.viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          // One device pixel per CSS pixel, so a screenshot's dimensions mean
          // what the viewport said they would.
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });

        const page = await context.newPage();

        try {
          const response = await page.goto(routeUrl(previewUrl, route.path), {
            waitUntil: "networkidle",
            timeout: NAVIGATION_TIMEOUT_MS,
          });

          const status = response?.status();

          // A 404 renders perfectly well and looks nothing like the design.
          // Capturing it and calling it the implementation would be worse than
          // saying the route was not there.
          if (status !== undefined && status >= 400) {
            failures.push(
              `${route.path} at ${viewport.name}: the server answered ${status}.`,
            );
            continue;
          }

          // Which screen this actually is, asked of the page rather than
          // inferred from the URL. A single-page app answers 200 for a route
          // it has never heard of, and this one redirects an unknown path to
          // the dashboard — so without this, a typo photographs the wrong
          // screen and nothing anywhere says so.
          // `.first()` because a nested screen may stamp its own id inside the
          // shell's, and the outermost one is the page. A timeout means the
          // attribute never appeared, which is a "no" rather than an error.
          const pageId = await page
            .locator(`[${PAGE_ID_ATTRIBUTE}]`)
            .first()
            .getAttribute(PAGE_ID_ATTRIBUTE, { timeout: PAGE_ID_TIMEOUT_MS })
            .catch(() => null);

          if (pageId !== route.expectedPageId) {
            mismatch = `${route.path} was expected to render the "${route.expectedPageId}" page, but rendered "${pageId ?? "unknown"}". Nothing was verified: fix the route or the expected page id.`;
            break;
          }

          const data = await page.screenshot({
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            type: "png",
          });

          // Read from the file's own header rather than assumed from the
          // viewport: a full-page capture is as tall as the page, not as tall
          // as the window.
          const dimensions = readDimensions(data);

          captures.push({
            route: route.path,
            viewport: viewport.name,
            width: dimensions?.width ?? viewport.width,
            height: dimensions?.height ?? viewport.height,
            filename: screenshotName(route.path, viewport.name),
            data,
          });
        } catch (error) {
          failures.push(
            `${route.path} at ${viewport.name}: ${
              error instanceof Error ? error.message : "the page could not be captured."
            }`,
          );
        } finally {
          await context.close().catch(() => undefined);
        }
      }

      if (mismatch) break;
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return { captures, failures, mismatch };
}
