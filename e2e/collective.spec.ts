import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const screenshots = path.resolve("docs/collective/screenshots");

async function openToday(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeAttached();
  const skip = page.getByRole("button", { name: "Skip today", exact: true });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test("Collective preserves route surfaces, real empty states, and dark tokens", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = ["/", "/inbox", "/traction", "/business", "/finance", "/operator", "/workspaces", "/workspaces/pantry-pilot", "/knowledge", "/memory", "/learning", "/designs", "/designs/boards", "/designs/generations", "/designs/motion", "/automations", "/connectors", "/activity", "/operations", "/workers", "/agent", "/compass", "/design-system"];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main[data-agentos-page]")).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(await page.locator("header.os-stage").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(17, 21, 18)");
    await noHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test("Today responds to narrow, tablet, desktop, and 200% equivalent CSS viewport", async ({ page }) => {
  fs.mkdirSync(screenshots, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openToday(page);
  for (const [width, height, name] of [[1440, 1000, "desktop"], [834, 1112, "tablet"], [390, 844, "mobile"], [320, 700, "narrow"], [720, 500, "zoom-200-equivalent"]] as const) {
    await page.setViewportSize({ width, height });
    await noHorizontalOverflow(page);
    await expect(page.getByRole("button", { name: "Capture a note" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search AgentOS" })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, `today-${name}.png`), animations: "disabled" });
  }
  expect(await page.locator(".collective-artwork").first().evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
});

test("mobile drawer traps keyboard focus, closes with Escape, and keeps routes reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openToday(page);
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  const today = drawer.getByRole("link", { name: /^Today/ });
  await expect(today).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("link", { name: "Compass", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(today).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("link", { name: "Knowledge", exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toHaveCount(0);
});

test("search, capture, Today view keys and visible focus retain keyboard operation", async ({ page }) => {
  await openToday(page);
  const wrap = page.getByRole("radio", { name: "Wrap up", exact: true });
  await wrap.click();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "Plan the day" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Plan the day" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Commands and search" });
  await expect(palette).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, "command-search.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await page.getByRole("button", { name: "Capture a note" }).focus();
  expect(await page.locator(":focus").evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  const capture = page.getByRole("dialog", { name: "Capture", exact: true });
  await expect(capture).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, "capture.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(capture).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Capture a note" })).toBeFocused();
});

test("secondary screen evidence at desktop and mobile widths", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["workspaces", "inbox", "operator", "connectors", "memory", "knowledge"]) {
    for (const [width, height, size] of [[1440, 1000, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${route}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(500);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: path.join(screenshots, `${route}-${size}.png`), animations: "disabled", timeout: 10_000 });
    }
  }
});
