import { expect, test } from "@playwright/test";

/**
 * The Outcomes scorecard, over the throwaway e2e vault. The fixture has no
 * Compass, so the money goal is saved through the app's own API first.
 */

test.describe("Outcomes", () => {
  test.beforeAll(async ({ request }) => {
    const saved = await request.put("/api/compass", {
      data: {
        compass: {
          direction: "",
          values: [],
          areas: [],
          goals: [{ id: "G1", title: "Earn more", area: "Money", by: "2027-12", measure: "monthly income", now: "R38,000", target: "R100,000" }],
          projects: [],
          thisWeek: [],
        },
      },
    });
    expect(saved.ok()).toBeTruthy();
  });

  test("shows the target from Compass, logs 30 minutes, and the total updates", async ({ page }) => {
    await page.goto("/operations?tab=outcomes");

    await expect(page.getByRole("tab", { name: "Outcomes" })).toBeVisible();
    const headline = page.getByRole("region", { name: /^Paid in / });
    await expect(headline.getByText("of R100,000 (G1)")).toBeVisible();
    await expect(headline.getByText("Client payments only: salary is not counted.", { exact: false })).toBeVisible();

    const hours = page.getByRole("region", { name: "Your hours" });
    await expect(hours.getByText(/No hours logged this month/)).toBeVisible();
    await expect(hours.getByRole("button", { name: "Log hours" })).toBeDisabled();

    await hours.getByRole("button", { name: "30m" }).click();
    await hours.getByLabel("Kind of work").selectOption("review");
    await hours.getByRole("button", { name: "Log hours" }).click();

    await expect(hours.getByText("30m", { exact: true }).first()).toBeVisible();
    await expect(hours.getByText(/this month/)).toContainText("30m");
    await expect(hours.getByText(/No hours logged this month/)).toHaveCount(0);

    // Taking it back out returns the honest empty state.
    await hours.getByRole("button", { name: /^Remove 30m Review/ }).click();
    await expect(hours.getByText(/No hours logged this month/)).toBeVisible();
  });

  test("does not overflow a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/operations?tab=outcomes");
    await expect(page.getByRole("region", { name: /^Paid in / })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test("points to Compass when there is no target to measure against", async ({ page, request }) => {
    const current = (await (await request.get("/api/compass")).json()) as { revision?: string };
    await request.put("/api/compass", { data: { compass: { direction: "", values: [], areas: [], goals: [], projects: [], thisWeek: [] }, revision: current.revision } });
    await page.goto("/operations?tab=outcomes");
    const headline = page.getByRole("region", { name: /^Paid in / });
    await expect(headline.getByText("No monthly income target to measure against.")).toBeVisible();
    await expect(headline.getByRole("link", { name: "Compass" })).toBeVisible();
  });
});
