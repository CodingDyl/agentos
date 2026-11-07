import { expect, test } from "@playwright/test";

test.describe("Music", () => {
  test("has its own place in the sidebar, and the player is there", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Music", exact: true }).click();
    await expect(page).toHaveURL(/\/music$/);
    await expect(page.getByRole("heading", { name: "Music", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect Spotify" })).toBeVisible();
  });

  test("is gone from HUB, and its old address lands on Music", async ({ page }) => {
    await page.goto("/learning");
    await expect(page.getByRole("tab", { name: "YouTube" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Spotify" })).toHaveCount(0);
    await expect(page.getByPlaceholder("Paste a YouTube link")).toBeVisible();

    await page.goto("/learning?tab=spotify");
    await expect(page).toHaveURL(/\/music$/);
  });
});
