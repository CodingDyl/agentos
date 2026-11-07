import { expect, test, type Page } from "@playwright/test";

/**
 * The dashboard leads with the plan until 5pm and the wrap after it, by the
 * browser's clock. These tests are about the plan view, so they ask for it
 * rather than depend on the hour. (The clock is not pinned: the server's
 * timestamps are real, and a pinned clock puts them in the future.)
 */
async function openDashboard(page: Page, options: { evening?: boolean } = {}) {
  if (options.evening) {
    const now = new Date();
    now.setHours(19, 0, 0, 0);
    await page.clock.setFixedTime(now);
  }
  await page.goto("/");
  const skip = page.getByRole("button", { name: "Skip today", exact: true });
  await skip.waitFor({ timeout: 5_000 }).catch(() => undefined);
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard", exact: true })).toBeVisible();
  if (!options.evening && (await page.getByRole("button", { name: "Wrap up", exact: true }).getAttribute("aria-pressed")) === "true") {
    await page.getByRole("button", { name: "Plan the day" }).click();
    // Asking for the plan can open the morning check-in again.
    await skip.waitFor({ timeout: 2_000 }).catch(() => undefined);
    if (await skip.isVisible()) await skip.click();
    // Leave the pointer off the button, so its resting colour can be read.
    await page.mouse.move(0, 0);
  }
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test.describe("Dashboard hierarchy", () => {
  test("puts the plan, the summary and today's work first, with business below", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDashboard(page);

    const plan = page.getByRole("button", { name: "Plan the day" });
    expect(await plan.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(157, 219, 189)");
    await expect(page.getByRole("list", { name: "Today at a glance" }).getByRole("link")).toHaveCount(4);

    const top = async (name: string) => (await page.getByRole("region", { name }).boundingBox())?.y ?? Number.NaN;
    const left = async (name: string) => (await page.getByRole("region", { name }).boundingBox())?.x ?? Number.NaN;
    const three = page.getByRole("region", { name: "Your three" });
    const brief = page.getByRole("region", { name: "Morning brief" });
    await expect(three).toBeVisible();
    await expect(brief).toBeVisible();
    // 7:5, side by side.
    const [threeBox, briefBox] = [await three.boundingBox(), await brief.boundingBox()];
    expect(threeBox && briefBox && threeBox.width > briefBox.width).toBe(true);
    expect(await left("Morning brief")).toBeGreaterThan(await left("Your three"));
    expect(await top("Business pulse")).toBeGreaterThan(await top("Primary focus"));
    expect(await top("Compass")).toBeGreaterThan(await top("Business pulse"));

    await expect(page.getByRole("link", { name: "Send invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Follow up" }).or(page.getByRole("link", { name: "Follow up" }))).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test("leads with the wrap-up from 5pm, and the plan is one press away", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDashboard(page, { evening: true });
    await expect(page.getByRole("region", { name: "Wrap up the day" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Morning brief" })).toHaveCount(0);
    await page.getByRole("button", { name: "Plan the day" }).click();
    await expect(page.getByRole("region", { name: "Morning brief" })).toBeVisible();
  });

  test("holds the content to 1440px on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 3440, height: 1400 });
    await openDashboard(page);
    await noHorizontalOverflow(page);
    const frame = await page.locator(".qt-page").first().boundingBox();
    expect(frame?.width).toBe(1440);
  });

  test("reads priorities, brief, list, focus, then business at one column", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openDashboard(page);
    const order = ["Your three", "Morning brief", "To do today", "Primary focus", "Business pulse"];
    let previous = -1;
    for (const name of order) {
      const y = (await page.getByRole("region", { name }).boundingBox())?.y ?? -1;
      expect(y, name).toBeGreaterThan(previous);
      previous = y;
    }
    await noHorizontalOverflow(page);
  });

  test("fits the wrap-up in a 320px window, at any hour", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openDashboard(page);
    await page.getByRole("button", { name: "Wrap up", exact: true }).click();
    await expect(page.getByRole("region", { name: "Wrap up the day" })).toBeVisible();
    await noHorizontalOverflow(page);
    // Against its own column too: an input's width follows the platform's font,
    // so this form can spill out on Linux while still inside the window on a Mac.
    expect(await page.locator("form:has(#loose-ends)").evaluate((form) => form.getBoundingClientRect().width <= (form.parentElement?.clientWidth ?? 0))).toBe(true);
  });

  test("shows approvals as a queue when waiting, and drops the panel when cleared", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDashboard(page);
    const queue = page.getByRole("region", { name: "Approvals & blockers" });
    await expect(queue).toBeVisible();
    expect((await queue.boundingBox())?.y ?? 0).toBeLessThan((await page.getByRole("region", { name: "Your three" }).boundingBox())?.y ?? 0);

    // Wait for the server's own answer: the button hides the cards before it has one.
    const reread = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/mission-control");
    await queue.getByRole("button", { name: "Clear all" }).click();
    await reread;
    await expect(queue).toHaveCount(0);
    await expect(page.getByRole("link", { name: "No approvals waiting" })).toBeVisible();
    await expect(page.locator("#needs-you").getByRole("button", { name: /cleared/ })).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(queue).toBeVisible();
  });
});
