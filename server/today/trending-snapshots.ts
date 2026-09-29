import fs from "node:fs/promises";
import path from "node:path";
import type { TrendingRepo } from "../../shared/today-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Daily star counts for the repositories Today watches.
 *
 * GitHub only reports a repo's total stars, never how many it gained, so
 * "rising" has to be measured by us: remember each day's counts, subtract.
 * Stored outside the vault, next to the other UI state. Small by design:
 * one number per repo per day, thirty days, then it falls off.
 */

export const KEEP_DAYS = 30;

export type SnapshotDays = Record<string, Record<string, number>>;

interface SnapshotFile {
  version: 1;
  days: SnapshotDays;
}

function snapshotFile(): string {
  return path.join(uiStateDir(), "github-trending.json");
}

function isDays(value: unknown): value is SnapshotDays {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([day, repos]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      typeof repos === "object" &&
      repos !== null &&
      Object.values(repos).every((stars) => typeof stars === "number" && Number.isFinite(stars)),
  );
}

/** A missing or corrupt file means "no history yet", never an error. */
export async function readSnapshots(): Promise<SnapshotDays> {
  try {
    const parsed = JSON.parse(await fs.readFile(snapshotFile(), "utf8")) as Partial<SnapshotFile>;
    return isDays(parsed.days) ? parsed.days : {};
  } catch {
    return {};
  }
}

/** Atomic (temp file, then rename) so a crash mid-write cannot truncate the history. */
export async function writeSnapshots(days: SnapshotDays): Promise<void> {
  const target = snapshotFile();
  await fs.mkdir(uiStateDir(), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ version: 1, days } satisfies SnapshotFile)}\n`, "utf8");
  await fs.rename(temporary, target);
}

/** Today's counts replace any earlier reading from the same day; old days beyond KEEP_DAYS are dropped. */
export function recordDay(days: SnapshotDays, day: string, repos: readonly TrendingRepo[]): SnapshotDays {
  const today = { ...days[day] };
  for (const repo of repos) today[repo.fullName] = repo.stars;

  const next = { ...days, [day]: today };
  const kept = Object.keys(next).sort().slice(-KEEP_DAYS);
  return Object.fromEntries(kept.map((key) => [key, next[key]]));
}

/** The most recent day before `day`, or undefined when there is no history to compare with. */
export function baselineDay(days: SnapshotDays, day: string): string | undefined {
  return Object.keys(days)
    .filter((key) => key < day)
    .sort()
    .at(-1);
}

function daysBetween(from: string, to: string): number {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

export interface RankedTrending {
  repos: TrendingRepo[];
  baselineDate?: string;
  sinceDays?: number;
}

/**
 * Attach gains against the baseline and order by them.
 *
 * A repo missing from the baseline is either brand new (created since then, so
 * it had none: everything it has is a gain) or simply wasn't watched then, in
 * which case its gain is unknown and it is not guessed at. Without a baseline
 * the order is plain star count.
 */
export function rankTrending(
  candidates: readonly TrendingRepo[],
  days: SnapshotDays,
  day: string,
  limit: number,
): RankedTrending {
  const baseline = baselineDay(days, day);
  if (!baseline) {
    return { repos: [...candidates].sort((a, b) => b.stars - a.stars).slice(0, limit) };
  }

  const before = days[baseline];
  const baselineStart = Date.parse(baseline);
  const withGains = candidates.map((repo): TrendingRepo => {
    const previous = before[repo.fullName];
    if (previous !== undefined) return { ...repo, starsGained: Math.max(0, repo.stars - previous) };
    if (Date.parse(repo.createdAt) >= baselineStart) return { ...repo, starsGained: repo.stars, isNew: true };
    return repo;
  });

  const repos = withGains
    .sort((a, b) => (b.starsGained ?? -1) - (a.starsGained ?? -1) || b.stars - a.stars)
    .slice(0, limit);
  return { repos, baselineDate: baseline, sinceDays: daysBetween(baseline, day) };
}
