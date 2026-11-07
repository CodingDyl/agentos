import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { OwnerHoursEntrySchema, type LogOwnerHoursRequest, type OwnerHoursEntry } from "../../shared/outcomes-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The owner's logged hours, as one small JSON file in AgentOS's UI state.
 *
 * Hours are only ever what the owner typed: nothing is inferred, because a
 * guess shown as a measurement would make the rand-per-hour figure a lie.
 * Written atomically and serialised, so two quick entries cannot lose one
 * another; an unreadable entry is skipped rather than failing the list.
 */

const MAX_ENTRIES = 5000;

export function ownerHoursFile(): string {
  return path.join(uiStateDir(), "owner-hours.json");
}

export async function readOwnerHours(): Promise<OwnerHoursEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(ownerHoursFile(), "utf8"));
    const items = Array.isArray((parsed as { items?: unknown })?.items) ? (parsed as { items: unknown[] }).items : [];
    return items.flatMap((item) => {
      const result = OwnerHoursEntrySchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

async function writeOwnerHours(items: OwnerHoursEntry[]): Promise<void> {
  const file = ownerHoursFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function logOwnerHours(input: LogOwnerHoursRequest): Promise<OwnerHoursEntry> {
  return serial(async () => {
    const entry: OwnerHoursEntry = {
      ...input,
      note: input.note?.trim() || undefined,
      id: `oh-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      createdAt: new Date().toISOString(),
    };
    // Past the cap the oldest entry goes first.
    const next = [entry, ...(await readOwnerHours())].slice(0, MAX_ENTRIES);
    await writeOwnerHours(next);
    return entry;
  });
}

/** True when an entry was removed. */
export function deleteOwnerHours(id: string): Promise<boolean> {
  return serial(async () => {
    const items = await readOwnerHours();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    await writeOwnerHours(next);
    return true;
  });
}
