import { expect, test } from "@playwright/test";

/**
 * Traction > Outreach: the Pitch ready card for a "build it first" prospect
 * whose rebuild has a preview.
 *
 * The prospect and its case are real (made through the fixture server's own
 * API). The pitch endpoints are answered in the browser with stubbed data, so
 * no rebuild, browser screenshot, Hermes or mailbox is involved: what is
 * tested is what the card shows and what it asks the server to do. The server
 * side is covered by `server/traction/__tests__/pitch.test.ts`.
 */

const PREVIEW = "https://e2e-pitch-preview.vercel.app";

test("shows a Pitch ready card, drafts, creates the quote from inline prices, and marks the pitch sent", async ({ page, request }) => {
  const created = await request.post("/api/traction/prospects", {
    data: { company: "E2E Pitch Plumbing", contact: "Sipho", email: "sipho@e2e-pitch.example", website: "https://e2e-pitch.example", vetting: "can_help", stage: "target" },
  });
  expect(created.ok()).toBeTruthy();
  const { prospect } = (await created.json()) as { prospect: { id: string } };
  const casePatch = await request.patch(`/api/outreach/cases/${prospect.id}`, {
    data: { by: "you", patch: { path: "build_first", previewUrl: PREVIEW, hook: "No way to book a call-out on a phone.", offer: "A new site with a booking button." } },
  });
  expect(casePatch.ok()).toBeTruthy();

  let status: "ready" | "pitched" = "ready";
  let quote: Record<string, unknown> | undefined;
  const quoteBodies: unknown[] = [];
  const drafts: unknown[] = [];
  const pack = () => ({
    pitch: {
      prospectId: prospect.id,
      company: "E2E Pitch Plumbing",
      status,
      rebuild: { runId: "run-e2e", previewUrl: PREVIEW, stagesDone: 7, stagesTotal: 7 },
      findings: ["No way to book: no form or booking link on the page", "The call button is far down the page on a phone"],
      leak: "About 20 enquiries a month leave the site without calling: R2 580 of ad spend a month.",
      siteChecked: true,
      prices: { setup: "", monthly: "", defaultSetup: "R2 500", defaultMonthly: "R450 a month" },
      quote,
      pitchedAt: status === "pitched" ? "2026-11-02T09:00:00.000Z" : undefined,
      draftReady: drafts.length > 0,
    },
  });

  await page.route("**/api/traction/pitch/*/quote", async (route) => {
    quoteBodies.push(route.request().postDataJSON());
    quote = { entityId: "virtec", entityName: "Virtec", id: "q-1", status: "draft", amountMinor: 295_000 };
    await route.fulfill({ status: 201, json: { quote, created: true } });
  });
  await page.route("**/api/traction/pitch/*/draft", async (route) => {
    drafts.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        case: { prospectId: prospect.id, path: "build_first", previewUrl: PREVIEW, draft: { subject: "Your new site", body: `Hi Sipho\n\n${PREVIEW}` }, draftAt: "2026-11-02T08:00:00.000Z" },
      },
    });
  });
  await page.route("**/api/traction/pitch/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: pack() });
  });
  await page.route("**/api/traction/pitch", (route) => route.fulfill({ json: { pitches: [{ prospectId: prospect.id, status }] } }));
  let manual: { play?: string } | undefined;
  await page.route("**/api/outreach/prospects/*/manual-send", async (route) => {
    manual = route.request().postDataJSON() as { play?: string };
    status = "pitched";
    await route.fulfill({ status: 201, json: { recorded: true, id: "ol-1", at: "2026-11-02T09:00:00.000Z" } });
  });

  await page.goto(`/traction?tab=outreach&prospect=${encodeURIComponent(prospect.id)}`);
  const card = page.getByTestId("pitch-ready");
  await expect(card.getByRole("heading", { name: /Pitch ready/ })).toBeVisible();
  await expect(card.getByRole("link", { name: "Open the preview" })).toHaveAttribute("href", PREVIEW);
  await expect(card.getByText("No way to book: no form or booking link on the page")).toBeVisible();
  await expect(card.getByText(/R2 580 of ad spend/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Take the missing screenshots" })).toBeVisible();

  // No prices set: asked inline, pre-filled from the sender defaults.
  await expect(card.getByLabel("Set-up fee")).toHaveValue("R2 500");
  await expect(card.getByLabel("Monthly price")).toHaveValue("R450 a month");
  await card.getByRole("button", { name: "Save prices and create quote" }).click();
  await expect(card.getByText(/Quote draft in Virtec/)).toBeVisible();
  expect(quoteBodies).toEqual([{ setupPrice: "R2 500", monthlyPrice: "R450 a month" }]);

  await card.getByRole("button", { name: "Draft the pitch email" }).click();
  await expect(card.getByText(/Draft saved in “Write the email” below/)).toBeVisible();
  expect(drafts).toHaveLength(1);
  // The stub stands in for Hermes; the case holds the draft the way the real route leaves it.
  await request.patch(`/api/outreach/cases/${prospect.id}`, { data: { by: "hermes", patch: { draft: { subject: "Your new site", body: `Hi Sipho\n\n${PREVIEW}` } } } });
  await page.reload();
  await expect(card.getByRole("button", { name: "Mark pitch sent" })).toBeEnabled();

  await card.getByRole("button", { name: "Mark pitch sent" }).click();
  await expect(card.getByRole("heading", { name: /Pitched with preview/ })).toBeVisible();
  expect(manual?.play).toBe("website_preview");
});
