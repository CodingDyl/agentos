import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeNews, parseFeed, parseHackerNews } from "../news";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeCandidates, readTrendingRepos, trendingQuery } from "../trending";
import { KEEP_DAYS, rankTrending, readSnapshots, recordDay, writeSnapshots } from "../trending-snapshots";
import type { TrendingRepo } from "../../../shared/today-types";

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

const repo = (fullName: string, stars: number, createdAt = "2026-01-01T00:00:00Z"): TrendingRepo => ({
  fullName,
  url: `https://github.com/${fullName}`,
  stars,
  forks: 0,
  createdAt,
});

describe("trending snapshots", () => {
  it("orders by total stars when there is no earlier day", () => {
    const ranked = rankTrending([repo("a/a", 10), repo("b/b", 50)], {}, "2026-09-29", 10);
    assert.deepEqual(ranked.repos.map((r) => r.fullName), ["b/b", "a/a"]);
    assert.equal(ranked.baselineDate, undefined);
    assert.equal(ranked.repos[0].starsGained, undefined);
  });

  it("ranks by gain against the latest earlier day, and treats a repo created since as all gain", () => {
    const days = { "2026-09-27": { "a/a": 100 }, "2026-09-28": { "a/a": 1000, "b/b": 5000 } };
    const ranked = rankTrending(
      [repo("a/a", 1400), repo("b/b", 5100), repo("new/new", 300, "2026-09-28T12:00:00Z"), repo("old/unseen", 99999)],
      days,
      "2026-09-29",
      10,
    );
    assert.deepEqual(ranked.repos.map((r) => [r.fullName, r.starsGained]), [
      ["a/a", 400],
      ["new/new", 300],
      ["b/b", 100],
      ["old/unseen", undefined],
    ]);
    assert.equal(ranked.repos[1].isNew, true);
    assert.equal(ranked.baselineDate, "2026-09-28");
    assert.equal(ranked.sinceDays, 1);
  });

  it("overwrites the same day, keeps the days apart, and prunes old ones", () => {
    let days = recordDay({}, "2026-01-01", [repo("a/a", 1)]);
    days = recordDay(days, "2026-01-01", [repo("a/a", 2)]);
    assert.equal(days["2026-01-01"]["a/a"], 2);
    for (let i = 2; i <= KEEP_DAYS + 5; i++) days = recordDay(days, `2026-02-${String(i).padStart(2, "0")}`, [repo("a/a", i)]);
    assert.equal(Object.keys(days).length, KEEP_DAYS);
    assert.equal(days["2026-01-01"], undefined);
  });

  it("round-trips through disk and treats a corrupt file as empty", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-trending-"));
    const previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = dir;
    try {
      assert.deepEqual(await readSnapshots(), {});
      await writeSnapshots({ "2026-09-28": { "a/a": 7 } });
      assert.deepEqual(await readSnapshots(), { "2026-09-28": { "a/a": 7 } });
      await fs.writeFile(path.join(dir, "github-trending.json"), "{nope", "utf8");
      assert.deepEqual(await readSnapshots(), {});
    } finally {
      if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
      else process.env.AGENTOS_UI_DIR = previous;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("counts a repo found by both searches once", () => {
    assert.equal(mergeCandidates([repo("a/a", 1)], [repo("a/a", 2), repo("b/b", 3)]).length, 2);
  });
});
