import type { SiteFacts } from "../../shared/traction-types";

/**
 * The plain facts on one web page: what it says, and a few things that can
 * be checked from the markup. Everything returned is text; nothing here
 * runs, follows or trusts what the page contains.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };

function decode(text: string): string {
  return text
    .replace(/&#(\d{1,6});/g, (_, code: string) => safeChar(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code: string) => safeChar(Number.parseInt(code, 16)))
    .replace(/&([a-z]{2,8});/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function safeChar(code: number): string {
  return Number.isInteger(code) && code > 31 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
}

const squash = (text: string) => decode(text).replace(/\s+/g, " ").trim();
const strip = (html: string) => squash(html.replace(/<[^>]*>/g, " "));

function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\b(?:name|property)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== key) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = squash(content?.[1] ?? content?.[2] ?? "");
    if (value) return value;
  }
  return undefined;
}

export function extractPageFacts(html: string, finalUrl: string, now: Date = new Date()): SiteFacts {
  // Markup that is not words: scripts, styles, and hidden template content.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ");

  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "") || metaContent(html, "og:title");
  const description = metaContent(html, "description") ?? metaContent(html, "og:description");

  const headings: string[] = [];
  for (const match of body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = strip(match[2]);
    if (text && text.length <= 200 && !headings.includes(text)) headings.push(text);
    if (headings.length >= 20) break;
  }

  const visible = strip(body.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|li|section|h[1-6]|br|tr)>/gi, " . "))
    .replace(/(?:\s\.){2,}/g, " .")
    .trim();

  return {
    url: finalUrl,
    fetchedAt: now.toISOString(),
    title: title?.slice(0, 200),
    description: description?.slice(0, 400),
    headings,
    text: visible.slice(0, 3500),
    signals: {
      https: finalUrl.startsWith("https:"),
      mobileViewport: /<meta\b[^>]*name\s*=\s*["']?viewport/i.test(html),
      hasForm: /<form\b/i.test(body),
      hasPhoneOrWhatsApp: /href\s*=\s*["'](?:tel:|https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/)/i.test(html),
      images: (body.match(/<img\b/gi) ?? []).length,
    },
  };
}
