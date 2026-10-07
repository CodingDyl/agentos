import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * Everything ticked off on Today, remembered beyond the day it was ticked.
 *
 * A tick reaches the source where it can (a workspace task with an id, a box
 * in an area's TASKS.md), but not every pick has a box to tick: this week's
 * outcomes, an outreach follow-up, a task with no id. Without this, those
 * came back on tomorrow's shortlist as if nothing had happened. The shortlist
 * now leaves out anything recorded here; unticking takes it back out.
 *
 * Keyed by candidate id, which already names the exact thing (a follow-up
 * id includes which email it is, so the next follow-up still shows up).
 */

const MAX_ENTRIES = 2000;

function ledgerFile(): string {
  return path.join(uiStateDir(), "focus-done.json");
}

/**
 * Ticks made before this ledger existed, read from the days Focus already
 * keeps (`focus-days.json`, the last 45 days), so they don't all come back
 * once the first time the ledger is read.
 */
async function ticksFromPastDays(): Promise<Record<string, string>> {
  try {
    const days: unknown = JSON.parse(await fs.readFile(path.join(uiStateDir(), "focus-days.json"), "utf8"));
    const seeded: Record<string, string> = {};
    for (const [date, day] of Object.entries((days ?? {}) as Record<string, { done?: unknown }>)) {
      if (!Array.isArray(day?.done)) continue;
      for (const id of day.done) if (typeof id === "string" && (!seeded[id] || seeded[id] < date)) seeded[id] = date;
    }
    return seeded;
  } catch {
    return {};
  }
}

export async function readDoneLedger(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(ledgerFile(), "utf8");
  } catch {
    return ticksFromPastDays();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Records a tick (or takes one back). Writes are serialised and atomic, like the day file. */
export function recordDone(candidateId: string, done: boolean, date: string): Promise<void> {
  const run = queue.then(async () => {
    const ledger = await readDoneLedger();
    if (done) ledger[candidateId] = date;
    else delete ledger[candidateId];
    // Newest first; the oldest ticks fall off long after they could matter.
    const kept = Object.fromEntries(Object.entries(ledger).sort(([, a], [, b]) => b.localeCompare(a)).slice(0, MAX_ENTRIES));
    await fs.mkdir(uiStateDir(), { recursive: true });
    const temporary = `${ledgerFile()}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(kept, null, 2)}\n`, "utf8");
    await fs.rename(temporary, ledgerFile());
  });
  queue = run.catch(() => undefined);
  return run;
}
