import type { TodayTrending, TrendingRepo } from "../../shared/today-types";

/**
 * Repositories GitHub is talking about this week.
 *
 * GitHub has no trending API. The honest stand-in is the search API: repos
 * created in the last week, most-starred first: what is *new* and taking off.
 * It will not surface an old project having a moment; that would mean
 * scraping github.com/trending, which breaks whenever the markup changes.
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
  return repos.slice(0, LIMIT);
}

export function trendingQuery(now: Date, windowDays = WINDOW_DAYS): URLSearchParams {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  return new URLSearchParams({ q: `created:>${since}`, sort: "stars", order: "desc", per_page: "25" });
}

async function fetchTrending(now: Date): Promise<TodayTrending> {
  const base = { windowDays: WINDOW_DAYS, fetchedAt: now.toISOString() };
  const token = process.env.GITHUB_TOKEN;

  let response: Response;
  try {
    response = await fetch(`${SEARCH_API}?${trendingQuery(now).toString()}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AgentOS/0.1 (personal dashboard)",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ...base, status: "error", detail: "Couldn't reach GitHub.", repos: [] };
  }

  if (response.status === 403 || response.status === 429) {
    return { ...base, status: "rate-limited", detail: "GitHub's search limit was hit. Try again in a minute, or set GITHUB_TOKEN.", repos: [] };
  }
  if (!response.ok) {
    return { ...base, status: "error", detail: `GitHub answered ${response.status}.`, repos: [] };
  }

  return { ...base, status: "ready", repos: readTrendingRepos(await response.json()) };
}

let cache: { at: number; value: TodayTrending } | undefined;

export async function getTodayTrending(now = new Date()): Promise<TodayTrending> {
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.value;
  const value = await fetchTrending(now);
  if (value.status === "ready") cache = { at: now.getTime(), value };
  return value;
}
