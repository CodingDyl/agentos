import { MAX_SITE_CHECKS, type SiteCheck } from "../../shared/places-types";
import { extractPageFacts } from "../web/page-facts";
import { fetchPage, SafeFetchError, type FetchedPage } from "../web/safe-fetch";

/**
 * Reads a business's website, once, and says what is wrong with it.
 *
 * The address comes from Google's record of the business, but it is still
 * fetched through the guarded fetcher: only public websites, bounded in size
 * and time, redirects re-checked. Nothing on the page is followed or run, and
 * only a handful are read at once.
 *
 * The findings are read from the HTML. A site that builds its page with
 * scripts can show gaps a visitor would not see, so they are reasons to look,
 * not verdicts.
 */

const CONCURRENCY = 4;
/** What a site that did not load scores: it is a lead, but a business may be having a bad day. */
const UNREACHABLE_SCORE = 8;

interface Finding {
  weight: number;
  text: string;
}

/** The latest year a copyright notice names, or undefined when there is none. */
export function copyrightYear(html: string, now: Date = new Date()): number | undefined {
  const years: number[] = [];
  for (const match of html.matchAll(/(?:©|&copy;|&#169;|&#xa9;|copyright)[^<]{0,60}?\b((?:19|20)\d{2})\b(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi)) {
    for (const part of [match[1], match[2]]) {
      const year = Number(part);
      if (year >= 1990 && year <= now.getUTCFullYear() + 1) years.push(year);
    }
  }
  return years.length > 0 ? Math.max(...years) : undefined;
}

/** What is wrong with a page, worst first, and how much there is to fix. Pure: no network. */
export function assessSite(html: string, finalUrl: string, now: Date = new Date()): Pick<SiteCheck, "problems" | "score" | "copyrightYear"> {
  const facts = extractPageFacts(html, finalUrl, now);
  const year = copyrightYear(html, now);
  const age = year === undefined ? 0 : now.getUTCFullYear() - year;

  const findings: Finding[] = [];
  if (!facts.signals.https) findings.push({ weight: 3, text: "Not secure: the site has no HTTPS" });
  if (!facts.signals.mobileViewport) findings.push({ weight: 3, text: "Not built for phones: no mobile viewport" });
  if (age >= 3) findings.push({ weight: 2, text: `Looks abandoned: the footer says © ${year}` });
  else if (age === 2) findings.push({ weight: 1, text: `Footer says © ${year}` });
  if (!facts.description) findings.push({ weight: 1, text: "No search description, so Google writes its own" });
  if (!/<meta\b[^>]*(?:property|name)\s*=\s*["']?og:title/i.test(html)) findings.push({ weight: 1, text: "No preview when the link is shared" });
  if (!/<script\b[^>]*application\/ld\+json/i.test(html)) findings.push({ weight: 1, text: "No structured data for search results" });
  if (!facts.signals.hasForm) findings.push({ weight: 1, text: "No contact form" });
  if (!facts.signals.hasPhoneOrWhatsApp) findings.push({ weight: 1, text: "No tap-to-call or WhatsApp link" });

  findings.sort((a, b) => b.weight - a.weight);
  return {
    problems: findings.map((finding) => finding.text),
    score: Math.min(10, findings.reduce((total, finding) => total + finding.weight, 0)),
    copyrightYear: year,
  };
}

export async function checkSite(website: string, read: (url: string) => Promise<FetchedPage> = fetchPage, now: Date = new Date()): Promise<SiteCheck> {
  try {
    const page = await read(website);
    return { website, reachable: true, ...assessSite(page.html, page.url, now) };
  } catch (error) {
    const why = error instanceof SafeFetchError ? error.message : "The website could not be read.";
    return { website, reachable: false, problems: [`The site did not load: ${why}`], score: UNREACHABLE_SCORE };
  }
}

/** Every address once, a few at a time, answered in the order asked. */
export async function checkSites(websites: readonly string[], read: (url: string) => Promise<FetchedPage> = fetchPage, now: Date = new Date()): Promise<SiteCheck[]> {
  const unique = [...new Set(websites)].slice(0, MAX_SITE_CHECKS);
  const results = new Map<string, SiteCheck>();
  let next = 0;

  const worker = async () => {
    while (next < unique.length) {
      const website = unique[next++];
      results.set(website, await checkSite(website, read, now));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));

  return websites.flatMap((website) => {
    const found = results.get(website);
    return found ? [found] : [];
  });
}
