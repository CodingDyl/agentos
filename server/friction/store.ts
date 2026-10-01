import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  FrictionItemSchema,
  type FrictionItem,
  type FrictionStatus,
  type ReportFrictionRequest,
} from "../../shared/friction-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The friction inbox, as one small JSON file in AgentOS's UI state.
 *
 * Outside the vault: these are notes about the tool, not about the work.
 * Written atomically and serialised, so two quick reports cannot lose one
 * another; an unreadable item is skipped rather than failing the list.
 */

const MAX_ITEMS = 500;

export function frictionFile(): string {
  return path.join(uiStateDir(), "friction.json");
}

export async function readFriction(): Promise<FrictionItem[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(frictionFile(), "utf8"));
    const items = Array.isArray((parsed as { items?: unknown })?.items) ? (parsed as { items: unknown[] }).items : [];
    return items.flatMap((item) => {
      const result = FrictionItemSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

async function writeFriction(items: FrictionItem[]): Promise<void> {
  const file = frictionFile();
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

/** Only an in-app path is kept: never a full URL that could carry a token. */
function cleanRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const trimmed = route.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  return trimmed.split("#")[0].slice(0, 300);
}

export function reportFriction(input: ReportFrictionRequest): Promise<FrictionItem> {
  return serial(async () => {
    const item: FrictionItem = {
      id: `fr-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      description: input.description.trim(),
      route: cleanRoute(input.route),
      frequency: input.frequency,
      severity: input.severity,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    const items = await readFriction();
    // Past the cap the oldest closed item goes first; open ones are kept longest.
    const next = [item, ...items];
    while (next.length > MAX_ITEMS) {
      const closed = next.findLastIndex((entry) => entry.status !== "open");
      next.splice(closed >= 0 ? closed : next.length - 1, 1);
    }
    await writeFriction(next);
    return item;
  });
}

export function updateFrictionStatus(id: string, status: FrictionStatus): Promise<FrictionItem | undefined> {
  return serial(async () => {
    const items = await readFriction();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const updated = { ...items[index], status, updatedAt: new Date().toISOString() };
    items[index] = updated;
    await writeFriction(items);
    return updated;
  });
}
