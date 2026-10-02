import type { EmailCandidate, EmailFindResult } from "../../shared/outreach-types";
import { fetchPage, SafeFetchError } from "../web/safe-fetch";

/**
 * Finds the address to write to from the prospect's own website.
 *
 * Reads the home page and the few pages people put contact details on, and
 * takes only addresses that are printed there. Nothing is guessed or
 * constructed (no first.last@ patterns tried against a mail server), so what
 * comes back is an address the business published itself. It is ranked, not
 * chosen: a person accepts one, so a wrong one never reaches a send.
 */

const MAX_PAGES = 5;
const CONTACT_PATH = /(contact|about|team|people|staff|owner|founder|story|reach|enquir|inquir|connect|who-we-are|meet)/i;
const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi;

/** Mailboxes nobody reads, and platform addresses that appear in page code rather than as contacts. */
const REJECT_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|privacy|dmca|webmaster|wordpress|root|support@sentry)$/i;
const REJECT_DOMAIN = /(^|\.)(example\.(com|org)|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|squarespace\.com|godaddy\.com|domain\.com|yourdomain\.com|email\.com|schema\.org|w3\.org|googleapis\.com|gstatic\.com|cloudflare\.com)$/i;
const ASSET_TAIL = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico)$/i;
const FREE_MAIL = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com|live\.com|webmail\.co\.za|mweb\.co\.za|telkomsa\.net)$/i;
const ROLE_LOCAL = /^(info|hello|hi|contact|enquiries|enquiry|inquiries|inquiry|sales|admin|office|accounts|bookings|booking|reception|manager|team|service|services|orders|shop|store|mail|general)$/i;
const OWNER_TITLE = /\b(owner|founder|co-?founder|director|managing|proprietor|ceo|principal|manager)\b/i;

/** `data-cfemail` hex that Cloudflare uses to hide addresses from scrapers. */
export function decodeCloudflareEmail(hex: string): string | undefined {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2 !== 0) return undefined;
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return out.includes("@") ? out : undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&commat;|&#64;/gi, "@")
    .replace(/&amp;/g, "&");
}

/** Visible text with scripts, styles and tags removed, keeping a space where a tag was. */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}

/** Every address on a page, with the text around it, from mailto links, plain text and Cloudflare-hidden ones. */
export function addressesOnPage(html: string): { address: string; context: string }[] {
  const found = new Map<string, string>();
  const text = textOf(html);

  const keep = (raw: string, context: string) => {
    const address = raw.trim().replace(/^mailto:/i, "").replace(/[.,;:)>\]]+$/, "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) || ASSET_TAIL.test(address)) return;
    if (!found.has(address)) found.set(address, context);
  };

  for (const match of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const decoded = decodeCloudflareEmail(match[1]);
    if (decoded) keep(decoded, "");
  }
  for (const match of html.matchAll(/href=["']mailto:([^"'?#]+)/gi)) {
    keep(decodeEntities(decodeURIComponent(match[1])), "");
  }

  // Written out to dodge scrapers: "name [at] site [dot] co [dot] za".
  const spelled = text
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".");

  for (const match of spelled.matchAll(EMAIL)) {
    const index = match.index ?? 0;
    keep(match[0], spelled.slice(Math.max(0, index - 140), index + match[0].length + 140));
  }
  return [...found].map(([address, context]) => ({ address, context }));
}

function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac"]);
  const take = parts.length >= 3 && secondLevel.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join(".");
}

/** The ranked candidates among the addresses read from one site. Pure, so it can be tested without a network. */
export function rankCandidates(
  pages: { url: string; html: string }[],
  siteHost: string,
): EmailCandidate[] {
  const site = registrable(siteHost);
  const byAddress = new Map<string, EmailCandidate & { score: number }>();

  for (const page of pages) {
    for (const { address, context } of addressesOnPage(page.html)) {
      const [local, domain] = address.split("@");
      if (REJECT_LOCAL.test(local) || REJECT_DOMAIN.test(domain)) continue;
      if (/^\d+x?$/.test(local) || local.length < 2) continue;

      const own = registrable(domain) === site;
      const free = FREE_MAIL.test(domain);
      // Another company's address on this site (a web designer, a partner) is not who to write to.
      if (!own && !free) continue;

      const ownerNear = OWNER_TITLE.test(context);
      const personal = !ROLE_LOCAL.test(local) && /^[a-z]{2,}([._-][a-z]{2,})?$/.test(local);

      let kind: EmailCandidate["kind"];
      let score: number;
      let note: string;
      if (personal && ownerNear) {
        kind = "owner";
        score = 100;
        note = "Named mailbox beside an owner or director title";
      } else if (personal) {
        kind = "person";
        score = 80;
        note = "Looks like a named person's mailbox";
      } else if (ROLE_LOCAL.test(local)) {
        kind = "role";
        score = 50;
        note = "A role mailbox the business publishes";
      } else {
        kind = "general";
        score = 40;
        note = "An address printed on the site";
      }
      if (own) score += 10;
      else note += " (free-mail address, not on the business's domain)";
      if (/(contact|about|team)/i.test(page.url)) score += 3;

      const existing = byAddress.get(address);
      if (!existing || existing.score < score) {
        byAddress.set(address, { address, kind, source: page.url, note, score });
      }
    }
  }

  return [...byAddress.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ address, kind, source, note }) => ({ address, kind, source, note }));
}

/** Links on the home page that probably lead to contact details, on the same site only. */
export function contactLinks(html: string, base: string): string[] {
  const origin = new URL(base);
  const out = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), base);
      if (!/^https?:$/.test(url.protocol)) continue;
      if (registrable(url.hostname) !== registrable(origin.hostname)) continue;
      if (ASSET_TAIL.test(url.pathname) || /\.(pdf|zip|docx?)$/i.test(url.pathname)) continue;
      if (CONTACT_PATH.test(url.pathname)) out.add(url.origin + url.pathname);
    } catch {
      // A malformed href is not a page.
    }
  }
  out.delete(origin.origin + origin.pathname);
  return [...out];
}

const NOT_A_SITE = /(^|\.)(facebook|instagram|linkedin|twitter|x|tiktok|youtube|wa|linktr)\.(com|ee|me)$/i;

/** The business's own registrable domain, or undefined for a social page or no website. */
export function siteDomain(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    const host = new URL(website).hostname;
    return NOT_A_SITE.test(host) ? undefined : registrable(host);
  } catch {
    return undefined;
  }
}

export class EmailFinderError extends Error {}

export async function findEmailsForWebsite(website: string | undefined): Promise<EmailFindResult> {
  if (!website) throw new EmailFinderError("This prospect has no website to look at. Add one first.");

  const pages: { url: string; html: string }[] = [];
  try {
    const home = await fetchPage(website);
    pages.push(home);
    const base = new URL(home.url);

    const guesses = ["/contact", "/contact-us", "/about"].map((path) => base.origin + path);
    const queue = [...contactLinks(home.html, home.url), ...guesses].filter(
      (url, index, all) => all.indexOf(url) === index && url !== home.url,
    );

    for (const url of queue) {
      if (pages.length >= MAX_PAGES) break;
      try {
        pages.push(await fetchPage(url));
      } catch {
        // A page that is not there is the usual case for a guessed path.
      }
    }
  } catch (error) {
    if (error instanceof SafeFetchError)
      throw new EmailFinderError(`Could not read the website: ${error.message}`);
    throw error;
  }

  const host = new URL(pages[0].url).hostname;
  return { candidates: rankCandidates(pages, host), pagesRead: pages.length };
}
