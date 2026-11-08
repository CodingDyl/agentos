import { expect, test } from "@playwright/test";

/**
 * A correction cannot be called fixed until a test covers it (or it is marked
 * as untestable, with a reason). Synthetic text only; the mock worker runs the
 * test-writing job for free.
 */

const WRONG = "The agent added the tax twice on the quote";
const EXPECTED = "The tax is added once";

test.describe("Corrections", () => {
  test("report a correction, see it refuse to be fixed, mark it not testable, then fix it", async ({ page }) => {
    await page.goto("/");
    // Today may open on the morning check-in; it is not what this test is about.
    const skip = page.getByRole("button", { name: "Skip today", exact: true });
    await skip.waitFor({ timeout: 5_000 }).catch(() => undefined);
    if (await skip.isVisible()) await skip.click();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("dialog", { name: "Commands and search" }).getByText("Report friction", { exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Report friction" });
    await dialog.getByRole("radio", { name: "Agent got it wrong" }).click();
    await dialog.getByLabel("What did the agent get wrong?").fill(WRONG);
    // A correction has to say what should have happened.
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await dialog.getByLabel("What should have happened?").fill(EXPECTED);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText(/Saved\./)).toBeVisible();

    await page.goto("/operations?tab=friction");
    // In the new friction tab, corrections appear in the "Open" section
    // Find the section by heading text (includes count like "Open (1)")
    const openSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Open/ }) });
    const row = openSection.getByRole("listitem").filter({ hasText: WRONG });
    await expect(row.getByText(`Should have: ${EXPECTED}`)).toBeVisible();
    await expect(row.getByText("Needs a test")).toBeVisible();

    // It refuses to be marked fixed.
    await row.getByRole("button", { name: "Fixed" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /regression test/i })).toBeVisible();
    await expect(row).toBeVisible();

    // A reason is required to call it untestable.
    await row.getByRole("button", { name: "Can't be tested" }).click();
    await expect(row.getByRole("button", { name: "Save" })).toBeDisabled();
    await row.getByLabel("Why it can't be tested").fill("A wording check with nothing to assert");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("Can't be tested").first()).toBeVisible();

    // Now it can be fixed. It's still in the Open section.
    const openSection2 = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Open/ }) });
    await openSection2.getByRole("listitem").filter({ hasText: WRONG }).getByRole("button", { name: "Fixed" }).click();
    await expect(page.getByText("Fixed and ignored (", { exact: false })).toBeVisible();
  });

  test("a test-writing job that changes no test puts the regression back to needed", async ({ request }) => {
    const reported = await request.post("/api/friction", {
      data: { description: "The agent skipped the rounding rule", frequency: "once", severity: "low", kind: "correction", expected: "Amounts round to the cent", source: { type: "manual" } },
    });
    expect(reported.status()).toBe(201);
    const item = (await reported.json()) as { id: string };

    const started = await request.post(`/api/friction/${item.id}/regression-job`, { data: { worker: "mock" } });
    expect(started.status()).toBe(201);
    const { jobId } = (await started.json()) as { jobId: string };

    // The mock worker runs the pipeline for free and stops at review.
    await expect
      .poll(async () => ((await (await request.get(`/api/worker-jobs/${jobId}`)).json()) as { job: { status: string } }).job.status, { timeout: 20_000 })
      .toMatch(/awaiting_review|failed/);
    const tracked = (await (await request.get("/api/friction")).json()) as { open: Array<{ id: string; regression?: { status: string } }> };
    expect(tracked.open.find((entry) => entry.id === item.id)?.regression?.status).toBe("in-progress");

    // Turned down, there is still no test: it goes back to needed, and says why.
    expect((await request.post(`/api/worker-jobs/${jobId}/cancel`)).ok()).toBeTruthy();
    const after = (await (await request.get("/api/friction")).json()) as { open: Array<{ id: string; regression?: { status: string; reason?: string } }> };
    const back = after.open.find((entry) => entry.id === item.id)?.regression;
    expect(back?.status).toBe("needed");
    expect(back?.reason).toMatch(/no test/i);
  });

  test("the API refuses to fix a correction, and refuses an unsafe test path", async ({ request }) => {
    const reported = await request.post("/api/friction", {
      data: { description: "The agent mislabelled the totals", frequency: "once", severity: "low", kind: "correction", expected: "Totals are labelled by month" },
    });
    const item = (await reported.json()) as { id: string };
    const refused = await request.patch(`/api/friction/${item.id}`, { data: { status: "fixed" } });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("regression_required");
    expect((await request.post(`/api/friction/${item.id}/regression`, { data: { status: "covered", testPath: "../escape.test.ts" } })).status()).toBe(400);
    expect((await request.post(`/api/friction/${item.id}/regression`, { data: { status: "not-testable" } })).status()).toBe(400);
  });
});
