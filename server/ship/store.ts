import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SHIP_CHANGE_ID, ShipChangeItemSchema, ShipDeployTargetSchema, ShipGitRemoteSchema, type ShipChangeItem, type ShipGitRemote } from "../../shared/ship-types";
import { uiStateDir } from "../agentos/session-store";
import { ShipError } from "./error";
import { assertShipSlug, resolveInside } from "./root";

/**
 * What Ship remembers per workspace: the linked GitHub repo, the change list,
 * and the last deploy. It lives in AgentOS' own UI state, never in the
 * project's repository, so nothing Ship records is ever committed or pushed.
 */

const ShipDeployRecordSchema = z.object({
  target: ShipDeployTargetSchema,
  id: z.string().optional(),
  commit: z.string().optional(),
  state: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
  updatedAt: z.string(),
});

const ShipRecordSchema = z.object({
  slug: z.string(),
  github: ShipGitRemoteSchema.optional(),
  changes: z.array(ShipChangeItemSchema).default([]),
  lastDeploy: ShipDeployRecordSchema.optional(),
});

export type ShipRecord = z.infer<typeof ShipRecordSchema>;
export type ShipDeployRecord = z.infer<typeof ShipDeployRecordSchema>;

function shipDir(): string {
  return path.join(uiStateDir(), "ship");
}

function recordPath(slug: string): string {
  return path.join(shipDir(), `${assertShipSlug(slug)}.json`);
}

export function assertChangeId(id: string): string {
  if (!SHIP_CHANGE_ID.test(id)) throw new ShipError("That change item was not found.", 404);
  return id;
}

/** The screenshot for a change, proven to be inside Ship's own state folder. */
export async function shipShotPath(slug: string, id: string): Promise<string> {
  return resolveInside(shipDir(), path.join(assertShipSlug(slug), "shots", `${assertChangeId(id)}.png`));
}

export async function readShipRecord(slug: string): Promise<ShipRecord> {
  const raw = await fs.readFile(recordPath(slug), "utf8").catch(() => undefined);
  if (!raw) return { slug, changes: [] };
  try {
    const parsed = ShipRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { slug, changes: [] };
  } catch {
    return { slug, changes: [] };
  }
}

export async function saveShipRecord(record: ShipRecord): Promise<ShipRecord> {
  const next = ShipRecordSchema.parse(record);
  const target = recordPath(next.slug);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(temporary, target);
  return next;
}

export async function rememberGithub(slug: string, remote: ShipGitRemote): Promise<void> {
  const current = await readShipRecord(slug);
  await saveShipRecord({ ...current, github: remote });
}

export async function rememberDeploy(slug: string, deploy: Omit<ShipDeployRecord, "updatedAt">): Promise<ShipDeployRecord> {
  const current = await readShipRecord(slug);
  const lastDeploy = { ...deploy, updatedAt: new Date().toISOString() };
  await saveShipRecord({ ...current, lastDeploy });
  return lastDeploy;
}

export async function saveChanges(slug: string, changes: ShipChangeItem[]): Promise<ShipChangeItem[]> {
  const current = await readShipRecord(slug);
  await saveShipRecord({ ...current, changes });
  return changes;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP = Buffer.from("WEBP");

/** Decodes a PNG, JPEG or WebP data URL and stores it beside the change. The bytes must be the image they claim to be. */
export async function writeScreenshot(slug: string, id: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) throw new ShipError("A screenshot must be a PNG, JPEG or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  const valid = bytes.subarray(0, 4).equals(PNG) || bytes.subarray(0, 3).equals(JPEG) || bytes.subarray(8, 12).equals(WEBP);
  if (!valid) throw new ShipError("A screenshot must be a PNG, JPEG or WebP image.");
  const target = await shipShotPath(slug, id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return id;
}
