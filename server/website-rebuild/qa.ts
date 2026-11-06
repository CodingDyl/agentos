import type { RebuildFunction } from "../../shared/website-rebuild-types";
import { DEMO_BADGE } from "./prompts";

/**
 * Checks on the deployed preview, made as a stranger would: no cookies, no
 * Vercel login, nothing but the link. A preview a client cannot open is not
 * a preview, however green the build was.
 *
 * Feature checks look for the feature on the page. They never submit a form:
 * a real enquiry from AgentOS would land in the client's inbox. Journey checks
 * read what a submission would do from the served HTML instead.
 *
 * A feature without its provider settings runs in demo mode on the preview:
 * working on sample data, with a visible demo badge. That is a pass for the
 * preview. Card fields anywhere, or a demo route a search engine could index,
 * are failures.
 */

export type CheckStatus = "pass" | "fail" | "blocked";

export interface QaCheck {
  check: string;
  status: CheckStatus;
  detail: string;
}

export interface QaResult {
  checks: QaCheck[];
  passed: boolean;
}

const PROTECTED = /vercel\.com\/(sso|login)|_vercel_sso|Authentication Required/i;

interface Page {
  status: number;
  html: string;
  location?: string;
}

async function load(fetcher: typeof fetch, url: string): Promise<Page> {
  try {
    const response = await fetcher(url, { redirect: "manual", headers: { "User-Agent": "AgentOS preview check" }, signal: AbortSignal.timeout(20_000) });
    const type = response.headers.get("content-type") ?? "";
    return { status: response.status, html: type.includes("html") || type.includes("xml") ? await response.text() : "", location: response.headers.get("location") ?? undefined };
  } catch (error) {
    return { status: 0, html: "", location: error instanceof Error ? error.message : undefined };
  }
}

/** `/_next/static/...` files the page asks for: the CSS and JS that make it look and work. */
export function assetPaths(html: string): string[] {
  return [...new Set([...html.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g)].map((match) => match[1]))].slice(0, 6);
}

const FEATURE_CHECKS: Record<RebuildFunction, { label: string; test: (pages: Map<string, Page>) => { status: CheckStatus; detail: string } }> = {
  contact_form: {
    label: "Contact form present",
    test: (pages) => {
      const found = [...pages].find(([, page]) => /<form[\s>]/i.test(page.html) && /type="email"|name="email"|<textarea/i.test(page.html));
      return found ? { status: "pass", detail: `Form found on ${found[0]}. Not submitted: a test enquiry would reach the client.` } : { status: "fail", detail: "No form with an email or message field on any checked page." };
    },
  },
  blog: {
    label: "Blog index loads",
    test: (pages) => {
      const blog = pages.get("/blog");
      return blog && blog.status === 200 ? { status: "pass", detail: "/blog answers 200." } : { status: "fail", detail: `/blog answered ${blog?.status ?? "nothing"}.` };
    },
  },
  booking: {
    label: "Booking available",
    test: (pages) => {
      const found = [...pages].find(([, page]) => /calendly\.com|cal\.com|book(ing)?[^"<]{0,40}<\/(a|button)>|<iframe[^>]+(book|schedul)/i.test(page.html));
      return found ? { status: "pass", detail: `Booking entry point on ${found[0]}.` } : { status: "fail", detail: "No booking page, button or embed on any checked page." };
    },
  },
  newsletter: {
    label: "Newsletter sign-up present",
    test: (pages) => {
      const found = [...pages].find(([, page]) => /<form[\s\S]{0,2000}type="email"/i.test(page.html));
      return found ? { status: "pass", detail: `Email sign-up form on ${found[0]}. Not submitted.` } : { status: "fail", detail: "No email sign-up form on any checked page." };
    },
  },
  ecommerce: {
    label: "Shop loads",
    test: (pages) => {
      const shop = pages.get("/shop");
      if (!shop || shop.status !== 200) return { status: "fail", detail: `/shop answered ${shop?.status ?? "nothing"}.` };
      return isDemo(shop.html) ? { status: "pass", detail: "/shop answers 200 with the sample storefront, marked as demo. Checkout is not tried." } : { status: "pass", detail: "/shop answers 200. Checkout is not tried." };
    },
  },
};

/** Whether a page shows a feature in demo mode: the badge text or the data-demo marker the brief asks for. */
export function isDemo(html: string): boolean {
  return html.includes(DEMO_BADGE) || /\bdata-demo\s*=\s*"true"/i.test(html);
}

/** Payment card inputs. The site must never have one, in any mode. */
export function cardFields(html: string): string[] {
  return [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]).filter((tag) => /autocomplete\s*=\s*"cc-|name\s*=\s*"(card|cc|cvv|cvc|card[-_ ]?number|expiry)/i.test(tag));
}

/** What the journeys are checked against: the old addresses to keep, and which settings the preview was given. */
export interface JourneyInput {
  legacyUrls: readonly string[];
  settingsSet: readonly string[];
  /** The scheduler page, when set: the booking link must go there. Not a secret. */
  bookingUrl?: string;
}

/** The opening tag of every form that asks for an email or a message. */
export function enquiryForms(html: string): string[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].filter((match) => /type="email"|name="email"|<textarea/i.test(match[2])).map((match) => match[1]);
}

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];

/**
 * Whether the form still works, and keeps the enquiry out of the address bar,
 * when JavaScript has not run: an explicit POST to a real action. Read from
 * the served HTML, so nothing is ever submitted.
 */
export function formWorksWithoutJavaScript(tag: string): { ok: boolean; detail: string } {
  const method = attribute(tag, "method")?.toLowerCase();
  const action = attribute(tag, "action");
  if (method !== "post") return { ok: false, detail: method ? `The form's method is ${method}: without JavaScript the enquiry would go into the URL.` : "The form has no method, so without JavaScript (or before the page hydrates) the browser sends the enquiry in the URL with GET." };
  if (action !== undefined && /^javascript:/i.test(action.trim())) return { ok: false, detail: "The form's action only works once JavaScript runs." };
  return { ok: true, detail: `POST${action ? ` to ${action || "this page"}` : ""}, so it works before JavaScript runs and keeps the enquiry out of the URL.` };
}

const CONTACT_SETTINGS = ["RESEND_API_KEY", "CONTACT_FROM_EMAIL", "CONTACT_TO_EMAIL"];

/**
 * Journeys a visitor takes, checked without sending anything: the enquiry
 * form's no-JavaScript path, old addresses that must still land somewhere,
 * the files crawlers ask for, and whether the providers were configured.
 */
export async function journeyChecks(base: string, pages: Map<string, Page>, functions: readonly RebuildFunction[], journeys: JourneyInput, fetcher: typeof fetch): Promise<QaCheck[]> {
  const checks: QaCheck[] = [];
  if (functions.includes("contact_form")) {
    const forms = [...pages].flatMap(([route, page]) => enquiryForms(page.html).map((tag) => ({ route, tag })));
    if (forms.length === 0) checks.push({ check: "Enquiry form works without JavaScript", status: "fail", detail: "No enquiry form on any checked page." });
    else {
      const broken = forms.map((form) => ({ ...form, ...formWorksWithoutJavaScript(form.tag) })).find((form) => !form.ok);
      checks.push(broken ? { check: "Enquiry form works without JavaScript", status: "fail", detail: `${broken.route}: ${broken.detail}` } : { check: "Enquiry form works without JavaScript", status: "pass", detail: `${forms[0].route}: ${formWorksWithoutJavaScript(forms[0].tag).detail} Not submitted.` });
    }
    const missing = CONTACT_SETTINGS.filter((name) => !journeys.settingsSet.includes(name));
    const demoForm = [...pages].some(([, page]) => enquiryForms(page.html).length > 0 && isDemo(page.html));
    checks.push(
      missing.length === 0
        ? { check: "Enquiries delivered", status: "blocked", detail: "Configured in the preview environment. Delivery is not tested: AgentOS never sends a test enquiry on its own." }
        : demoForm
          ? { check: "Enquiries delivered", status: "pass", detail: `Demo mode: enquiries go to the demo inbox, marked as demo. To go live, set ${missing.join(", ")} in What the features need.` }
          : { check: "Enquiries delivered", status: "fail", detail: `Not configured (${missing.join(", ")}) and the form is not marked as a demo, so a visitor could think a sent enquiry reached the client.` },
    );
    const inbox = await load(fetcher, `${base}/admin/demo-inbox`);
    if (inbox.status === 200) {
      checks.push(/<meta[^>]+name="robots"[^>]+noindex/i.test(inbox.html) ? { check: "Demo inbox hidden from search", status: "pass", detail: "/admin/demo-inbox has a noindex robots tag." } : { check: "Demo inbox hidden from search", status: "fail", detail: "/admin/demo-inbox is served without a noindex robots tag." });
    }
  }
  if (functions.includes("booking")) {
    checks.push(
      journeys.settingsSet.includes("BOOKING_URL")
        ? [...pages].find(([, page]) => (journeys.bookingUrl ? page.html.includes(`href="${journeys.bookingUrl.replace(/&/g, "&amp;")}"`) : /href="https:\/\/[^"]*(calendly|cal\.com|book|schedul)/i.test(page.html)))
          ? { check: "Booking link goes to the scheduler", status: "pass", detail: "A page links to the scheduler page that is set." }
          : { check: "Booking link goes to the scheduler", status: "fail", detail: "BOOKING_URL is set, but no checked page links to it." }
        : [...pages].some(([, page]) => isDemo(page.html) && /book/i.test(page.html))
          ? { check: "Booking works on sample availability", status: "pass", detail: "Demo mode: the booking flow runs on mock availability, marked as demo. To go live, set BOOKING_URL (or Cal.com) in What the features need." }
          : { check: "Booking works on sample availability", status: "fail", detail: "BOOKING_URL is not set and no checked page shows the booking flow marked as a demo." },
    );
  }
  for (const feature of ["newsletter", "ecommerce"] as const) {
    if (!functions.includes(feature)) continue;
    const label = feature === "newsletter" ? "Newsletter sign-up" : "Shop";
    checks.push(
      [...pages].some(([, page]) => isDemo(page.html))
        ? { check: `${label} marked as demo`, status: "pass", detail: `Demo mode is visible on the site. Live provider settings are added at launch (see FUNCTIONALITY.md).` }
        : { check: `${label} marked as demo`, status: "blocked", detail: "No demo badge found. If its provider is connected this is expected; otherwise the demo must be marked." },
    );
  }
  const withCards = [...pages].find(([, page]) => cardFields(page.html).length > 0);
  checks.push(withCards ? { check: "No card fields", status: "fail", detail: `${withCards[0]} has a payment card input. The site must never take card details.` } : { check: "No card fields", status: "pass", detail: "No payment card inputs on any checked page." });
  for (const legacy of journeys.legacyUrls.slice(0, 30)) {
    const first = await load(fetcher, `${base}${legacy}`);
    if (first.status === 200) {
      checks.push({ check: `Old address ${legacy}`, status: "pass", detail: "Still served (200)." });
      continue;
    }
    if (first.status >= 300 && first.status < 400 && first.location) {
      const target = new URL(first.location, `${base}/`);
      const landed = await load(fetcher, target.href);
      const where = target.origin === new URL(`${base}/`).origin ? target.pathname : target.href;
      checks.push(landed.status === 200 ? { check: `Old address ${legacy}`, status: "pass", detail: `Redirects (${first.status}) to ${where}, which answers 200.` } : { check: `Old address ${legacy}`, status: "fail", detail: `Redirects (${first.status}) to ${where}, which answered ${landed.status || "nothing"}.` });
      continue;
    }
    checks.push({ check: `Old address ${legacy}`, status: "fail", detail: `Answered ${first.status || "nothing"}: a visitor or search result using it lands nowhere.` });
  }
  for (const file of ["/sitemap.xml", "/robots.txt"]) {
    const answer = await load(fetcher, `${base}${file}`);
    checks.push({ check: `Serves ${file}`, status: answer.status === 200 ? "pass" : "fail", detail: `Answered ${answer.status || "nothing"}.` });
    if (file === "/sitemap.xml" && /demo-inbox|\/admin\//i.test(answer.html)) checks.push({ check: "Sitemap has no demo routes", status: "fail", detail: "sitemap.xml lists a demo or admin route." });
  }
  return checks;
}

/** Loads the preview as a signed-out visitor and checks pages, assets and the requested features. */
export async function checkPreview(baseUrl: string, routes: readonly string[], functions: readonly RebuildFunction[], fetcher: typeof fetch = fetch, journeys?: JourneyInput): Promise<QaResult> {
  const base = baseUrl.replace(/\/+$/, "");
  const checks: QaCheck[] = [];
  const pages = new Map<string, Page>();

  const home = await load(fetcher, `${base}/`);
  pages.set("/", home);
  const blockedByLogin = home.status === 401 || home.status === 403 || (home.status >= 300 && home.status < 400 && PROTECTED.test(home.location ?? "")) || PROTECTED.test(home.html.slice(0, 5000));
  checks.push(
    blockedByLogin
      ? { check: "Opens without logging in", status: "fail", detail: "The preview asks for a Vercel login. Deployment protection is still on for this project." }
      : home.status === 200
        ? { check: "Opens without logging in", status: "pass", detail: "Home page answered 200 to a visitor with no cookies." }
        : { check: "Opens without logging in", status: "fail", detail: `Home page answered ${home.status || "nothing"}${home.location ? ` (${home.location})` : ""}.` },
  );
  if (blockedByLogin) return { checks, passed: false };

  const extra = [...new Set([...routes, ...(functions.includes("blog") ? ["/blog"] : []), ...(functions.includes("ecommerce") ? ["/shop"] : [])])].filter((route) => route !== "/");
  for (const route of extra) {
    const page = await load(fetcher, `${base}${route}`);
    pages.set(route, page);
    checks.push({ check: `Page ${route}`, status: page.status === 200 ? "pass" : "fail", detail: `Answered ${page.status || "nothing"}.` });
  }

  const assets = assetPaths(home.html);
  if (assets.length === 0) {
    checks.push({ check: "Styles and scripts load", status: "fail", detail: "The home page references no Next.js assets, so it may not be the built site." });
  } else {
    const failed: string[] = [];
    for (const asset of assets) {
      const response = await load(fetcher, `${base}${asset}`);
      if (response.status !== 200) failed.push(`${asset} (${response.status || "no answer"})`);
    }
    checks.push(failed.length === 0 ? { check: "Styles and scripts load", status: "pass", detail: `${assets.length} assets answered 200.` } : { check: "Styles and scripts load", status: "fail", detail: `Failed: ${failed.join(", ")}.` });
  }

  for (const feature of functions) {
    const { label, test } = FEATURE_CHECKS[feature];
    checks.push({ check: label, ...test(pages) });
  }
  if (journeys) checks.push(...(await journeyChecks(base, pages, functions, journeys, fetcher)));

  return { checks, passed: checks.every((check) => check.status !== "fail") };
}

export function qaTable(result: QaResult): string {
  const mark: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", blocked: "Blocked" };
  return ["| Check | Result | Detail |", "|---|---|---|", ...result.checks.map((check) => `| ${check.check} | ${mark[check.status]} | ${check.detail.replace(/\|/g, "\\|")} |`)].join("\n");
}
