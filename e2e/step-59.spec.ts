import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_VAULT } from "../playwright.config";

/**
 * Step 59's core journeys, against the fixture vault:
 *
 *   Pantry Pilot   Product, High — tasks, a milestone, a report from PP-002
 *   Virtara        "Agency / Client Work", configured as a business
 *   AgentOS        Software
 *   Story Keeper   Blocked — the attention item Today should surface
 */

test.describe("Today", () => {
  test("answers what today looks like and leads to the work that needs attention", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText(/Good (morning|afternoon|evening), Dylan/)).toBeVisible();
    // 2 Pantry Pilot + 2 Virtara + 1 AgentOS + 1 Story Keeper open Now tasks.
    await expect(page.getByText("6 tasks across 4 workspaces")).toBeVisible();

    const needsYou = page.locator("#needs-you");
    await expect(needsYou.getByText("Story Keeper").first()).toBeVisible();
    await needsYou.getByRole("link", { name: /Story Keeper/ }).first().click();

    await expect(page).toHaveURL(/\/workspaces\/story-keeper$/);
    await expect(page.getByRole("heading", { level: 1, name: "Story Keeper" })).toBeVisible();
    // An exact portfolio type ("Client Work") is derived; nothing is guessed.
    await expect(page.getByRole("tab", { name: "Milestones" })).toBeVisible();
  });

  test("the sidebar leads with the work, not the machinery", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("complementary", { name: "Primary navigation" });

    for (const label of ["Today", "Inbox", "Workspaces", "Knowledge", "Creative", "Automations", "Operations", "Activity"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: /^Workers$/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^Agent$/ })).toHaveCount(0);
    // The one high-priority active workspace is pinned by default.
    await expect(nav.getByRole("list", { name: "Pinned workspaces" }).getByRole("link", { name: "Pantry Pilot" })).toBeVisible();
  });
});

test.describe("Workspaces", () => {
  test("Pantry Pilot's task CRUD still works", async ({ page }) => {
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /Pantry Pilot/ }).first().click();
    await expect(page).toHaveURL(/\/workspaces\/pantry-pilot$/);

    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page).toHaveURL(/tab=tasks/);

    const input = page.getByPlaceholder("What needs doing");
    await input.fill("Write the beta release notes");
    await input.press("Enter");

    await expect(page.getByText("Write the beta release notes")).toBeVisible();
    await expect
      .poll(() => fs.readFileSync(path.join(E2E_VAULT, "projects/pantry-pilot/TASKS.md"), "utf8"))
      .toMatch(/- \[ \] \[PP-\d+\] Write the beta release notes/);
    const id = /\[(PP-\d+)\] Write the beta release notes/.exec(
      fs.readFileSync(path.join(E2E_VAULT, "projects/pantry-pilot/TASKS.md"), "utf8"),
    )?.[1];

    // Complete it: the checkbox writes the file.
    await page.getByRole("button", { name: `Complete ${id}` }).click();
    await expect
      .poll(() => fs.readFileSync(path.join(E2E_VAULT, "projects/pantry-pilot/TASKS.md"), "utf8"))
      .toMatch(/- \[x\] \[PP-\d+\] Write the beta release notes/);
  });

  test("a business workspace needs no repository and gets a business Overview", async ({ page }) => {
    await page.goto("/workspaces/virtara");

    await expect(page.getByRole("heading", { level: 1, name: "Virtara" })).toBeVisible();
    await expect(page.getByText("Business", { exact: true })).toBeVisible();

    const tabs = page.getByRole("tablist", { name: "Workspace sections" });
    await expect(tabs.getByRole("tab", { name: "Clients" })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Repository" })).toHaveCount(0);
    await expect(tabs.getByRole("tab", { name: "Agents" })).toHaveCount(0);

    await expect(page.getByText("Build a profitable owner-run digital agency.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next actions" })).toBeVisible();
    await expect(page.getByText("VA-018")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repository" })).toHaveCount(0);

    // Hidden, never removed: Repository is one click away under More.
    await page.getByRole("button", { name: "More sections" }).click();
    await expect(page.getByRole("menuitem", { name: "Repository" })).toBeVisible();
  });

  test("a software workspace keeps Repository and Agents up front", async ({ page }) => {
    await page.goto("/workspaces/agentos");

    const tabs = page.getByRole("tablist", { name: "Workspace sections" });
    await expect(tabs.getByRole("tab", { name: "Repository" })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Agents" })).toBeVisible();

    await tabs.getByRole("tab", { name: "Agents" }).click();
    await expect(page).toHaveURL(/tab=agents/);
  });
});

test.describe("Knowledge", () => {
  test("finds a workspace document, opens it, and leads back to its task", async ({ page }) => {
    await page.goto("/knowledge");

    await page.getByRole("searchbox", { name: "Search knowledge" }).fill("technical debt");
    await page.getByRole("link", { name: /Code Duplication & Technical Debt Report/ }).click();

    await expect(page).toHaveURL(/\/workspaces\/pantry-pilot\?tab=documents&doc=/);
    await expect(page.getByRole("heading", { name: "Code Duplication & Technical Debt Report" }).first()).toBeVisible();
    await expect(page.getByText("Three duplicated recipe parsers were found.")).toBeVisible();

    await page.getByRole("link", { name: /PP-002/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/pantry-pilot\?tab=tasks&task=PP-002/);
  });

  test("filters by workspace, in the URL", async ({ page }) => {
    await page.goto("/knowledge");

    await page.getByRole("combobox", { name: "Workspace" }).selectOption("virtara");
    await expect(page.getByRole("link", { name: /Pricing/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Chef UX Analysis/ })).toHaveCount(0);
    await expect(page).toHaveURL(/workspace=virtara/);
  });
});

test.describe("Capture", () => {
  test("saves straight to the inbox, with no agent in the way", async ({ page }) => {
    await page.goto("/workspaces");

    await page.getByRole("button", { name: "Capture a note" }).click();
    const dialog = page.getByRole("dialog", { name: "Capture" });
    await dialog.getByRole("combobox").selectOption("story-keeper");
    await dialog.getByRole("textbox").fill("Need to update Story Keeper checkout copy");
    await dialog.getByRole("button", { name: "Capture", exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => fs.readFileSync(path.join(E2E_VAULT, "inbox/CAPTURE.md"), "utf8"))
      .toContain("- Need to update Story Keeper checkout copy (for Story Keeper)");
  });
});

test.describe("Compatibility", () => {
  test("old project links land on the right workspace, query string intact", async ({ page }) => {
    await page.goto("/projects/pantry-pilot?tab=roadmap");
    await expect(page).toHaveURL(/\/workspaces\/pantry-pilot\?tab=roadmap$/);
    await expect(page.getByRole("tab", { name: "Roadmap", selected: true })).toBeVisible();

    await page.goto("/projects");
    await expect(page).toHaveURL(/\/workspaces$/);

    await page.goto("/mail");
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();

    // The old tab name for Creative still opens it.
    await page.goto("/workspaces/pantry-pilot?tab=designs");
    await expect(page.getByRole("tab", { name: "Creative", selected: true })).toBeVisible();
  });

  test("the workers page is reached from Agents and still loads", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("complementary", { name: "Primary navigation" }).getByRole("link", { name: "Agents" }).click();
    await expect(page).toHaveURL(/\/workers$/);
    await expect(page.locator("[data-agentos-page]")).toHaveAttribute("data-agentos-page", "workers");
    await expect(page.getByRole("link", { name: "Agents", current: "page" })).toBeVisible();

    await page.goto("/operations?tab=system");
    await expect(page.getByRole("tab", { name: "System", selected: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Worker jobs" }).first()).toBeVisible();
  });

  test("⌘K offers everyday creation and navigation", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");

    const palette = page.getByRole("dialog", { name: "Commands and search" });
    for (const label of ["New task", "Capture note", "New document", "New workspace", "Add decision", "Upload creative asset", "Start focus", "Delegate task", "Ask Hermes"]) {
      await expect(palette.getByText(label, { exact: true })).toBeVisible();
    }
  });
});

test.describe("Cancelling a job", () => {
  test("a worker's finished job can be cancelled from the workers page", async ({ page, request }) => {
    // The mock worker runs the whole pipeline for free and stops at review.
    const created = await request.post("/api/worker-jobs", {
      data: { worker: "mock", project: "agentos", objective: "Finished work nobody wants" },
    });
    expect(created.ok()).toBeTruthy();
    const { job } = (await created.json()) as { job: { id: string } };

    await expect
      .poll(async () => ((await (await request.get(`/api/worker-jobs/${job.id}`)).json()) as { job: { status: string } }).job.status, {
        timeout: 20_000,
      })
      .toMatch(/awaiting_review|failed/);

    await page.goto("/workers");
    const row = page.getByRole("listitem").filter({ hasText: "Finished work nobody wants" }).first();
    await expect(row.getByText(/Busy with|Finished work nobody wants/).first()).toBeVisible();
    await row.getByRole("button", { name: "Cancel Finished work nobody wants" }).click();
    await row.getByRole("button", { name: "Yes" }).click();

    await expect
      .poll(async () => ((await (await request.get(`/api/worker-jobs/${job.id}`)).json()) as { job: { status: string } }).job.status)
      .toBe("cancelled");
  });
});
