import type { NewsItem, TodayNews } from "../../shared/today-types";

/**
 * Tech and AI news for Today: Hacker News plus a short list of outlets that
 * are reliable on AI and new technology. Read-only, no keys, cached in memory
 * so opening Today never hammers anyone's feed.
 *
 * One feed failing must not lose the others: each is fetched independently
 * and a failure is reported by name.
 */

interface Feed {
  name: string;
  url: string;
}

export const NEWS_FEEDS: readonly Feed[] = [
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { name: "The Verge", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
];

const HN_FRONT_PAGE = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40";
const CACHE_MS = 10 * 60_000;
const PER_SOURCE_LIMIT = 6;
export const NEWS_LIMIT = 24;

/** Front-page items worth an AI/tech reader's time; the rest of HN is not news for this page. */
const HN_RELEVANT =
  /\b(ai|a\.i\.|llms?|gpt|claude|anthropic|openai|gemini|deepseek|mistral|llama|model|agents?|neural|machine learning|transformers?|gpu|nvidia|chips?|robot\w*|rust|typescript|python|open.?source|linux|browser|api|database|postgres|sqlite|compiler|kernel|security|vulnerabilit\w*|software|programming|developers?|github|cloud|quantum)\b/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!match) return undefined;
  const inner = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return decodeEntities(inner.replace(/<[^>]+>/g, "")).trim() || undefined;
}

function isoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Only http(s) links are ever rendered as hrefs: a feed is untrusted input. */
function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** An RSS 2.0 or Atom document → its items, newest fields normalised. Tolerant: bad items are dropped. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];

  for (const block of blocks) {
    const title = tagText(block, "title");
    const atomLink = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(block)
      ?? /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i.exec(block);
    const url = safeUrl(tagText(block, "link") ?? (atomLink ? decodeEntities(atomLink[1]) : undefined));
    if (!title || !url) continue;

    items.push({
      id: `${source}:${url}`,
      title,
      url,
      source,
      publishedAt: isoOrUndefined(tagText(block, "pubDate") ?? tagText(block, "published") ?? tagText(block, "updated")),
    });
  }
  return items;
}

interface HnHit {
  objectID?: string;
  title?: string;
  url?: string | null;
  points?: number;
  num_comments?: number;
  created_at?: string;
}

/** Algolia's front page → items. `all` keeps everything; otherwise only the AI/tech-relevant ones. */
export function parseHackerNews(payload: unknown, all = false): NewsItem[] {
  const hits = (payload as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];

  const items: NewsItem[] = [];
  for (const hit of hits as HnHit[]) {
    if (!hit?.objectID || !hit.title) continue;
    if (!all && !HN_RELEVANT.test(hit.title)) continue;

    const discussionUrl = `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`;
    items.push({
      id: `hn:${hit.objectID}`,
      title: hit.title,
      // Ask HN and similar have no external link; the discussion is the item.
      url: safeUrl(hit.url ?? undefined) ?? discussionUrl,
      source: "Hacker News",
      publishedAt: isoOrUndefined(hit.created_at),
      points: hit.points,
      comments: hit.num_comments,
      discussionUrl,
    });
  }
  return items;
}

/**
 * Merge the sources into one list: each source is capped so a busy outlet
 * cannot crowd out the rest, then everything is ordered newest first.
 */
export function mergeNews(groups: readonly NewsItem[][], limit = NEWS_LIMIT): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];

  for (const group of groups) {
    for (const item of group.slice(0, PER_SOURCE_LIMIT)) {
      const key = item.url.replace(/[#?].*$/, "").replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  const time = (item: NewsItem) => (item.publishedAt ? Date.parse(item.publishedAt) : 0);
  return merged.sort((a, b) => time(b) - time(a)).slice(0, limit);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "AgentOS/0.1 (personal dashboard)", Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, */*" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.text();
}

async function fetchNews(): Promise<TodayNews> {
  const jobs: { name: string; run: () => Promise<NewsItem[]> }[] = [
    { name: "Hacker News", run: async () => parseHackerNews(JSON.parse(await fetchText(HN_FRONT_PAGE))) },
    ...NEWS_FEEDS.map((feed) => ({
      name: feed.name,
      run: async () => parseFeed(await fetchText(feed.url), feed.name),
    })),
  ];

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const groups: NewsItem[][] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") groups.push(result.value);
    else failed.push(jobs[index].name);
  });

  return { items: mergeNews(groups), failed, fetchedAt: new Date().toISOString() };
}

let cache: { at: number; value: TodayNews } | undefined;
let inflight: Promise<TodayNews> | undefined;

/** The news, from memory when fresh. Concurrent callers share one fetch. */
export async function getTodayNews(now = Date.now()): Promise<TodayNews> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  inflight ??= fetchNews()
    .then((value) => {
      // A run where everything failed is not worth remembering for ten minutes.
      if (value.items.length > 0) cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}
