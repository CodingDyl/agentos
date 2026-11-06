import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Committed doc screenshots are rewritten only on request, so a normal test
// run leaves the checkout clean.
const screenshots = process.env.UPDATE_DOC_SCREENSHOTS === "1"
  ? path.resolve("docs/collective/screenshots")
  : path.resolve("test-results/collective-screenshots");

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeAttached();
  const skip = page.getByRole("button", { name: "Skip today", exact: true });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test("every route renders on the Quiet Terminal tokens with no overflow", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = ["/", "/inbox", "/traction", "/business", "/finance", "/operator", "/workspaces", "/workspaces/pantry-pilot", "/knowledge", "/memory", "/learning", "/designs", "/designs/boards", "/designs/generations", "/designs/motion", "/automations", "/connectors", "/activity", "/operations", "/agents", "/workers", "/agent", "/compass", "/design-system"];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main[data-agentos-page]")).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(await page.locator("header.os-stage").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(21, 24, 27)");
    await noHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test("Today responds to narrow, tablet, desktop, and 200% equivalent CSS viewport", async ({ page }) => {
  fs.mkdirSync(screenshots, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  for (const [width, height, name] of [[1440, 1000, "desktop"], [834, 1112, "tablet"], [390, 844, "mobile"], [320, 700, "narrow"], [720, 500, "zoom-200-equivalent"]] as const) {
    await page.setViewportSize({ width, height });
    await noHorizontalOverflow(page);
    await expect(page.getByRole("button", { name: "Capture a note" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search AgentOS" })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, `today-${name}.png`), animations: "disabled" });
  }
  await expect(page.locator(".collective-artwork, .collective-paper-label, .collective-tape")).toHaveCount(0);
});

test("mobile drawer traps keyboard focus, closes with Escape, and keeps routes reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  const today = drawer.getByRole("link", { name: /^Dashboard/ });
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
  await openDashboard(page);
  const wrap = page.getByRole("button", { name: "Wrap up", exact: true });
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Wrap up the day" })).toBeVisible();
  await page.getByRole("button", { name: "Plan the day" }).click();
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: "Morning brief" })).toBeVisible();
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

test("the Capture menu keeps every mode, and voice is also in search", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "More ways to capture" }).click();
  await expect(page.getByRole("menuitem", { name: /^Note/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Voice/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Jarvis text/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /^Quick create/ }).click();
  await expect(page.getByRole("dialog", { name: "Quick create" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search AgentOS" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "More ways to capture" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search AgentOS" }).fill("voice");
  await expect(page.getByRole("option", { name: /Voice capture/ })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Search AgentOS" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Commands and search" })).toHaveCount(0);
});

test("a priority row opens its task, and approvals are one link away", async ({ page }) => {
  await openDashboard(page);
  // With nothing picked yet, Plan the day is the check-in that picks them.
  await page.getByRole("button", { name: "Plan the day" }).click();
  const morning = page.getByRole("dialog", { name: /Good (morning|afternoon|evening)/ });
  if (await morning.isVisible().catch(() => false)) {
    await morning.getByRole("button", { name: "OK", exact: true }).click();
    await morning.getByRole("button", { name: "1 to 3 hours" }).click();
    await morning.getByRole("button", { name: "Plan my day" }).click();
    await page.getByRole("button", { name: "Start the day" }).click({ timeout: 20_000 });
  }
  const three = page.getByRole("region", { name: "Your three" });
  const title = three.getByRole("listitem").first().getByRole("link").first();
  await expect(title).toBeVisible();
  await title.click();
  await expect(page).toHaveURL(/\/workspaces\//);
  await page.goto("/");
  await page.getByRole("list", { name: "Today at a glance" }).getByRole("link", { name: /approvals? waiting|No approvals waiting/ }).click();
  await expect(page).toHaveURL(/#needs-you|\/activity/);
  await page.goto("/");
  await page.getByRole("complementary", { name: "Primary navigation" }).getByRole("link", { name: /^Workspaces/ }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
});

test("the rail keeps every destination, with labels on focus", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openDashboard(page);
  const nav = page.getByRole("complementary", { name: "Primary navigation" });
  expect((await nav.boundingBox())?.width).toBe(64);
  for (const label of ["Dashboard", "Inbox", "Finance", "Workspaces", "Memory", "Connectors", "Compass"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeAttached();
  }
  await nav.getByRole("link", { name: "Finance" }).focus();
  await expect(nav.getByText("Finance", { exact: true }).last()).toBeVisible();
});

test("the checklist adds on Enter, ticks, and removes by keyboard", async ({ page }) => {
  await openDashboard(page);
  const panel = page.getByRole("region", { name: "To do today" });
  const input = panel.getByRole("textbox", { name: "Add to today's list" });
  const text = `Checklist item ${Date.now()}`;
  await input.fill(text);
  await input.press("Enter");
  const box = panel.getByRole("checkbox", { name: `Done: ${text}` });
  await expect(box).toBeVisible();
  await box.focus();
  await page.keyboard.press("Space");
  await expect(panel.getByRole("checkbox", { name: `Not done: ${text}` })).toBeChecked();
  await panel.getByRole("button", { name: `Remove: ${text}` }).click();
  await expect(panel.getByText(text)).toHaveCount(0);
  await input.fill("discarded");
  await input.press("Escape");
  await expect(input).toHaveValue("");
});

test("report friction is reachable from the page's More menu", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Report friction" }).click();
  const dialog = page.getByRole("dialog", { name: "Report friction" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeFocused();
});
