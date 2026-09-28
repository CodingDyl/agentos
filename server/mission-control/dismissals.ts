import fs from "node:fs/promises";
import path from "node:path";
import type { AttentionItem } from "../../shared/mission-control-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Cards the operator has cleared from Today's Needs you.
 *
 * A dismissal is keyed by the card's id *and* the moment it became a problem
 * (`createdAt`), so it covers that occurrence only: a job that fails again, an
 * automation that fails on its next run, comes back as a new card. Nothing
 * about the job, automation or workspace itself changes — they stay exactly
 * where they are in Worker jobs, Automations and Workspaces.
 */

interface Dismissal {
  id: string;
  createdAt: string;
  dismissedAt: string;
}

/** Old enough that the thing it hid has certainly moved on. Keeps the file small. */
const KEEP_DAYS = 90;

function dismissalsFile(): string {
  return path.join(uiStateDir(), "today-dismissals.json");
}

function keyOf(entry: { id: string; createdAt: string }): string {
  return `${entry.id}@${entry.createdAt}`;
}

async function readAll(): Promise<Dismissal[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(dismissalsFile(), "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is Dismissal =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as Dismissal).id === "string" &&
            typeof (entry as Dismissal).createdAt === "string",
        )
      : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: readonly Dismissal[]): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const target = dismissalsFile();
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export async function dismissAttention(
  items: readonly { id: string; createdAt: string }[],
  now: Date = new Date(),
): Promise<void> {
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const kept = (await readAll()).filter((entry) => Date.parse(entry.dismissedAt) >= cutoff);
  const known = new Set(kept.map(keyOf));

  for (const item of items) {
    if (known.has(keyOf(item))) continue;
    kept.push({ id: item.id, createdAt: item.createdAt, dismissedAt: now.toISOString() });
    known.add(keyOf(item));
  }

  await writeAll(kept);
}

/** Brings cards back. With no ids, restores every dismissal. */
export async function restoreAttention(ids?: readonly string[]): Promise<void> {
  if (!ids || ids.length === 0) {
    await writeAll([]);
    return;
  }
  const restore = new Set(ids);
  await writeAll((await readAll()).filter((entry) => !restore.has(entry.id)));
}

/** Splits the live list into what Today shows and what the operator cleared. */
export async function applyDismissals(
  items: readonly AttentionItem[],
): Promise<{ attention: AttentionItem[]; dismissed: AttentionItem[] }> {
  const dismissed = new Set((await readAll()).map(keyOf));
  const attention: AttentionItem[] = [];
  const hidden: AttentionItem[] = [];
  for (const item of items) (dismissed.has(keyOf(item)) ? hidden : attention).push(item);
  return { attention, dismissed: hidden };
}
