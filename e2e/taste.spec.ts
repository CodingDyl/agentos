import { expect, test } from "@playwright/test";

// A 1x1 PNG: enough for the library to store and serve as an image.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test.describe("Taste Vault", () => {
  test("keeps a reference, attaches it to a workspace, and shows it under that workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Taste Vault", exact: true }).click();
    await expect(page).toHaveURL(/\/taste$/);
    await expect(page.getByRole("heading", { name: "Taste Vault", level: 1 })).toBeVisible();
    await expect(page.getByText("Nothing in the vault yet")).toBeVisible();
    await expect(page.getByText(/Claude is shown it before any design work there/)).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({ name: "taste-e2e.png", mimeType: "image/png", buffer: PNG });
    const tile = page.getByRole("button", { name: "Open taste-e2e.png" });
    await expect(tile).toBeVisible();

    // Not attached anywhere yet, so the workspace's view of the vault is empty.
    await page.goto("/taste?workspace=pantry-pilot");
    await expect(page.getByText("Nothing attached to Pantry Pilot")).toBeVisible();
    await page.getByRole("button", { name: "Show all references" }).click();
    await expect(page).toHaveURL(/\/taste$/);

    await tile.click();
    const detail = page.getByRole("dialog", { name: "taste-e2e.png" });
    await detail.getByLabel("Why I like it").fill("Quiet, and one clear action");
    await detail.getByLabel("Tags").fill("calm, hero");
    await detail.getByLabel("Tags").press("Enter");
    const attach = detail.getByRole("switch", { name: "Attach to Pantry Pilot" });
    await attach.click();
    await expect(attach).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    // The filter, chosen from the toolbar, writes the workspace into the URL.
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("dialog", { name: "Filters" }).getByText("Pantry Pilot", { exact: true }).click();
    await expect(page).toHaveURL(/\/taste\?workspace=pantry-pilot$/);
    await expect(page.getByRole("heading", { name: "Attached to Pantry Pilot" })).toBeVisible();
    await expect(tile).toBeVisible();

    // Another workspace does not see it; search finds it by its why-note.
    await page.goto("/taste?workspace=story-keeper");
    await expect(tile).toHaveCount(0);
    await page.goto("/taste");
    await page.getByLabel("Search references").fill("clear action");
    await expect(tile).toBeVisible();
    await page.getByLabel("Search references").fill("no such thing");
    await expect(page.getByText("No matches")).toBeVisible();

    // The workspace's own Creative tab shows what is attached to it.
    await page.goto("/workspaces/pantry-pilot?tab=designs");
    await expect(page.getByRole("heading", { name: "Taste references" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Taste Vault" })).toHaveAttribute("href", "/taste?workspace=pantry-pilot");
  });
});
