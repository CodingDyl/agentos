import { z } from "zod";
import type { QaCheck } from "./qa";

/**
 * Presses everything on the built site, on the local demo build, to prove that
 * what looks interactive really works. Every request that would leave the local
 * server is refused, and the site runs with no provider keys (see screens.ts),
 * so a submitted form cannot reach anyone.
 *
 * The deployed preview never gets this treatment: a real enquiry from AgentOS
 * could land in the client's inbox. That is what qa.ts is careful about.
 */

const PLACEHOLDER = /\b(lorem ipsum|coming soon|tbc|tba|placeholder|under construction)\b|\[[a-z ]{3,30}\]/i;
const MAX_BUTTONS_PER_ROUTE = 25;
const MAX_FORMS_PER_ROUTE = 4;
const MAX_ROUTES = 10;
const RESULT_WORDS = /thank|received|sent|success|confirm|booked|subscribed|got it|on its way|demo/i;

export const InventorySchema = z.array(
  z.object({
    name: z.string().min(1).max(120),
    route: z.string().startsWith("/").max(300),
    selector: z.string().min(1).max(300),
    mode: z.string().max(40).optional(),
    env: z.array(z.string().max(80)).optional(),
  }),
);
export type InventoryEntry = z.infer<typeof InventorySchema>[number];

/** The worker's list of components, or undefined if it is missing or malformed. */
export function parseInventory(text: string | undefined): InventoryEntry[] | undefined {
  if (!text) return undefined;
  try {
    const parsed = InventorySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Links that go nowhere, read from the served page. */
export function deadLinks(hrefs: readonly string[]): string[] {
  return [...new Set(hrefs.filter((href) => /^(#|javascript:|)$/i.test(href.trim())))];
}

export function placeholderText(text: string): string | undefined {
  return PLACEHOLDER.exec(text)?.[0];
}

/** A value a form will accept for a field, from what the field says it is. */
export function sampleValue(field: { type: string; name: string; label: string }): string {
  const hint = `${field.name} ${field.label}`.toLowerCase();
  if (field.type === "email" || /e-?mail/.test(hint)) return "sample.visitor@example.com";
  if (field.type === "tel" || /phone|tel|cell|mobile/.test(hint)) return "021 555 0142";
  if (field.type === "url") return "https://example.com";
  if (field.type === "number") return "2";
  if (field.type === "date") return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  if (/name/.test(hint)) return "Sample Visitor";
  return "A sample enquiry from the AgentOS check. Nothing here is real.";
}

/** Installed in the page: how many DOM changes happened since it was last read. */
const WATCH = `(() => {
  window.__agentosChanges = 0;
  new MutationObserver((records) => { window.__agentosChanges += records.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
})()`;

const FIELDS = `[...document.forms].map((form, index) => ({ index, shown: form.getBoundingClientRect().height > 0, role: form.getAttribute("role") || "" }))`;

/** A honeypot is there to catch robots, so a real visitor never fills it in. */
const FILL_FORM = (index: number) => `(() => {
  const form = document.forms[${index}];
  const hidden = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return el.type === "hidden" || el.tabIndex === -1 || el.closest("[aria-hidden=true]") || r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || s.visibility === "hidden" || s.opacity === "0" || s.display === "none"; };
  return [...form.elements].filter((el) => ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !hidden(el) && !el.disabled && !["submit", "button", "reset", "file"].includes(el.type)).map((el) => {
    const id = "agentos-" + Math.random().toString(36).slice(2);
    el.setAttribute("data-agentos-field", id);
    return { id, tag: el.tagName, type: el.type || "", name: el.name || "", required: el.required, label: (el.labels && el.labels[0] ? el.labels[0].innerText : el.getAttribute("aria-label") || el.placeholder || "") };
  });
})()`;

/** One built route at a time: what it links to, what it says, whether its controls and forms respond. */
export async function auditInteractions(base: string, routes: readonly string[], inventory: readonly InventoryEntry[] | undefined): Promise<QaCheck[]> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const origin = new URL(base).origin;
  const dead: string[] = [];
  const placeholders: string[] = [];
  const silent: string[] = [];
  let pressed = 0;
  const checks: QaCheck[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", (route) => (route.request().url().startsWith(origin) || route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.dismiss());
    const open = async (route: string) => {
      await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(900);
      await page.evaluate(WATCH);
    };

    for (const route of routes.slice(0, MAX_ROUTES)) {
      await open(route);
      const hrefs = (await page.evaluate(`[...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "")`)) as string[];
      for (const href of deadLinks(hrefs)) dead.push(`${route}: href="${href}"`);
      const placeholder = placeholderText(String(await page.evaluate("document.body.innerText")));
      if (placeholder) placeholders.push(`${route}: "${placeholder}"`);

      const controls = page.locator('button:not([type="submit"]):not([disabled]), [role="button"]:not([aria-disabled="true"]), summary, [role="tab"]');
      const count = Math.min(await controls.count(), MAX_BUTTONS_PER_ROUTE);
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        if (!(await control.isVisible().catch(() => false))) continue;
        const label = ((await control.innerText().catch(() => "")) || (await control.getAttribute("aria-label").catch(() => "")) || "unlabelled").trim().slice(0, 50);
        const before = page.url();
        await page.evaluate("window.__agentosChanges = 0");
        const clicked = await control.click({ timeout: 2_000 }).then(() => true, () => false);
        if (!clicked) continue;
        pressed += 1;
        await page.waitForTimeout(450);
        const moved = page.url() !== before;
        const changes = moved ? 1 : Number(await page.evaluate("window.__agentosChanges").catch(() => 1));
        if (!moved && changes === 0) silent.push(`${route}: "${label}"`);
        if (moved) await open(route);
      }
    }

    if (dead.length > 0) checks.push({ check: "No dead links", status: "fail", detail: dead.slice(0, 12).join("; ") });
    else checks.push({ check: "No dead links", status: "pass", detail: `Checked every link on ${Math.min(routes.length, MAX_ROUTES)} pages.` });
    if (placeholders.length > 0) checks.push({ check: "No placeholder text", status: "fail", detail: placeholders.slice(0, 12).join("; ") });
    else checks.push({ check: "No placeholder text", status: "pass", detail: "No coming soon, lorem ipsum or bracketed placeholders." });
    if (silent.length > 0) checks.push({ check: "Every button does something", status: "fail", detail: `Nothing happened when pressing: ${silent.slice(0, 12).join("; ")}.` });
    else checks.push({ check: "Every button does something", status: pressed > 0 ? "pass" : "blocked", detail: pressed > 0 ? `Pressed ${pressed} controls; each changed the page.` : "No buttons found to press." });

    for (const route of routes.slice(0, MAX_ROUTES)) {
      await open(route);
      const forms = (await page.evaluate(FIELDS)) as { index: number; shown: boolean; role: string }[];
      for (const form of forms.filter((entry) => entry.shown && entry.role !== "search").slice(0, MAX_FORMS_PER_ROUTE)) {
        await open(route);
        const fields = (await page.evaluate(FILL_FORM(form.index))) as { id: string; tag: string; type: string; name: string; required: boolean; label: string }[];
        if (fields.length === 0) continue;
        const summary = fields.map((field) => field.name || field.type).join(", ").slice(0, 80);
        for (const field of fields) {
          const locator = page.locator(`[data-agentos-field="${field.id}"]`);
          if (field.tag === "SELECT") {
            const value = String(await locator.evaluate(`(el) => [...el.options].map((option) => option.value).find(Boolean) ?? ""`));
            if (value) await locator.selectOption(value).catch(() => undefined);
          } else if (field.type === "checkbox" || field.type === "radio") {
            if (field.required) await locator.check({ timeout: 1_500 }).catch(() => undefined);
          } else {
            await locator.fill(sampleValue(field), { timeout: 1_500 }).catch(() => undefined);
          }
        }
        const before = page.url();
        const textBefore = String(await page.evaluate("document.body.innerText"));
        const submit = page.locator(`form >> nth=${form.index}`).locator('button[type="submit"], input[type="submit"], button:not([type])').first();
        if (!(await submit.isVisible().catch(() => false))) {
          checks.push({ check: `Form on ${route} (${summary})`, status: "blocked", detail: "No visible submit button: it may be a later step in a longer flow, which this check does not walk through." });
          continue;
        }
        await submit.click({ timeout: 3_000 }).catch(() => undefined);
        await page.waitForTimeout(2_500);
        const after = String(await page.evaluate("document.body.innerText").catch(() => ""));
        const leaked = /sample\.visitor|021[+ %]?555/i.test(page.url());
        const fresh = after.replace(textBefore, "");
        const responded = page.url() !== before || RESULT_WORDS.test(fresh) || (after !== textBefore && RESULT_WORDS.test(after));
        if (leaked) checks.push({ check: `Form on ${route} (${summary})`, status: "fail", detail: "The details went into the URL." });
        else checks.push(responded ? { check: `Form on ${route} (${summary})`, status: "pass", detail: "Submitted with sample details on the local demo build; the visitor sees a result." } : { check: `Form on ${route} (${summary})`, status: "fail", detail: "Submitted with sample details, and the page showed no success or error result." });
      }
    }

    if (inventory === undefined) checks.push({ check: "Component inventory", status: "fail", detail: "functional-inventory.json is missing or malformed, so no one has said what on this site is meant to work." });
    else {
      const missing: string[] = [];
      for (const entry of inventory) {
        await open(entry.route).catch(() => missing.push(`${entry.name} (${entry.route} would not open)`));
        if (!(await page.locator(entry.selector).first().isVisible({ timeout: 1_000 }).catch(() => false))) missing.push(`${entry.name} (${entry.route})`);
      }
      checks.push(missing.length > 0 ? { check: "Component inventory", status: "fail", detail: `Listed but not on the page: ${[...new Set(missing)].slice(0, 12).join("; ")}.` } : { check: "Component inventory", status: "pass", detail: inventory.length > 0 ? `All ${inventory.length} listed components are on their pages: ${inventory.map((entry) => entry.name).slice(0, 12).join(", ")}.` : "The site lists no interactive components." });
    }
  } catch (error) {
    checks.push({ check: "Interaction audit", status: "blocked", detail: `It could not finish: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}.` });
  } finally {
    await browser.close();
  }
  return checks;
}
