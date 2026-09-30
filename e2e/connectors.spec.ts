import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_VAULT } from "../playwright.config";

/**
 * Step 63: the Connector Hub, against the fixture vault.
 *
 * The test adapter has no service credentials, so the vault and git are the
 * only connectors that can be set up; everything else is "not connected" or
 * has no adapter. That is enough to prove the page never calls a service on
 * open, keeps "connected" and "enabled" apart, and that a policy set here is
 * the one the guard reads.
 */

test.describe("Connectors", () => {
  test("sits under System, between Automations and Operations", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("complementary", { name: "Primary navigation" });
    await expect(nav.getByRole("link", { name: /^Connectors/ })).toBeVisible();

    const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const at = hrefs.indexOf("/connectors");
    expect(hrefs[at - 1]).toBe("/automations");
    expect(hrefs[at + 1]).toBe("/operations");
  });

  test("lists what is set up, and what isn't, without secrets", async ({ page }) => {
    await page.goto("/connectors");

    await expect(page.getByRole("heading", { level: 1, name: "Connectors" })).toBeVisible();
    const connected = page.getByRole("region", { name: "Connected" });
    await expect(connected.getByRole("link", { name: "Local filesystem" })).toBeVisible();

    const available = page.getByRole("region", { name: "Available" });
    await expect(available.getByText("Search Console")).toBeVisible();
    await expect(available.getByRole("link", { name: "Connect GitHub" })).toBeVisible();

    // Setup is described by variable names only.
    await page.goto("/connectors/vercel");
    await expect(page.getByText("VERCEL_API_TOKEN").first()).toBeVisible();
  });

  test("switches a connector off for AgentOS and the guard refuses it", async ({ page, request }) => {
    await page.goto("/connectors/git");
    await expect(page.getByRole("heading", { level: 1, name: "Git" })).toBeVisible();

    const toggle = page.getByRole("switch", { name: /Git for AgentOS/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const refused = await request.post("/api/connectors/capabilities/git.commit/check", { data: { initiator: "person" } });
    expect(await refused.json()).toMatchObject({ allowed: false, code: "connector-off" });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("a capability's policy is set per capability and holds agents back", async ({ page, request }) => {
    await page.goto("/connectors/github");

    const merge = page.getByRole("radiogroup", { name: "Policy for Merge to main" });
    await expect(merge.getByRole("radio", { name: "Approval" })).toHaveAttribute("aria-checked", "true");

    const deleteRepo = page.getByRole("radiogroup", { name: "Policy for Delete repositories" });
    await expect(deleteRepo.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");

    const agent = await request.post("/api/connectors/capabilities/github.merge/check", { data: { initiator: "agent" } });
    expect(await agent.json()).toMatchObject({ allowed: false, code: "approval-required" });

    await merge.getByRole("radio", { name: "Off" }).click();
    await expect(merge.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    const person = await request.post("/api/connectors/capabilities/github.merge/check", { data: { initiator: "person" } });
    expect(await person.json()).toMatchObject({ allowed: false, code: "capability-disabled" });

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(merge.getByRole("radio", { name: "Approval" })).toHaveAttribute("aria-checked", "true");
  });

  test("refuses a bodiless write, so another site can't flip a switch", async ({ request }) => {
    const response = await request.post("/api/connectors/gmail/disconnect");
    expect(response.status()).toBe(415);
  });

  test("keys typed on the screen are saved to .env when Enter is pressed, and never shown again", async ({ page }) => {
    // PostHog has no adapter, so nothing here reaches a real service.
    await page.goto("/connectors/posthog");
    const form = page.getByRole("form", { name: "PostHog settings" });

    const key = form.getByRole("textbox", { name: /POSTHOG_API_KEY/ }).or(form.locator('input[name="POSTHOG_API_KEY"]'));
    await expect(key).toHaveAttribute("type", "password");
    await key.fill("phx_e2e_secret");
    await form.locator('input[name="POSTHOG_HOST"]').fill("https://eu.posthog.com");
    await key.press("Enter");

    const steps = page.getByRole("list", { name: "Save & connect" });
    await expect(steps.getByText("Save to .env")).toBeVisible();
    await expect(steps.getByText(/no adapter/)).toBeVisible();

    const env = fs.readFileSync(path.join(path.dirname(E2E_VAULT), ".env"), "utf8");
    expect(env).toContain("POSTHOG_API_KEY=phx_e2e_secret");

    // The key is gone from the page; the non-secret host is shown back.
    await expect(key).toHaveValue("");
    await expect(key).toHaveAttribute("placeholder", /Saved/);
    await expect(form.locator('input[name="POSTHOG_HOST"]')).toHaveAttribute("placeholder", "https://eu.posthog.com");
    expect(await page.content()).not.toContain("phx_e2e_secret");
  });

  test("lists Fish Audio, sharing Jarvis's voice switch", async ({ page }) => {
    await page.goto("/connectors/fish");
    await expect(page.getByRole("heading", { level: 1, name: "Fish Audio" })).toBeVisible();
    await expect(page.getByText("Shared with Jarvis's voice switch: it's the same switch.")).toBeVisible();
    await expect(page.locator('input[name="FISH_API_KEY"]')).toHaveAttribute("type", "password");
  });
});
