import { expect, test, type Page } from "@playwright/test";

/**
 * Mail click paths, with every /api/mail request answered here: this spec can
 * never reach a real mailbox. A request the mock does not recognise is aborted
 * and fails the test, so a new call can't slip through to the test adapter.
 */

interface MockThread {
  threadId: string;
  subject: string;
  account?: "gmail" | "titan";
}

interface MailMock {
  composes: unknown[];
  unexpected: string[];
  titanLinked: boolean;
  /** Runs for each POST /api/mail/bulk. Defaults to success. */
  bulk: (threadIds: string[]) => Promise<{ status: number; body: unknown }>;
}

const THREADS: MockThread[] = [
  { threadId: "g1", subject: "Gmail one" },
  { threadId: "g2", subject: "Gmail two" },
  { threadId: "t1", subject: "Virtara one", account: "titan" },
];

const BODY_TEXT = "The full message, long enough to select some words out of it.";

async function mockMail(page: Page, threads: MockThread[] = THREADS, titanLinked = true): Promise<MailMock> {
  const mock: MailMock = {
    composes: [],
    unexpected: [],
    titanLinked,
    bulk: async (threadIds) => ({ status: 200, body: { succeeded: threadIds.length, failed: 0 } }),
  };

  const thread = (entry: MockThread) => ({
    ...entry,
    fromName: "Someone",
    fromEmail: "someone@example.com",
    snippet: "A snippet",
    messageDate: "2026-11-05T09:00:00.000Z",
    classified: false,
    unread: false,
  });

  await page.route(/\/api\/mail(\/|\?|$)/, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });

    if (method === "GET" && pathname === "/api/mail") {
      return json({ generatedAt: "2026-11-05T10:00:00.000Z", needsYou: [], fyi: threads.map(thread), lowPriority: [] });
    }
    if (method === "GET" && pathname === "/api/mail/status") {
      return json({
        configured: true,
        classifier: "manual",
        connected: true,
        canModify: true,
        threadCount: threads.length,
        accounts: [
          { id: "gmail", label: "Gmail", connected: true },
          mock.titanLinked
            ? { id: "titan", label: "Virtara", connected: true, address: "me@example.com", server: "imap.example.com", smtpServer: "smtp.example.com", providerLabel: "Titan" }
            : { id: "titan", label: "Virtara", connected: false },
        ],
      });
    }
    if (method === "GET" && pathname === "/api/mail/progress") return json({ running: false, total: 0, done: 0, failed: 0 });
    if (method === "GET" && pathname === "/api/mail/outbox") return json({ items: [] });
    if (method === "GET" && pathname.endsWith("/body")) return json({ body: BODY_TEXT });
    if (method === "GET" && pathname.endsWith("/reply-context")) return json({ to: "someone@example.com", subject: "Re: Gmail one" });
    if (method === "POST" && pathname.endsWith("/read")) return json({ succeeded: 1, failed: 0 });
    if (method === "DELETE" && pathname === "/api/mail/accounts/titan") {
      mock.titanLinked = false;
      return json({ ok: true });
    }
    if (method === "POST" && pathname === "/api/mail/bulk") {
      const { threadIds } = request.postDataJSON() as { threadIds: string[] };
      const { status, body } = await mock.bulk(threadIds);
      return json(body, status);
    }
    if (method === "POST" && pathname === "/api/mail/compose") {
      mock.composes.push(request.postDataJSON());
      return json({
        item: {
          id: "o1",
          kind: "sent",
          to: ["someone@example.com"],
          subject: "Hello",
          tag: "normal",
          attachmentCount: 0,
          labelApplied: true,
          createdAt: "2026-11-05T10:00:00.000Z",
        },
      });
    }

    mock.unexpected.push(`${method} ${pathname}`);
    return route.abort();
  });

  return mock;
}

const row = (page: Page, threadId: string) => page.locator(`.mail-thread[data-thread-id="${threadId}"]`);
const toggleOf = (page: Page, threadId: string) => row(page, threadId).locator("[data-thread-toggle]");
const composer = (page: Page) => page.getByRole("dialog", { name: /^(New email|Reply)$/ });

async function filterToVirtara(page: Page) {
  await page.getByRole("button", { name: /filter/i }).click();
  await page.getByRole("checkbox", { name: "Virtara" }).check();
  await page.keyboard.press("Escape");
  await expect(row(page, "g1")).toHaveCount(0);
}

async function unlinkVirtara(page: Page) {
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByText("The Virtara mailbox is unlinked.")).toBeVisible();
}

test.describe("Mail click paths", () => {
  let mock: MailMock;

  test.afterEach(() => {
    expect(mock.unexpected).toEqual([]);
  });

  test.describe("composer", () => {
    test("Enter in To, Cc, Bcc or Subject never sends", async ({ page }) => {
      mock = await mockMail(page);
      await page.goto("/inbox");
      await page.getByRole("button", { name: "Compose", exact: true }).click();

      const dialog = composer(page);
      await dialog.getByRole("button", { name: "Cc / Bcc" }).click();
      await dialog.getByLabel("Message").fill("Ready to go");

      for (const label of ["To", "Cc", "Bcc", "Subject"]) {
        const field = dialog.getByLabel(label, { exact: true });
        await field.fill(label === "Subject" ? "Hello" : "someone@example.com");
        await field.press("Enter");
      }

      // Long enough for a send that had started to reach the mock.
      await page.waitForTimeout(300);
      expect(mock.composes).toEqual([]);
      await expect(dialog).toBeVisible();
    });

    test("the Send button still sends, once", async ({ page }) => {
      mock = await mockMail(page);
      await page.goto("/inbox");
      await page.getByRole("button", { name: "Compose", exact: true }).click();

      const dialog = composer(page);
      await dialog.getByLabel("To", { exact: true }).fill("someone@example.com");
      await dialog.getByLabel("Subject", { exact: true }).fill("Hello");
      await dialog.getByLabel("Message").fill("Line one");
      await dialog.getByLabel("Message").press("Enter");
      await dialog.getByLabel("Message").pressSequentially("Line two");
      expect(mock.composes).toEqual([]);

      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(mock.composes).toHaveLength(1);
      expect(mock.composes[0]).toMatchObject({ mode: "send", body: "Line one\nLine two", subject: "Hello" });
    });

    test("confirming Replace starts a clean new email", async ({ page }) => {
      mock = await mockMail(page);
      await page.goto("/inbox");
      await page.getByRole("button", { name: "Compose", exact: true }).click();

      const dialog = composer(page);
      await dialog.getByLabel("To", { exact: true }).fill("old@example.com");
      await dialog.getByLabel("Message").fill("Old draft");

      // Declining keeps what's written.
      page.once("dialog", (prompt) => void prompt.dismiss());
      await page.getByRole("button", { name: "Compose", exact: true }).click();
      await expect(dialog.getByLabel("Message")).toHaveValue("Old draft");

      page.once("dialog", (prompt) => void prompt.accept());
      await page.getByRole("button", { name: "Compose", exact: true }).click();
      await expect(dialog.getByLabel("Message")).toHaveValue("");
      await expect(dialog.getByLabel("To", { exact: true })).toHaveValue("");
    });

    test("confirming Replace on the same thread starts a clean reply", async ({ page }) => {
      mock = await mockMail(page);
      await page.goto("/inbox");
      await toggleOf(page, "g1").click();

      const reply = row(page, "g1").getByRole("button", { name: "Reply" });
      await reply.click();
      await composer(page).getByLabel("Message").fill("Old reply");

      page.once("dialog", (prompt) => void prompt.accept());
      await reply.click();
      await expect(composer(page).getByLabel("Message")).toHaveValue("");
    });
  });

  test.describe("triage", () => {
    test("a Done that fails during a rapid run puts its thread back and says so", async ({ page }) => {
      mock = await mockMail(page);
      let refuseFirst!: () => void;
      const firstHeld = new Promise<void>((resolve) => (refuseFirst = resolve));
      mock.bulk = async (threadIds) => {
        if (threadIds[0] === "g1") {
          await firstHeld;
          return { status: 500, body: { error: "Gmail said no" } };
        }
        return { status: 200, body: { succeeded: 1, failed: 0 } };
      };

      await page.goto("/inbox");
      for (const id of ["g1", "g2"]) {
        await row(page, id).hover();
        await row(page, id).getByRole("button", { name: /^Done/ }).click();
        await expect(row(page, id)).toHaveCount(0);
      }

      // The second call is the latest when the first one fails.
      refuseFirst();
      await expect(row(page, "g1")).toBeVisible();
      await expect(page.locator(".mail-action-error")).toBeVisible();
      await expect(row(page, "g2")).toHaveCount(0);
    });

    test("a partial refusal during a rapid run is reported too", async ({ page }) => {
      mock = await mockMail(page);
      let refuseFirst!: () => void;
      const firstHeld = new Promise<void>((resolve) => (refuseFirst = resolve));
      mock.bulk = async (threadIds) => {
        if (threadIds[0] === "g1") {
          await firstHeld;
          return { status: 200, body: { succeeded: 0, failed: 1 } };
        }
        return { status: 200, body: { succeeded: 1, failed: 0 } };
      };

      await page.goto("/inbox");
      for (const id of ["g1", "g2"]) {
        await row(page, id).hover();
        await row(page, id).getByRole("button", { name: /^Delete/ }).click();
        await expect(row(page, id)).toHaveCount(0);
      }

      refuseFirst();
      await expect(row(page, "g1")).toBeVisible();
      await expect(page.getByText(/Gmail wouldn't move to Trash that thread/)).toBeVisible();
    });
  });

  test.describe("account filter", () => {
    test("unlinking Virtara while filtered to it brings Gmail mail back", async ({ page }) => {
      // The server keeps cached Virtara threads after an unlink.
      mock = await mockMail(page);
      await page.goto("/inbox");
      await filterToVirtara(page);
      await unlinkVirtara(page);

      await expect(row(page, "g1")).toBeVisible();
      await expect(row(page, "g2")).toBeVisible();
    });

    test("unlinking with no Virtara mail cached doesn't strand an empty Inbox", async ({ page }) => {
      mock = await mockMail(page, [THREADS[0], THREADS[1]]);
      await page.goto("/inbox");
      await filterToVirtara(page);
      await unlinkVirtara(page);

      await expect(row(page, "g1")).toBeVisible();
    });

    test("a mailbox with nothing in it keeps the filter so you can leave", async ({ page }) => {
      mock = await mockMail(page, [THREADS[0], THREADS[1]]);
      await page.goto("/inbox");
      await filterToVirtara(page);

      await expect(page.getByText("No mail synced yet")).toHaveCount(0);
      await expect(page.getByText("No Virtara mail from the last")).toBeVisible();
      await page.getByRole("button", { name: "Show all accounts" }).click();
      await expect(row(page, "g1")).toBeVisible();
    });
  });

  test.describe("reading an open email", () => {
    async function open(page: Page) {
      await page.goto("/inbox");
      await toggleOf(page, "g1").click();
      const body = row(page, "g1").locator(".mail-thread-expanded-body");
      await expect(body).toHaveText(BODY_TEXT);
      return body;
    }

    test("clicking in the body keeps it open", async ({ page }) => {
      mock = await mockMail(page);
      const body = await open(page);
      await body.click();
      await expect(body).toBeVisible();
    });

    test("selecting text keeps it open and keeps the selection", async ({ page }) => {
      mock = await mockMail(page);
      const body = await open(page);
      const box = (await body.boundingBox())!;

      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();

      await expect(body).toBeVisible();
      expect(await page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBeGreaterThan(0);
    });

    test("a selection dragged out of the body keeps it open", async ({ page }) => {
      mock = await mockMail(page);
      const body = await open(page);
      const box = (await body.boundingBox())!;
      const whole = (await row(page, "g1").boundingBox())!;

      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      // Ends on the row's avatar column, outside the body.
      await page.mouse.move(whole.x + 8, whole.y + 8, { steps: 5 });
      await page.mouse.up();

      await expect(body).toBeVisible();
    });

    test("the header and the rest of the row still toggle it", async ({ page }) => {
      mock = await mockMail(page);
      const body = await open(page);

      await toggleOf(page, "g1").click();
      await expect(body).toHaveCount(0);

      await row(page, "g1").locator(".mail-thread-avatar").click();
      await expect(body).toBeVisible();

      await row(page, "g1").locator(".mail-thread-avatar").click();
      await expect(body).toHaveCount(0);
    });
  });
});
