import { expect, test, type Page } from "@playwright/test";

/**
 * Routines in Operations → Scheduled tasks. Hermes is mocked at the browser:
 * installing writes into Hermes, and a test must never do that for real.
 */

const brief = (deliver: string) => ({
  id: "job1",
  name: "AgentOS Morning Brief",
  schedule: "weekdays at 7:30am",
  enabled: true,
  state: "active",
  skills: ["start-day"],
  warnings: [],
  recipe: { prompt: "Run the start-day workflow.", deliver, toolsets: [] },
});

const routineJob = {
  id: "job2",
  name: "AgentOS: Follow-ups due",
  schedule: "0 9 * * 1-5",
  enabled: true,
  state: "active",
  skills: [],
  warnings: [],
  recipe: { script: "agentos-routine-follow-ups.sh", noAgent: true, deliver: "telegram", toolsets: [] },
};

const routine = (id: string, name: string, installed: boolean) => ({
  id,
  name,
  summary: `What ${name} sends.`,
  when: "Weekdays at 09:00",
  quietWhen: "there is nothing to say",
  installed,
  ...(installed ? { automationId: "job2" } : {}),
});

async function mockHermes(page: Page) {
  const state = { installed: false, deliver: "local", installs: 0, deliveries: [] as unknown[] };

  await page.route("**/api/hermes/automation-surfaces", (route) =>
    route.fulfill({
      json: {
        emergencyStop: { engaged: false },
        scheduler: { running: true },
        curator: { state: "enabled" },
        kanban: { readable: true, byStatus: {} },
        hooks: { configured: false, entries: [] },
        webhooks: { enabled: false, entries: [] },
      },
    }),
  );
  await page.route("**/api/automations", (route) =>
    route.fulfill({ json: { automations: [brief(state.deliver), ...(state.installed ? [routineJob] : [])], health: { ok: true, issues: [] } } }),
  );
  await page.route("**/api/automations/job1/deliver", (route) => {
    const body = route.request().postDataJSON() as { target: string };
    state.deliveries.push(body);
    state.deliver = body.target;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/routines", (route) =>
    route.fulfill({
      json: {
        routines: [routine("follow-ups", "Follow-ups due", state.installed), routine("inbox", "Inbox needs you", false)],
        phone: { connected: true },
      },
    }),
  );
  await page.route("**/api/routines/*/preview", (route) =>
    route.fulfill({ json: { message: route.request().url().includes("follow-ups") ? "Outreach today\n\n2 follow-ups are due:\n- Acme: email 2" : "" } }),
  );
  await page.route("**/api/routines/follow-ups/install", (route) => {
    state.installs += 1;
    state.installed = true;
    return route.fulfill({ json: { ok: true } });
  });

  return state;
}

test.describe("Routines", () => {
  test("previews a message, installs the routine, and it joins the scheduled tasks", async ({ page }) => {
    const hermes = await mockHermes(page);
    await page.goto("/operations?tab=automations");

    const routines = page.getByRole("region", { name: "Routines" });
    await expect(routines.getByText("Telegram connected")).toBeVisible();
    const followUps = routines.getByRole("listitem").filter({ hasText: "Follow-ups due" });
    await expect(followUps.getByText("Not installed")).toBeVisible();

    await followUps.getByRole("button", { name: "Preview" }).click();
    await expect(followUps.getByText("2 follow-ups are due:")).toBeVisible();

    // A routine with nothing to say shows that, instead of an empty box.
    const inbox = routines.getByRole("listitem").filter({ hasText: "Inbox needs you" });
    await inbox.getByRole("button", { name: "Preview" }).click();
    await expect(inbox.getByText("It would send nothing now: there is nothing to say.")).toBeVisible();

    await followUps.getByRole("button", { name: "Install" }).click();
    await expect(followUps.getByText("Installed", { exact: true })).toBeVisible();
    await expect(followUps.getByRole("button", { name: "Install" })).toHaveCount(0);
    expect(hermes.installs).toBe(1);

    // The job list is re-read, so the new job is there without a refresh.
    await expect(page.getByRole("button", { name: "AgentOS: Follow-ups due" })).toBeVisible();
  });

  test("sends an existing job to the phone, and back to its file", async ({ page }) => {
    const hermes = await mockHermes(page);
    await page.goto("/operations?tab=automations");

    const job = page.getByRole("listitem").filter({ hasText: "AgentOS Morning Brief" });
    await expect(job.getByText("Delivers to: local")).toBeVisible();

    await job.getByRole("button", { name: "Send to phone" }).click();
    await expect(job.getByText("Done. Results go to your phone from the next run.")).toBeVisible();
    await expect(job.getByText("Delivers to: telegram")).toBeVisible();

    await job.getByRole("button", { name: "Stop sending to phone" }).click();
    await expect(job.getByText("Delivers to: local")).toBeVisible();
    expect(hermes.deliveries).toEqual([{ target: "telegram" }, { target: "local" }]);
  });
});
