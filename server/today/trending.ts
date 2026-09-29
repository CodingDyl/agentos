import type { TodayTrending, TrendingRepo } from "../../shared/today-types";
import { rankTrending, readSnapshots, recordDay, writeSnapshots } from "./trending-snapshots";

/**
 * Repositories GitHub is talking about this week.
 *
 * GitHub has no trending API, and reports only total stars, never gains. So
 * this watches a pool of candidates (repos created in the last week, plus the
 * most-starred repos of the last year), records their star counts once a day,
 * and ranks by the difference. Until there are two days of history the list
 * is ordered by total stars instead, and says so.
 *
 * The pool is the limit: an old project that suddenly takes off is missed
 * unless it is already among the year's most-starred. Scraping
 * github.com/trending would fix that, but breaks whenever the markup changes.
 *
 * Works unauthenticated (10 searches a minute, plenty behind a cache); a
 * `GITHUB_TOKEN` in the environment raises the limit.
 */

const WINDOW_DAYS = 7;
const LIMIT = 10;
const CACHE_MS = 30 * 60_000;
const SEARCH_API = "https://api.github.com/search/repositories";

interface GithubRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  created_at?: string;
  archived?: boolean;
}

export function readTrendingRepos(payload: unknown): TrendingRepo[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const repos: TrendingRepo[] = [];
  for (const raw of items as GithubRepo[]) {
    if (!raw?.full_name || !raw.html_url || !raw.created_at || raw.archived) continue;
    if (!raw.html_url.startsWith("https://github.com/")) continue;
    repos.push({
      fullName: raw.full_name,
      url: raw.html_url,
      description: raw.description?.trim() || undefined,
      language: raw.language || undefined,
      stars: raw.stargazers_count ?? 0,
      forks: raw.forks_count ?? 0,
      createdAt: raw.created_at,
    });
  }
  return repos;
}

export function trendingQuery(now: Date, windowDays = WINDOW_DAYS): URLSearchParams {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  return new URLSearchParams({ q: `created:>${since}`, sort: "stars", order: "desc", per_page: "50" });
}

/** The year's most-starred young repos: where a project that is already big and still climbing shows up. */
export function risingPoolQuery(now: Date): URLSearchParams {
  const since = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  return new URLSearchParams({ q: `created:>${since}`, sort: "stars", order: "desc", per_page: "50" });
}

/** The two searches' results as one pool, a repo in both counted once. */
export function mergeCandidates(...lists: TrendingRepo[][]): TrendingRepo[] {
  const byName = new Map<string, TrendingRepo>();
  for (const repo of lists.flat()) byName.set(repo.fullName, repo);
  return [...byName.values()];
}

type SearchResult = { repos: TrendingRepo[] } | { failure: TodayTrending };

async function search(params: URLSearchParams, base: Pick<TodayTrending, "windowDays" | "fetchedAt">): Promise<SearchResult> {
  const token = process.env.GITHUB_TOKEN;

  let response: Response;
  try {
    response = await fetch(`${SEARCH_API}?${params.toString()}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AgentOS/0.1 (personal dashboard)",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { failure: { ...base, status: "error", detail: "Couldn't reach GitHub.", repos: [] } };
  }

  if (response.status === 403 || response.status === 429) {
    return {
      failure: { ...base, status: "rate-limited", detail: "GitHub's search limit was hit. Try again in a minute, or set GITHUB_TOKEN.", repos: [] },
    };
  }
  if (!response.ok) {
    return { failure: { ...base, status: "error", detail: `GitHub answered ${response.status}.`, repos: [] } };
  }
  return { repos: readTrendingRepos(await response.json()) };
}

async function fetchTrending(now: Date): Promise<TodayTrending> {
  const base = { windowDays: WINDOW_DAYS, fetchedAt: now.toISOString() };

  const [fresh, rising] = await Promise.all([search(trendingQuery(now), base), search(risingPoolQuery(now), base)]);
  if ("failure" in fresh) return fresh.failure;
  if ("failure" in rising) return rising.failure;

  const day = now.toISOString().slice(0, 10);
  const candidates = mergeCandidates(fresh.repos, rising.repos);

  // Rank against yesterday's counts, then record today's. A failure to write
  // history costs tomorrow's gains, not today's list.
  const history = await readSnapshots();
  const ranked = rankTrending(candidates, history, day, LIMIT);
  const updated = recordDay(history, day, candidates);
  await writeSnapshots(updated).catch((error) => console.error("[agentos] trending snapshot not saved:", error));

  return {
    ...base,
    status: "ready",
    repos: ranked.repos,
    tracking: { baselineDate: ranked.baselineDate, sinceDays: ranked.sinceDays, daysRecorded: Object.keys(updated).length },
  };
}

let cache: { at: number; value: TodayTrending } | undefined;
let inflight: Promise<TodayTrending> | undefined;

/** Concurrent callers share one fetch, so the two searches and the snapshot run once per refresh. */
export async function getTodayTrending(now = new Date()): Promise<TodayTrending> {
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.value;
  inflight ??= fetchTrending(now)
    .then((value) => {
      if (value.status === "ready") cache = { at: now.getTime(), value };
      return value;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

const RECORD_EVERY_MS = 6 * 60 * 60_000;

/**
 * Records star counts whether or not Today is open. Without this, history
 * would only accrue on days the page was visited and gains would be measured
 * over irregular gaps.
 */
export function startTrendingTracker(): void {
  const record = () => {
    void getTodayTrending().catch((error) => console.error("[agentos] trending tracker failed:", error));
  };
  record();
  setInterval(record, RECORD_EVERY_MS).unref();
}
