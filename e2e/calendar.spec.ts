import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_VAULT } from "../playwright.config";

test.setTimeout(60_000);

test.beforeEach(async ({ request }) => { await request.post("/api/focus/skip", { data: {} }); });

const date = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
test("calendar starts in month, opens a selected day, and sits after today's priorities", async ({ page }) => {
  await page.goto("/");
  const calendar = page.locator("#overview-calendar");
  await expect(calendar.getByRole("radio", { name: "Month", exact: true })).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
  expect(await page.evaluate(() => {
    const calendar = document.querySelector("#overview-calendar")!;
    const priorities = document.querySelector("#needs-you")!;
    const workspaces = document.querySelector('section[aria-label="Workspaces"]')!;
    return Boolean(priorities.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(calendar.compareDocumentPosition(workspaces) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await calendar.locator(`[data-calendar-date="${date()}"]`).getByRole("button", { name: /^Show / }).click();
  await expect(calendar.getByRole("radio", { name: "Day", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(calendar.getByLabel("Day calendar", { exact: true })).toBeVisible();
  await expect(calendar.locator("[data-calendar-slot]")).toHaveCount(24);
  await expect(calendar.locator(`[data-calendar-slot="${date()}T09:00"]`)).toBeAttached();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await calendar.getByRole("button", { name: "Next calendar period" }).click();
  await expect(calendar.locator(`[data-calendar-slot="${nextDate}T09:00"]`)).toBeAttached();
  await calendar.getByRole("radio", { name: "Month", exact: true }).click();
  await expect(calendar.locator("[data-calendar-date]")).toHaveCount(42);
});

test("calendar saves, moves and completes real workspace tasks", async ({ page }) => {
  await page.goto("/");
  const calendar = page.locator("#overview-calendar");
  await expect(calendar.getByRole("radio", { name: "Week", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(calendar.getByText(/Connect your Google account/)).toBeVisible();
  await calendar.getByRole("button", { name: "Task", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Task title").fill("Prepare calendar verification slides");
  await dialog.getByLabel("Workspace").selectOption("pantry-pilot");
  await dialog.getByLabel("Time (optional)").fill("09:00");
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Scheduled today" }).getByText("Prepare calendar verification slides")).toBeVisible();
  const file = path.join(E2E_VAULT, "projects/pantry-pilot/TASKS.md");
  await expect.poll(() => fs.readFileSync(file, "utf8")).toMatch(new RegExp(`Prepare calendar verification slides · scheduled ${date()}@09:00/60`));
  // Month drag moves the same task, preserving its time and id.
  await calendar.getByRole("radio", { name: "Month", exact: true }).click();
  const days = calendar.locator("[data-calendar-date]");
  const target = days.nth(10);
  const targetDate = await target.getAttribute("data-calendar-date");
  const source = calendar.locator(`[data-calendar-date="${date()}"]`).getByRole("button", { name: /Prepare calendar verification slides/ });
  await target.scrollIntoViewIfNeeded();
  await source.dragTo(target);
  await expect.poll(() => fs.readFileSync(file, "utf8")).toContain(`scheduled ${targetDate}@09:00/60`);
  await target.getByRole("button", { name: /Prepare calendar verification slides/ }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Completed", { exact: true }).check();
  await dialog.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => fs.readFileSync(file, "utf8")).toMatch(/- \[x\] \[PP-\d+\] Prepare calendar verification slides/);
  await page.reload();
  await calendar.getByRole("radio", { name: "Month", exact: true }).click();
  await expect(calendar.getByRole("button", { name: /Prepare calendar verification slides/ }).first()).toBeVisible();
});

test("calendar edits Google events and reviews opt-in preparation suggestions", async ({ page }) => {
  const day = date();
  let event = { id: "review_1", etag: '"v1"', title: "Client review", start: `${day}T09:00:00+02:00`, end: `${day}T10:00:00+02:00`, allDay: false, description: "Review the launch", location: "Studio", allowTasks: false, preparation: "" };
  await page.route("**/api/calendar/events?*", (route) => route.fulfill({ json: { status: "ready", canWrite: true, events: [event], fetchedAt: new Date().toISOString() } }));
  await page.route("**/api/calendar/events/review_1", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.etag).toBe('"v1"');
    event = { ...event, ...body, etag: '"v2"' };
    await route.fulfill({ json: event });
  });
  await page.route("**/api/calendar/events/review_1/suggestions", (route) => route.fulfill({ json: { suggestions: ["Prepare the slides", "Review the agenda"] } }));
  await page.goto("/");
  const calendar = page.locator("#overview-calendar");
  await calendar.getByRole("button", { name: /Client review/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Review suggestions" })).toHaveCount(0);
  await dialog.getByLabel("Allow tasks for this event").check();
  await dialog.getByLabel("Preparation notes").fill("Prepare the slides\nReview the agenda");
  await dialog.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save event", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Review suggestions" }).click();
  await expect(dialog.getByText("Prepare the slides", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Review task" }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Task title")).toHaveValue("Prepare the slides");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await calendar.getByRole("radio", { name: "Month", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: "test-results/calendar-month-desktop.png" });
  await calendar.getByRole("radio", { name: "Week", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: "test-results/calendar-week-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".os-navigation-drawer").evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await calendar.getByRole("heading", { name: "Calendar", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: "test-results/calendar-mobile.png" });
  expect(await calendar.evaluate((node) => node.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
