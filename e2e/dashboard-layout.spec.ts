import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

function screenshotDir(): string {
  const preferred = "/opt/cursor/artifacts/screenshots";
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.resolve("docs/collective/screenshots");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

async function openDashboard(page: Page) {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "Skip today", exact: true });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

async function gridColumns(page: Page): Promise<number> {
  return page.locator(".dashboard-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length);
}

test.describe("Dashboard dense layout", () => {
  test("spans the viewport at 1440px and 3440px without horizontal scroll", async ({ page }) => {
    test.setTimeout(90_000);
    const artifacts = screenshotDir();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDashboard(page);

    await expect(page.getByRole("region", { name: "Revenue and pipeline" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Send invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Follow up" }).or(page.getByRole("link", { name: "Follow up" }))).toBeVisible();
    await expect(page.locator("#needs-you")).toBeVisible();

    const workspace = page.locator(".dashboard-workspace");
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) => getComputedStyle(element).maxWidth)).toBe("none");

    await page.setViewportSize({ width: 1440, height: 1200 });
    await noHorizontalOverflow(page);
    expect(await gridColumns(page)).toBe(2);
    await page.screenshot({
      path: path.join(artifacts, "dashboard_1440.png"),
      animations: "disabled",
      fullPage: true,
    });

    await page.setViewportSize({ width: 3440, height: 1400 });
    await noHorizontalOverflow(page);
    expect(await gridColumns(page)).toBe(6);
    await page.screenshot({
      path: path.join(artifacts, "dashboard_3440.png"),
      animations: "disabled",
      fullPage: true,
    });
  });
});
