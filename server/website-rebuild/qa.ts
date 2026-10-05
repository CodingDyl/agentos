import type { RebuildFunction } from "../../shared/website-rebuild-types";

/**
 * Checks on the deployed preview, made as a stranger would: no cookies, no
 * Vercel login, nothing but the link. A preview a client cannot open is not
 * a preview, however green the build was.
 *
 * Feature checks look for the feature on the page. They never submit a form:
 * a real enquiry from AgentOS would land in the client's inbox.
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
    return { status: response.status, html: type.includes("html") ? await response.text() : "", location: response.headers.get("location") ?? undefined };
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
    label: "Booking link or embed present",
    test: (pages) => {
      const found = [...pages].find(([, page]) => /calendly\.com|cal\.com|book(ing)?[^"<]{0,40}<\/(a|button)>|<iframe[^>]+(book|schedul)/i.test(page.html));
      return found ? { status: "pass", detail: `Booking entry point on ${found[0]}.` } : { status: "fail", detail: "No booking link, button or embed on any checked page." };
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
    label: "Online shop",
    test: () => ({ status: "blocked", detail: "Not built: an online shop needs a platform decision first." }),
  },
};

/** Loads the preview as a signed-out visitor and checks pages, assets and the requested features. */
export async function checkPreview(baseUrl: string, routes: readonly string[], functions: readonly RebuildFunction[], fetcher: typeof fetch = fetch): Promise<QaResult> {
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

  const extra = [...new Set([...routes, ...(functions.includes("blog") ? ["/blog"] : [])])].filter((route) => route !== "/");
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

  return { checks, passed: checks.every((check) => check.status !== "fail") };
}

export function qaTable(result: QaResult): string {
  const mark: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", blocked: "Blocked" };
  return ["| Check | Result | Detail |", "|---|---|---|", ...result.checks.map((check) => `| ${check.check} | ${mark[check.status]} | ${check.detail.replace(/\|/g, "\\|")} |`)].join("\n");
}
