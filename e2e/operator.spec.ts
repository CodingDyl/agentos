import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_VAULT } from "../playwright.config";

/**
 * Step 64: Operator, against the fixture vault.
 *
 * Hermes is unreachable and no service has credentials, so this proves the
 * honest path: the plan lists every step of the runbook, blocks what AgentOS
 * can't do here and says why, writes nothing before approval, does what it
 * can after, and records exactly what changed.
 */

const RANKPULSE =
  "Build me a new SEO monitoring SaaS called RankPulse on my SSD, use Next.js and Supabase, create the GitHub repo and deploy it to Vercel.";

test.describe("Operator", () => {
  test("is first under Work", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("complementary", { name: "Primary navigation" });
    const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const at = hrefs.indexOf("/operator");
    expect(at).toBeGreaterThan(-1);
    expect(hrefs[at + 1]).toBe("/workspaces");

    await nav.getByRole("link", { name: /^Operator/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "What do you want to get done?" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Run" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("region", { name: "Runbooks" }).getByText("New SaaS")).toBeVisible();
  });

  test("plans, waits for approval, then does only what it can and records it", async ({ page }) => {
    await page.goto("/operator");
    await page.getByLabel("What do you want to get done?").fill(RANKPULSE);
    await page.getByRole("button", { name: "Run", exact: true }).click();

    await expect(page).toHaveURL(/\/operator\/runs\/run_/);
    const run = page.getByRole("article");
    await expect(run.getByText("Needs approval")).toBeVisible();

    // Decisions, not reasoning.
    const decisions = run.getByRole("region", { name: "How AgentOS read this" });
    await expect(decisions.getByText("New software project")).toBeVisible();
    await expect(decisions.getByText("Create · RankPulse")).toBeVisible();
    // The effective risk: the external steps can't run here, so only local writes will happen.
    await expect(decisions.getByText("Local writes")).toBeVisible();

    // Every runbook step is listed; the ones with no adapter say so.
    const plan = run.getByRole("region", { name: "Plan" });
    await expect(plan.getByText("Create GitHub repository")).toBeVisible();
    await expect(plan.getByText(/Create repositories.*isn't built into AgentOS yet/)).toBeVisible();
    await expect(plan.getByText(/Waits on “Deploy production”/)).toBeVisible();

    // Nothing written yet.
    expect(fs.existsSync(path.join(E2E_VAULT, "projects", "rank-pulse"))).toBe(false);
    await expect(run.getByRole("button", { name: "Stop run" })).toBeVisible();

    await run.getByRole("button", { name: "Approve & run" }).click();
    await expect(run.getByText("Stopped short")).toBeVisible({ timeout: 15_000 });
    await expect(run.getByRole("button", { name: "Stop run" })).toHaveCount(0);

    expect(fs.existsSync(path.join(E2E_VAULT, "projects", "rank-pulse", "PROJECT.md"))).toBe(true);
    const audit = run.getByRole("region", { name: "Audit" });
    await expect(audit.getByRole("link", { name: "Workspace RankPulse created" })).toBeVisible();

    // The stack is an interpretation: proposed, not written.
    const memory = run.getByRole("region", { name: "Proposed memory" });
    await expect(memory.getByText("Stack")).toBeVisible();
    await memory.getByRole("button", { name: "Accept" }).click();
    await expect(memory.getByText("accepted")).toBeVisible();
    expect(fs.readFileSync(path.join(E2E_VAULT, "projects", "rank-pulse", "DECISIONS.md"), "utf8")).toMatch(/Next\.js, Supabase/);

    await expect(page.getByRole("complementary", { name: "Recent runs" }).getByText("RankPulse")).toBeVisible();
  });

  test("Plan mode executes nothing", async ({ page }) => {
    await page.goto("/operator");
    await page.getByRole("radio", { name: "Plan" }).click();
    await page.getByLabel("What do you want to get done?").fill("Build me a new app called Plan Only with Next.js and deploy it to Vercel");
    await page.getByRole("button", { name: "Plan", exact: true }).click();

    const run = page.getByRole("article");
    await expect(run.getByText("Plan ready:")).toBeVisible({ timeout: 15_000 });
    await expect(run.getByRole("button", { name: "Run this plan" })).toBeVisible();
    expect(fs.existsSync(path.join(E2E_VAULT, "projects", "plan-only"))).toBe(false);
  });

  test("Stop halts a run waiting for approval and reports nothing changed", async ({ page }) => {
    await page.goto("/operator");
    await page.getByLabel("What do you want to get done?").fill("Add a pricing page to Pantry Pilot.");
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const run = page.getByRole("article");
    await expect(run.getByText("Needs approval")).toBeVisible();
    await expect(run.getByRole("region", { name: "Approval" }).getByText("File the task in Pantry Pilot")).toBeVisible();
    await run.getByRole("button", { name: "Stop run" }).click();

    await expect(run.getByText("Stopped", { exact: true }).first()).toBeVisible();
    await expect(run.getByText("Nothing. No file, task or service was changed by this run.")).toBeVisible();
    expect(fs.readFileSync(path.join(E2E_VAULT, "projects", "pantry-pilot", "TASKS.md"), "utf8")).not.toMatch(/pricing page/i);
  });

  test("Ask is read-only, and says so when Hermes can't answer", async ({ page }) => {
    await page.goto("/operator");
    await page.getByRole("radio", { name: "Ask" }).click();
    await page.getByLabel("What do you want to get done?").fill("What are the biggest problems with Virtara?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    const run = page.getByRole("article");
    await expect(run.getByText("Failed", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(run.getByRole("region", { name: "Plan" }).getByText("Read Virtara: Done")).toBeVisible();
    await expect(run.getByText("Nothing. No file, task or service was changed by this run.")).toBeVisible();
  });
});
