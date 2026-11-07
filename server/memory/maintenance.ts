import fs from "node:fs/promises";
import path from "node:path";
import { assertVaultRootPresent } from "../agentos/filesystem";

/**
 * Memory upkeep the vault policy asks for: daily logs older than about 30 days
 * move from `logs/daily/` to `archive/logs/daily/YYYY-MM/`.
 *
 * It renames and nothing else. There is no delete path and an existing
 * destination is never overwritten, because the policy is "archive, never
 * delete". Nothing here runs on a schedule: the owner triggers it.
 */

export interface DailyLogMove {
  /** Vault-relative, forward slashes. */
  from: string;
  to: string;
}

export interface DailyLogPlan {
  moves: DailyLogMove[];
  skipped: Array<{ file: string; reason: string }>;
}

const DAILY_DIR = "logs/daily";
const ARCHIVE_DIR = "archive/logs/daily";
/** Older than this many whole days is archived. 29 days stays, 31 goes. */
const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATED_LOG = /^(\d{4})-(\d{2})-(\d{2})(?:[^/]*)\.md$/;

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

/** What would move, and what was left alone and why. Changes nothing. */
export async function planDailyLogArchive(vaultRoot: string, now: Date): Promise<DailyLogPlan> {
  await assertVaultRootPresent(vaultRoot);
  const plan: DailyLogPlan = { moves: [], skipped: [] };

  const realRoot = await fs.realpath(vaultRoot);
  let realDaily: string;
  try {
    realDaily = await fs.realpath(path.join(realRoot, DAILY_DIR));
  } catch {
    return plan;
  }
  // A logs/daily that is a link out of the vault is not ours to move from.
  if (!isInside(realRoot, realDaily)) return plan;

  const names = (await fs.readdir(realDaily)).sort();
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    if (name.startsWith("._")) {
      plan.skipped.push({ file: name, reason: "A macOS sidecar file, not a log." });
      continue;
    }
    const match = DATED_LOG.exec(name);
    if (!match) {
      plan.skipped.push({ file: name, reason: "The name does not start with a date." });
      continue;
    }

    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
      plan.skipped.push({ file: name, reason: "The date in the name is not a real date." });
      continue;
    }
    if (Math.floor((now.getTime() - date.getTime()) / DAY_MS) <= KEEP_DAYS) continue;

    const source = path.join(realDaily, name);
    const stats = await fs.lstat(source);
    if (!stats.isFile()) {
      plan.skipped.push({ file: name, reason: "Not a regular file, so it is left where it is." });
      continue;
    }

    const to = `${ARCHIVE_DIR}/${year}-${month}/${name}`;
    if (await exists(path.join(realRoot, to))) {
      plan.skipped.push({ file: name, reason: "A file with this name is already in the archive." });
      continue;
    }
    plan.moves.push({ from: `${DAILY_DIR}/${name}`, to });
  }

  return plan;
}

/** Carries out the plan, one rename at a time. */
export async function applyDailyLogArchive(vaultRoot: string, now: Date): Promise<{ moved: number; skipped: number }> {
  const plan = await planDailyLogArchive(vaultRoot, now);
  const realRoot = await fs.realpath(vaultRoot);
  let moved = 0;
  let skipped = plan.skipped.filter((entry) => entry.reason.includes("already in the archive")).length;

  for (const move of plan.moves) {
    const from = path.join(realRoot, move.from);
    const to = path.join(realRoot, move.to);
    if (!isInside(realRoot, from) || !isInside(realRoot, to)) {
      skipped += 1;
      continue;
    }
    // Checked again here: the plan may be a moment old.
    if (await exists(to)) {
      skipped += 1;
      continue;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    moved += 1;
  }
  return { moved, skipped };
}
