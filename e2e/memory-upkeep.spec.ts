import { expect, test } from "@playwright/test";

test.describe("Memory upkeep", () => {
  test("Operations → System offers to archive old logs, and says when there are none", async ({ page }) => {
    await page.goto("/operations?tab=system");
    const upkeep = page.getByRole("region", { name: "Memory upkeep" });
    await expect(upkeep.getByText("Archive old logs")).toBeVisible();
    await expect(upkeep.getByText("Nothing is older than 30 days.")).toBeVisible();
    await expect(upkeep.getByRole("button", { name: "Archive" })).toBeDisabled();
  });
});
