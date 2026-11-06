import { expect, test, type Page } from "@playwright/test";

/**
 * Composio on the Connectors page. The test adapter has no key, so the real
 * "not set up" state is checked against it, and the connected states answer
 * from fixtures: no test talks to Composio.
 */

const logo = (letter: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#222"/><text x="12" y="17" font-size="14" text-anchor="middle" fill="#fff">${letter}</text></svg>`)}`;

const appsResponse = {
  configured: true,
  enabled: true,
  apps: [
    {
      slug: "linear",
      name: "Linear",
      logo: logo("L"),
      accounts: [{ id: "ca_old", label: "brave-otter", status: "EXPIRED", statusReason: "The refresh token was revoked." }],
      enabled: true,
      policies: { read: "allowed", change: "approval", delete: "disabled" },
      overridden: [],
    },
    {
      slug: "notion",
      name: "Notion",
      logo: logo("N"),
      accounts: [
        { id: "ca_work", label: "Work", status: "ACTIVE" },
        { id: "ca_home", label: "Personal", status: "ACTIVE" },
      ],
      enabled: true,
      policies: { read: "allowed", change: "allowed", delete: "disabled" },
      overridden: ["change"],
    },
  ],
};

const catalog = {
  items: [
    { slug: "notion", name: "Notion", description: "Pages, databases and notes.", logo: logo("N"), toolsCount: 42, noAuth: false },
    { slug: "slack", name: "Slack", description: "Channels and messages for your team, with a description long enough to have to be cut off on a phone.", logo: logo("S"), toolsCount: 130, noAuth: false },
    { slug: "hackernews", name: "Hacker News", description: "Stories and comments.", toolsCount: 8, noAuth: true },
  ],
  nextCursor: "page-2",
  total: 1728,
};

async function answerFromFixtures(page: Page) {
  const patches: unknown[] = [];
  const searches: string[] = [];
  await page.route("**/api/composio/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/apps") && request.method() === "GET") return route.fulfill({ json: appsResponse });
    if (url.pathname.includes("/apps/")) {
      patches.push(request.postDataJSON());
      return route.fulfill({ json: appsResponse });
    }
    if (url.pathname.endsWith("/categories")) return route.fulfill({ json: { categories: [{ id: "crm", name: "CRM" }] } });
    if (url.pathname.endsWith("/toolkits")) {
      searches.push(url.searchParams.get("search") ?? "");
      if (url.searchParams.get("search") === "zzz") return route.fulfill({ json: { items: [], total: 0 } });
      if (url.searchParams.get("search") === "custom") return route.fulfill({ json: { items: [{ slug: "acme", name: "Acme", noAuth: false }], total: 1 } });
      return route.fulfill({ json: url.searchParams.get("cursor") ? { items: [{ slug: "github", name: "GitHub", noAuth: false }], total: 1728 } : catalog });
    }
    if (url.pathname.endsWith("/connect")) {
      if ((request.postDataJSON() as { toolkit: string }).toolkit === "acme") return route.fulfill({ status: 502, json: { error: "Acme needs its own app credentials in Composio." } });
      return route.fulfill({ json: { redirectUrl: "https://example.com/sign-in" } });
    }
    return route.fulfill({ status: 404, json: { error: "unexpected" } });
  });
  return { patches, searches };
}

test.describe("Composio on Connectors", () => {
  test("without a key it offers setup and asks Composio nothing", async ({ page }) => {
    const outbound: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/composio\/(toolkits|categories)/.test(request.url())) outbound.push(request.url());
    });

    await page.goto("/connectors");
    const section = page.getByRole("region", { name: "Apps through Composio" });
    await expect(section.getByRole("link", { name: "Add your key" })).toHaveAttribute("href", "/connectors/composio");
    await expect(section.getByLabel("Find an app")).toHaveCount(0);
    expect(outbound).toEqual([]);

    await section.getByRole("link", { name: "Add your key" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Composio" })).toBeVisible();
    await expect(page.getByText("composio.read")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /COMPOSIO_API_KEY/ })).toHaveAttribute("type", "password");
  });

  test("shows connected apps, lets each be limited, and marks what needs signing in", async ({ page }, info) => {
    const { patches } = await answerFromFixtures(page);
    await page.goto("/connectors#composio");

    const section = page.getByRole("region", { name: "Apps through Composio" });
    await expect(section.getByText(/^Linear/).first()).toBeVisible();
    await expect(section.getByText("Signed out", { exact: true })).toBeVisible();
    await expect(section.getByText("2 accounts · Reads allowed · changes allowed · deletes off")).toBeVisible();

    await section.getByRole("switch", { name: "Stop agents using Notion" }).click();
    await expect.poll(() => patches.at(-1)).toEqual({ enabled: false });

    await section.getByRole("button", { name: "Manage Notion" }).click();
    await section.getByRole("radiogroup", { name: "Deleting and moving money in Notion" }).getByRole("radio", { name: "Approval" }).click();
    await expect.poll(() => patches.at(-1)).toEqual({ policies: { delete: "approval" } });
    await section.getByRole("button", { name: "Reset Creating, updating and sending for Notion" }).click();
    await expect.poll(() => patches.at(-1)).toEqual({ policies: { change: null } });

    await section.getByRole("button", { name: "Disconnect Personal" }).click();
    await expect(section.getByRole("group", { name: "Confirm disconnecting Personal" })).toBeVisible();

    await section.screenshot({ path: info.outputPath("composio-desktop.png") });
  });

  test("searches the catalog and starts a sign-in in a new tab", async ({ page, context }) => {
    const { searches } = await answerFromFixtures(page);
    await page.goto("/connectors#composio");
    const section = page.getByRole("region", { name: "Apps through Composio" });

    await expect(section.getByText(/^1\s728 apps$/)).toBeVisible();
    await expect(section.getByRole("listitem").filter({ hasText: "Pages, databases and notes." }).getByText("Connected")).toBeVisible();
    await expect(section.getByText("No sign-in needed")).toBeVisible();

    await section.getByRole("button", { name: "Show more" }).click();
    await expect(section.getByText("GitHub")).toBeVisible();

    await page.route("https://example.com/**", (route) => route.fulfill({ body: "Composio sign-in" }));
    const popup = context.waitForEvent("page");
    await section.getByRole("button", { name: "Connect Slack" }).click();
    await expect.poll(async () => (await popup).url()).toContain("https://example.com/sign-in");
    await expect(section.getByText("Finish signing in on Composio's page.")).toBeVisible();

    await section.getByLabel("Find an app").fill("zzz");
    await expect(section.getByText("Nothing matches “zzz”.")).toBeVisible();
    expect(searches.at(-1)).toBe("zzz");
  });

  test("says why when an app can't be connected", async ({ page }) => {
    await answerFromFixtures(page);
    await page.goto("/connectors#composio");
    const section = page.getByRole("region", { name: "Apps through Composio" });

    await section.getByLabel("Find an app").fill("custom");
    await section.getByRole("button", { name: "Connect Acme" }).click();
    await expect(section.getByRole("alert")).toHaveText("Acme needs its own app credentials in Composio.");
  });

  test("fits a phone without sideways scrolling", async ({ page }, info) => {
    await answerFromFixtures(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/connectors#composio");
    const section = page.getByRole("region", { name: "Apps through Composio" });
    await section.getByRole("button", { name: "Manage Notion" }).click();
    await expect(section.getByText("What agents may do")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await section.screenshot({ path: info.outputPath("composio-mobile.png") });
  });
});
