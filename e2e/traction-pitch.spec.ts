import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

/** The fixture server's real prospect and case, with the pitch endpoints stubbed. Records what the card asks to draft. */
async function pitchCase(page: Page, request: APIRequestContext, company: string, patch: Record<string, unknown>, stub: { findings?: string[]; quote?: Record<string, unknown> } = {}) {
  const created = await request.post("/api/traction/prospects", {
    data: { company, contact: "Sipho", website: "https://e2e-pitch.example", vetting: "can_help", stage: "target" },
  });
  expect(created.ok()).toBeTruthy();
  const { prospect } = (await created.json()) as { prospect: { id: string } };
  const casePatch = await request.patch(`/api/outreach/cases/${prospect.id}`, { data: { by: "you", patch: { path: "build_first", previewUrl: PREVIEW, ...patch } } });
  expect(casePatch.ok()).toBeTruthy();

  const drafts: unknown[] = [];
  await page.route("**/api/traction/pitch/*/draft", async (route) => {
    drafts.push(route.request().postDataJSON());
    await route.fulfill({ json: { case: { prospectId: prospect.id } } });
  });
  await page.route("**/api/traction/pitch/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        pitch: {
          prospectId: prospect.id,
          company,
          status: "ready",
          rebuild: { runId: "run-e2e", previewUrl: PREVIEW, stagesDone: 7, stagesTotal: 7 },
          findings: stub.findings ?? [],
          siteChecked: true,
          prices: { setup: "R2 500", monthly: "R450 a month", setupMinor: 250_000, monthlyMinor: 45_000, defaultSetup: "", defaultMonthly: "" },
          quote: stub.quote,
          draftReady: false,
        },
      },
    });
  });
  await page.route("**/api/traction/pitch", (route) => route.fulfill({ json: { pitches: [{ prospectId: prospect.id, status: "ready" }] } }));
  await page.goto(`/traction?tab=outreach&prospect=${encodeURIComponent(prospect.id)}`);
  const card = page.getByTestId("pitch-ready");
  await expect(card.getByRole("heading", { name: /Pitch ready/ })).toBeVisible();
  return { id: prospect.id, card, drafts };
}

const savedCase = async (request: APIRequestContext, id: string) => {
  const { cases } = (await (await request.get("/api/outreach/cases")).json()) as { cases: Record<string, { senderId: string; findings: string[]; offer: string }> };
  return cases[id];
};

const firstSenderId = async (request: APIRequestContext) => {
  const { senders } = (await (await request.get("/api/outreach/senders")).json()) as { senders: { id: string }[] };
  return senders[0]?.id;
};

// In file order, on one vault: no companies, then one, then two.
test("with no company yet: says so, adds one in place, and the draft carries on", async ({ page, request }) => {
  const { id, card, drafts } = await pitchCase(page, request, "E2E Pitch No Company", { hook: "No booking.", offer: "A new site." });

  await expect(card.getByText(/You have none yet/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Mark pitch sent" })).toBeDisabled();
  await expect(card.getByText(/Mark pitch sent opens once there is an email to record/)).toBeVisible();

  await card.getByRole("button", { name: "Draft the pitch email" }).click();
  expect(drafts).toHaveLength(0);
  await expect(card.getByText("Add the company and the draft starts.")).toBeVisible();
  await card.getByLabel("Company *").fill("Virtara");
  await card.getByLabel("Shows as from *").fill("Dylan at Virtara");
  await card.getByLabel("Signature and opt-out line *").fill('Dylan, Virtara\nNot for you? Reply "no thanks".');
  await card.getByRole("button", { name: "Add company" }).click();

  await expect(card.getByText(/Draft saved in “Write the email” below/)).toBeVisible();
  expect(drafts).toHaveLength(1);
  expect((await savedCase(request, id)).senderId).toMatch(/^snd_/);
});

test("with one company: offers it, and one press saves it, uses the findings, and drafts", async ({ page, request }) => {
  const { id, card, drafts } = await pitchCase(page, request, "E2E Pitch One Company", { offer: "A new site." }, { findings: ["The copyright says 2021."] });

  await expect(card.getByLabel(/Send as/)).toHaveValue(/^snd_/);
  await expect(card.getByText("Needed first")).toHaveCount(0);
  await card.getByRole("button", { name: "Draft the pitch email" }).click();
  await expect(card.getByText(/Draft saved in “Write the email” below/)).toBeVisible();
  expect(drafts).toHaveLength(1);
  const saved = await savedCase(request, id);
  expect(saved.senderId).toMatch(/^snd_/);
  expect(saved.findings).toEqual(["The copyright says 2021."]);
});

test("with two companies: asks before you press, and choosing after pressing starts the draft", async ({ page, request }) => {
  const second = await request.post("/api/outreach/senders", { data: { company: "Virtec", fromName: "Dylan at Virtec", about: "", website: "", signature: "Dylan, Virtec", defaultMonthly: "", defaultSetup: "", defaultProject: "" } });
  expect(second.ok()).toBeTruthy();
  const { sender } = (await second.json()) as { sender: { id: string } };

  const { id, card, drafts } = await pitchCase(page, request, "E2E Pitch Two Companies", { hook: "No booking." });
  await expect(card.getByText(/Choose which company this email is from/)).toBeVisible();
  await expect(card.getByText("Needed first")).toHaveCount(2);

  // The offer is asked for here too.
  await card.getByLabel(/The offer/).fill("A new site.");
  await card.getByRole("button", { name: "Draft the pitch email" }).click();
  expect(drafts).toHaveLength(0);
  await expect(card.getByText("Choose the company and the draft starts.")).toBeVisible();
  await expect(card.getByLabel(/Send as/)).toBeFocused();

  await card.getByLabel(/Send as/).selectOption(sender.id);
  await expect(card.getByText(/Draft saved in “Write the email” below/)).toBeVisible();
  expect(drafts).toHaveLength(1);
  const saved = await savedCase(request, id);
  expect(saved.senderId).toBe(sender.id);
  expect(saved.offer).toBe("A new site.");

  // The reference to the card below takes you there.
  await card.getByRole("button", { name: "“Write the email”" }).click();
  await expect(page.locator(`[id="write-email-${id}"]`)).toBeFocused();
});

test("a quote in a company you do not send as is not guessed at", async ({ page, request }) => {
  const { card } = await pitchCase(page, request, "E2E Pitch Other Quote", { hook: "No booking.", offer: "A new site." }, { quote: { entityId: "other", entityName: "Other Co", id: "q-2", status: "draft", amountMinor: 100 } });
  await expect(card.getByLabel(/Send as/)).toHaveValue("");
  await expect(card.getByText(/The quote is in Other Co, which is not one of these companies/)).toBeVisible();
});

test("shows a Pitch ready card, drafts, creates the quote from inline prices, and marks the pitch sent", async ({ page, request }) => {
  const created = await request.post("/api/traction/prospects", {
    data: { company: "E2E Pitch Plumbing", contact: "Sipho", email: "sipho@e2e-pitch.example", website: "https://e2e-pitch.example", vetting: "can_help", stage: "target" },
  });
  expect(created.ok()).toBeTruthy();
  const { prospect } = (await created.json()) as { prospect: { id: string } };
  const casePatch = await request.patch(`/api/outreach/cases/${prospect.id}`, {
    data: { by: "you", patch: { path: "build_first", previewUrl: PREVIEW, hook: "No way to book a call-out on a phone.", offer: "A new site with a booking button.", senderId: await firstSenderId(request) } },
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
