import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";
import { keyEnvNameFor, type DatabaseSetup } from "../../shared/database-types";

/**
 * The named Supabase setups on this machine, and which workspaces use each.
 *
 * Kept outside the vault on purpose: a setup names a key that only this
 * machine's `.env` holds, so a link synced to another machine would point at
 * nothing. The file holds names, URLs and links; the key is in `.env` under
 * `SUPABASE_KEY__<ID>` and nowhere else.
 */

interface StoredSetup {
  id: string;
  name: string;
  url: string;
  environment?: string;
  projectSlugs: string[];
  lastTest?: { ok: boolean; checkedAt: string; detail: string };
}

let cache: StoredSetup[] | undefined;

function file(): string {
  return path.join(uiStateDir(), "supabase-setups.json");
}

function read(): StoredSetup[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as { setups?: unknown };
    cache = Array.isArray(parsed.setups)
      ? parsed.setups.flatMap((raw): StoredSetup[] => {
          const entry = raw as Partial<StoredSetup>;
          if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.url !== "string") return [];
          return [
            {
              id: entry.id,
              name: entry.name,
              url: entry.url,
              environment: typeof entry.environment === "string" ? entry.environment : undefined,
              projectSlugs: Array.isArray(entry.projectSlugs) ? entry.projectSlugs.filter((slug): slug is string => typeof slug === "string") : [],
              lastTest: entry.lastTest,
            },
          ];
        })
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: StoredSetup[]): void {
  cache = next;
  fs.mkdirSync(uiStateDir(), { recursive: true });
  const target = file();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ setups: next }, null, 2), "utf8");
  fs.renameSync(temporary, target);
}

function toPublic(setup: StoredSetup): DatabaseSetup {
  const keyEnvName = keyEnvNameFor(setup.id);
  return { ...setup, keyEnvName, keySet: Boolean(process.env[keyEnvName]?.trim()) };
}

export function listSetups(): DatabaseSetup[] {
  return read().map(toPublic);
}

export function findSetup(id: string): DatabaseSetup | undefined {
  const setup = read().find((entry) => entry.id === id);
  return setup ? toPublic(setup) : undefined;
}

export function setupsForProject(slug: string): DatabaseSetup[] {
  return listSetups().filter((setup) => setup.projectSlugs.includes(slug));
}

export function saveSetup(setup: Omit<StoredSetup, "lastTest"> & { lastTest?: StoredSetup["lastTest"] }): DatabaseSetup {
  const others = read().filter((entry) => entry.id !== setup.id);
  const previous = read().find((entry) => entry.id === setup.id);
  const next: StoredSetup = {
    ...setup,
    // A changed address invalidates the last test; anything else keeps it.
    lastTest: setup.lastTest ?? (previous && previous.url === setup.url ? previous.lastTest : undefined),
    projectSlugs: [...new Set(setup.projectSlugs)],
  };
  write([...others, next].sort((a, b) => a.name.localeCompare(b.name)));
  return toPublic(next);
}

export function recordTest(id: string, lastTest: NonNullable<StoredSetup["lastTest"]>): void {
  write(read().map((entry) => (entry.id === id ? { ...entry, lastTest } : entry)));
}

export function removeSetup(id: string): boolean {
  const before = read();
  const after = before.filter((entry) => entry.id !== id);
  if (after.length === before.length) return false;
  write(after);
  return true;
}

/** Only tests need this. */
export function resetSetupCache(): void {
  cache = undefined;
}
