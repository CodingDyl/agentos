import { chromium, type FullConfig } from "@playwright/test";
import { ROUTES, WARM_ONLY_ROUTES } from "./routes";

/**
 * Open every screen once before the first test.
 *
 * Vite finds some dependencies only when a screen first loads, then re-bundles
 * and reloads the page. On a cold cache (CI) that reload lands in the middle of
 * whichever test is running and wipes what it typed or measured. Visiting the
 * screens first settles the cache, so no test sees it. Nothing here asserts.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (let pass = 0; pass < 2; pass += 1) {
      for (const route of [...ROUTES, ...WARM_ONLY_ROUTES]) {
        await page.goto(new URL(route, baseURL).toString(), { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
}
