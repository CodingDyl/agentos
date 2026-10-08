import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_VAULT } from "../playwright.config";

/**
 * Operator, against the fixture vault.
 *
 * Hermes is unreachable and no service has credentials, so this proves the
 * honest path: every runbook step is listed, what AgentOS can't do here is
 * blocked with the reason, nothing is written before approval, and what can
 * run does. Project folders go into a throwaway stand-in for the SSD.
 *
 * There is no microphone here, so Jarvis is driven through his text box: the
 * same `send` a transcript goes through.
 */

const PROJECTS = path.join(os.tmpdir(), "agentos-e2e", "projects");
const RANKPULSE =
  "Build me a new SEO monitoring SaaS called RankPulse on my SSD, use Next.js and Supabase, create the GitHub repo and deploy it to Vercel.";

async function send(page: Page, text: string, mode: "Ask" | "Plan" | "Run" = "Run") {
  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: mode }).click();
  await page.getByLabel("What do you want to get done?").fill(text);
  await page.getByLabel("What do you want to get done?").press("Enter");
}

/** The newest reply in the conversation. */
const lastReply = (page: Page) => page.getByRole("region", { name: "Conversation" }).getByRole("listitem", { name: /^Request:/ }).last();

test.describe("Operator", () => {
  test("is first under Work, opens on a new chat, and keeps planned runs with Jarvis", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("complementary", { name: "Primary navigation" });
    const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs[hrefs.indexOf("/operator") + 1]).toBe("/workspaces");

    await nav.getByRole("link", { name: /^Operator/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New chat" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Chat history" }).getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Message" }).getByLabel("Agent and model")).toBeVisible();

    await page.getByRole("link", { name: "Planned runs and their audit trail" }).click();
    await expect(page).toHaveURL(/\/operator\/runs$/);
    await expect(page.getByRole("heading", { level: 1, name: "What do you want to get done?" })).toBeVisible();
    const jarvis = page.getByRole("region", { name: "Jarvis" });
    await expect(jarvis.getByRole("button", { name: "Talk to Jarvis" })).toBeVisible();
    await expect(jarvis.getByText("“Approve”")).toBeVisible();
    await expect(page.getByRole("region", { name: "Runbooks" }).getByText("New SaaS")).toBeVisible();
  });

  test("a run is a message: approve in the thread, breakdown at the end, everything in the details", async ({ page }) => {
    await page.goto("/operator/runs");
    await send(page, RANKPULSE);

    const reply = lastReply(page);
    await expect(reply.getByText(RANKPULSE)).toBeVisible();
    await expect(reply.getByText(/New software project: RankPulse\. \d+ of 14 steps can run here\. Nothing has run yet\./)).toBeVisible();
    await expect(reply.getByText("Create project folder")).toBeVisible();

    // Nothing written before approval.
    expect(fs.existsSync(path.join(PROJECTS, "rank-pulse"))).toBe(false);
    expect(fs.existsSync(path.join(E2E_VAULT, "projects", "rank-pulse"))).toBe(false);
    await expect(page.getByRole("button", { name: "Stop the current run" })).toBeVisible();

    await reply.getByRole("button", { name: "Approve & run" }).click();
    await expect(reply.getByText(/Finished what I could/)).toBeVisible({ timeout: 15_000 });

    // The folder, on the "SSD", and the workspace linked to it.
    expect(fs.statSync(path.join(PROJECTS, "rank-pulse")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(E2E_VAULT, "projects", "rank-pulse", "PROJECT.md"), "utf8")).toContain(path.join(PROJECTS, "rank-pulse"));

    const changed = reply.getByText("What changed");
    await expect(changed).toBeVisible();
    await expect(reply.getByText(/Folder created: .*rank-pulse/)).toBeVisible();
    await expect(reply.getByRole("link", { name: "Workspace RankPulse created" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop the current run" })).toHaveCount(0);

    // The full record opens from the message.
    await reply.getByRole("button", { name: /^Details of/ }).click();
    await expect(page).toHaveURL(/\/operator\/runs\/run_/);
    const details = page.getByRole("dialog", { name: "Run details" });
    await expect(details.getByRole("region", { name: "How AgentOS read this" }).getByText("Create · RankPulse")).toBeVisible();
    await expect(details.getByText(/Create repositories.*isn't built into AgentOS yet/)).toBeVisible();

    const memory = details.getByRole("region", { name: "Proposed memory" });
    await memory.getByRole("button", { name: "Accept" }).click();
    await expect(memory.getByText("accepted")).toBeVisible();
    expect(fs.readFileSync(path.join(E2E_VAULT, "projects", "rank-pulse", "DECISIONS.md"), "utf8")).toMatch(/Next\.js, Supabase/);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/operator\/runs$/);
  });

  test("a folder that already exists is refused, not reused", async ({ page }) => {
    fs.mkdirSync(path.join(PROJECTS, "taken-name"), { recursive: true });
    fs.writeFileSync(path.join(PROJECTS, "taken-name", "keep.txt"), "mine");

    await page.goto("/operator/runs");
    await send(page, "Build me a new app called Taken Name with Next.js", "Plan");
    const reply = lastReply(page);
    await expect(reply.getByText(/Plan ready/)).toBeVisible({ timeout: 15_000 });

    await reply.getByRole("button", { name: /^Details of/ }).click();
    await expect(page.getByRole("dialog", { name: "Run details" }).getByText(/taken-name already exists/)).toBeVisible();
    expect(fs.readFileSync(path.join(PROJECTS, "taken-name", "keep.txt"), "utf8")).toBe("mine");
  });

  test("Plan mode executes nothing and offers to run it", async ({ page }) => {
    await page.goto("/operator/runs");
    await send(page, "Build me a new app called Plan Only with Next.js and deploy it to Vercel", "Plan");
    const reply = lastReply(page);
    await expect(reply.getByText(/Plan ready/)).toBeVisible({ timeout: 15_000 });
    await expect(reply.getByText("Would run")).toBeVisible();
    await expect(reply.getByRole("button", { name: "Run this plan" })).toBeVisible();
    expect(fs.existsSync(path.join(PROJECTS, "plan-only"))).toBe(false);
    expect(fs.existsSync(path.join(E2E_VAULT, "projects", "plan-only"))).toBe(false);
  });

  test("a chat starts a planned run with /plan, and keeps it in the conversation", async ({ page }) => {
    await page.goto("/operator");
    const composer = page.getByRole("form", { name: "Message" });
    await composer.getByRole("textbox", { name: "Message" }).fill("/plan Build me a new app called Chat Plan with Next.js and deploy it to Vercel");
    await composer.getByRole("button", { name: "Send" }).click();

    await expect(page).toHaveURL(/\/operator\/chats\/chat_/);
    const thread = page.getByRole("list", { name: "Messages" });
    await expect(thread.getByText("/plan Build me a new app called Chat Plan")).toBeVisible();
    await expect(thread.getByText(/Plan ready/)).toBeVisible({ timeout: 15_000 });
    await expect(thread.getByRole("button", { name: "Run this plan" })).toBeVisible();
    expect(fs.existsSync(path.join(PROJECTS, "chat-plan"))).toBe(false);

    // The chat is in the history, titled from the request, and reopens with its run.
    await page.getByRole("link", { name: "Build me a new app called Chat Plan" }).first().click();
    await expect(thread.getByText(/Plan ready/)).toBeVisible();
  });

  test("Stop halts a run waiting for approval and says nothing changed", async ({ page }) => {
    await page.goto("/operator/runs");
    await send(page, "Add a pricing page to Pantry Pilot.");
    const reply = lastReply(page);
    await expect(reply.getByText("File the task in Pantry Pilot")).toBeVisible();
    await page.getByRole("button", { name: "Stop the current run" }).click();

    await expect(reply.getByText("Stopped. Nothing was changed.")).toBeVisible();
    expect(fs.readFileSync(path.join(E2E_VAULT, "projects", "pantry-pilot", "TASKS.md"), "utf8")).not.toMatch(/pricing page/i);
  });

  test("Jarvis takes requests and commands for Operator", async ({ page }) => {
    await page.goto("/operator/runs");
    const jarvis = page.getByRole("region", { name: "Jarvis" });
    await jarvis.getByRole("button", { name: "Show Jarvis transcript" }).click();

    const panel = page.getByRole("dialog", { name: "Jarvis" });
    await expect(panel.getByText("for Operator")).toBeVisible();

    // A spoken request becomes a run, in the mode the words imply.
    await panel.getByLabel("Your message").fill("Plan a new app called Voice Plan with Next.js");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(jarvis.getByText("Planning it. Nothing will run.")).toBeVisible();
    const reply = lastReply(page);
    await expect(reply.getByText(/Plan ready/)).toBeVisible({ timeout: 15_000 });

    // Commands act on the newest run rather than going to Hermes.
    await panel.getByLabel("Your message").fill("Approve");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(jarvis.getByText("That was a plan. Say run this plan to do it.")).toBeVisible();

    await panel.getByLabel("Your message").fill("Status");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(jarvis.getByText(/Plan ready for Voice Plan\./)).toBeVisible();
  });

  test("small talk is answered by Jarvis at once, not turned into a run", async ({ page }) => {
    await page.goto("/operator/runs");
    const messages = page.getByRole("region", { name: "Conversation" }).getByRole("listitem", { name: /^Request:/ });
    // Earlier tests left runs; wait for the thread before counting it.
    await expect(messages.first()).toBeVisible();
    const before = await messages.count();
    const jarvis = page.getByRole("region", { name: "Jarvis" });
    await jarvis.getByRole("button", { name: "Show Jarvis transcript" }).click();
    const panel = page.getByRole("dialog", { name: "Jarvis" });

    await panel.getByLabel("Your message").fill("Good morning Jarvis");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(jarvis.getByText(/^(Good (morning|afternoon|evening)|Morning|Afternoon|Evening|Still up|Burning|It's).*sir/)).toBeVisible();
    await expect(messages).toHaveCount(before);

    // The hold-Control switch lives in his panel.
    await expect(panel.getByRole("switch", { name: "Hold Control to talk to Jarvis" })).toBeVisible();
  });

  test("Ask is read-only, and says so when Hermes can't answer", async ({ page }) => {
    await page.goto("/operator/runs");
    await send(page, "What are the biggest problems with Virtara?", "Ask");
    const reply = lastReply(page);
    await expect(reply.getByText(/I couldn't get an answer/)).toBeVisible({ timeout: 15_000 });
    await reply.getByRole("button", { name: /^Details of/ }).click();
    await expect(page.getByRole("dialog", { name: "Run details" }).getByText("Nothing. No file, task or service was changed by this run.")).toBeVisible();
  });
});
