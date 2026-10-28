import { expect, test, type Page } from "@playwright/test";

/**
 * Traction > Find > Find by niche, against the fixture vault.
 *
 * Google is never called: the two Places routes are answered in the browser,
 * so the page's own behaviour is what is tested (what it asks for, how it
 * orders and labels the answer, what importing does). The real server side is
 * covered by `server/places/__tests__`.
 */

const budget = { cap: 200, used: 4, remaining: 196, month: "2026-10" };

const niches = {
  niches: [
    { id: "dentists", label: "Dentists and orthodontists", query: "dentist", why: "High lifetime value per patient.", caveat: "Many belong to group chains." },
    { id: "law_firms", label: "Law firms", query: "attorneys law firm", why: "Referral-heavy practices.", caveat: "The Legal Practice Council limits advertising claims." },
  ],
  radius: { min: 5, max: 15 },
  configured: true,
  budget,
};

const candidate = (placeId: string, name: string, websiteKind: "none" | "social" | "own", distanceKm: number, website?: string) => ({
  placeId,
  name,
  address: "1 Rivonia Rd, Sandton",
  website,
  websiteKind,
  lat: -26.1,
  lng: 28.05,
  distanceKm,
});

async function stubPlaces(page: Page, overrides: { niches?: unknown } = {}) {
  const searches: unknown[] = [];
  await page.route("**/api/traction/places/niches", (route) => route.fulfill({ json: overrides.niches ?? niches }));
  await page.route("**/api/traction/places/search", async (route) => {
    searches.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        result: {
          area: { name: "Sandton", lat: -26.1076, lng: 28.0567 },
          nicheId: "law_firms",
          radiusKm: 10,
          requests: 2,
          candidates: [
            candidate("own", "E2E Own Site Attorneys", "own", 1.2, "https://www.e2e-own-attorneys.example/contact"),
            candidate("dated", "E2E Dated Site Attorneys", "own", 2.4, "https://www.e2e-dated-attorneys.example/"),
            candidate("none", "E2E No Site Attorneys", "none", 6.5),
            candidate("social", "E2E Social Only Attorneys", "social", 3.1, "https://www.facebook.com/e2esocial"),
          ],
        },
        budget: { ...budget, used: 6, remaining: 194 },
      },
    });
  });

  const siteChecks: unknown[] = [];
  await page.route("**/api/traction/places/check-sites", async (route) => {
    siteChecks.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        checks: [
          { website: "https://www.e2e-own-attorneys.example/contact", reachable: true, problems: ["No contact form"], score: 1 },
          {
            website: "https://www.e2e-dated-attorneys.example/",
            reachable: true,
            problems: ["Not secure: the site has no HTTPS", "Not built for phones: no mobile viewport", "Looks abandoned: the footer says © 2014", "No contact form"],
            score: 9,
          },
        ],
      },
    });
  });
  return { searches, siteChecks };
}

test.describe("Find by niche", () => {
  test("searches a niche and area, lists the weakest web presence first, and adds one to To check", async ({ page }) => {
    const { searches, siteChecks } = await stubPlaces(page);
    await page.goto("/traction?tab=find");

    await page.getByRole("button", { name: "Search Google Places" }).click();
    const form = page.getByRole("form", { name: "Search Google Places" });
    await expect(form.getByText("196 of 200 left this month")).toBeVisible();

    await form.getByLabel("Niche").selectOption("law_firms");
    await expect(form.getByText("The Legal Practice Council limits advertising claims.")).toBeVisible();
    await form.getByLabel("Area").fill("Sandton");
    await form.getByLabel("Radius").selectOption("10");
    await form.getByRole("button", { name: "Search", exact: true }).click();

    expect(searches).toEqual([{ area: "Sandton", nicheId: "law_firms", radiusKm: 10 }]);

    const names = page.locator("h3").filter({ hasText: /^E2E / });
    // Only their own sites are read, and the one with the most wrong comes first among them.
    await expect(names).toHaveText(["E2E No Site Attorneys", "E2E Social Only Attorneys", "E2E Dated Site Attorneys", "E2E Own Site Attorneys"]);
    expect(siteChecks).toEqual([{ websites: ["https://www.e2e-own-attorneys.example/contact", "https://www.e2e-dated-attorneys.example/"] }]);
    const dated = page.getByRole("listitem").filter({ hasText: "E2E Dated Site Attorneys" }).first();
    await expect(dated.getByText("9/10 to fix")).toBeVisible();
    await expect(dated.getByText("Not secure: the site has no HTTPS · Not built for phones: no mobile viewport · Looks abandoned: the footer says © 2014")).toBeVisible();

    // Adding it carries what was found into the prospect's reasons, and leaves the observation for you.
    const created = page.waitForRequest((request) => request.url().endsWith("/api/traction/prospects") && request.method() === "POST");
    await dated.getByRole("button", { name: "Add E2E Dated Site Attorneys to To check" }).click();
    const body = (await created).postDataJSON() as { reasons: string[]; observation?: string };
    expect(body.reasons).toContain("Not secure: the site has no HTTPS");
    expect(body.observation).toBeUndefined();
    await expect(dated.getByText("In your list")).toBeVisible();

    await page.getByRole("button", { name: "Add E2E No Site Attorneys to To check" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "E2E No Site Attorneys" }).first();
    await expect(row.getByText("In your list")).toBeVisible();

    // It is now a prospect waiting for a verdict, in the list below the search.
    await expect(page.getByRole("button", { name: "Check E2E No Site Attorneys" })).toBeVisible();
  });

  test("says why it cannot search when no monthly cap is set, and does not offer the button", async ({ page }) => {
    await stubPlaces(page, { niches: { ...niches, budget: { ...budget, cap: 0, used: 0, remaining: 0 } } });
    await page.goto("/traction?tab=find");

    await page.getByRole("button", { name: "Search Google Places" }).click();
    const form = page.getByRole("form", { name: "Search Google Places" });
    await expect(form.getByRole("alert")).toContainText("AGENTOS_PLACES_MONTHLY_REQUEST_CAP");
    await expect(form.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  });
});
