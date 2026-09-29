import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeNews, parseFeed, parseHackerNews } from "../news";
import { readTrendingRepos, trendingQuery } from "../trending";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Claude &amp; friends]]></title><link>https://example.com/a</link><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item><title>No link</title></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Atom post</title><link rel="alternate" href="https://example.com/b?x=1&amp;y=2"/><updated>2026-09-27T08:00:00Z</updated></entry></feed>`;

describe("news feeds", () => {
  it("parses RSS, decodes entities and drops unsafe or linkless items", () => {
    const items = parseFeed(RSS, "Test");
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Claude & friends");
    assert.equal(items[0].publishedAt, "2026-09-28T10:00:00.000Z");
  });

  it("parses Atom", () => {
    const [item] = parseFeed(ATOM, "Atom");
    assert.equal(item.url, "https://example.com/b?x=1&y=2");
    assert.equal(item.publishedAt, "2026-09-27T08:00:00.000Z");
  });

  it("keeps only AI/tech Hacker News items and links Ask HN to its discussion", () => {
    const items = parseHackerNews({
      hits: [
        { objectID: "1", title: "Anthropic ships a new model", url: "https://x.com/p", points: 300, num_comments: 90, created_at: "2026-09-28T09:00:00Z" },
        { objectID: "2", title: "My cat photos", url: "https://x.com/cats" },
        { objectID: "3", title: "Ask HN: best Rust learning path?" },
      ],
    });
    assert.deepEqual(items.map((item) => item.id), ["hn:1", "hn:3"]);
    assert.equal(items[1].url, "https://news.ycombinator.com/item?id=3");
  });

  it("merges newest first, dedupes by URL and caps each source", () => {
    const at = (day: number) => `2026-09-${day}T00:00:00.000Z`;
    const mk = (id: string, url: string, day: number) => ({ id, title: id, url, source: "s", publishedAt: at(day) });
    const merged = mergeNews([[mk("a", "https://e.com/1", 20), mk("b", "https://e.com/2", 25)], [mk("c", "https://e.com/1/", 27)]]);
    assert.deepEqual(merged.map((item) => item.id), ["b", "a"]);
  });
});

describe("github trending", () => {
  it("maps search results and skips archived repos", () => {
    const repos = readTrendingRepos({
      items: [
        { full_name: "a/b", html_url: "https://github.com/a/b", description: " Cool ", language: "Rust", stargazers_count: 5000, forks_count: 10, created_at: "2026-09-25T00:00:00Z" },
        { full_name: "c/d", html_url: "https://github.com/c/d", created_at: "2026-09-25T00:00:00Z", archived: true },
        { full_name: "e/f", html_url: "https://evil.example/e/f", created_at: "2026-09-25T00:00:00Z" },
      ],
    });
    assert.equal(repos.length, 1);
    assert.equal(repos[0].description, "Cool");
  });

  it("asks for repos created in the last week, most starred first", () => {
    const query = trendingQuery(new Date("2026-09-29T12:00:00Z"));
    assert.equal(query.get("q"), "created:>2026-09-22");
    assert.equal(query.get("sort"), "stars");
  });
});
