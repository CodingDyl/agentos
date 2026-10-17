import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ShipChangeItemSchema, type ShipChangeItem, type ShipDeployTarget, type ShipGitRemote } from "../../shared/ship-types";
import { uiStateDir } from "../agentos/session-store";

const ShipRecordSchema = z.object({
  slug: z.string(),
  github: z
    .object({
      owner: z.string(),
      name: z.string(),
      fullName: z.string(),
      htmlUrl: z.string(),
    })
    .optional(),
  changes: z.array(ShipChangeItemSchema).default([]),
  lastDeploy: z
    .object({
      target: z.enum(["preview", "production"]),
      id: z.string().optional(),
      state: z.string().optional(),
      url: z.string().optional(),
      logs: z.string().optional(),
      error: z.string().optional(),
      updatedAt: z.string(),
    })
    .optional(),
});

export type ShipRecord = z.infer<typeof ShipRecordSchema>;

function recordPath(slug: string): string {
  return path.join(uiStateDir(), "ship", `${slug}.json`);
}

export function shipShotPath(slug: string, id: string): string {
  return path.join(uiStateDir(), "ship", slug, "shots", `${id}.png`);
}

export async function readShipRecord(slug: string): Promise<ShipRecord> {
  const raw = await fs.readFile(recordPath(slug), "utf8").catch(() => undefined);
  if (!raw) return { slug, changes: [] };
  const parsed = ShipRecordSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : { slug, changes: [] };
}

export async function saveShipRecord(record: ShipRecord): Promise<ShipRecord> {
  const next = ShipRecordSchema.parse(record);
  const target = recordPath(next.slug);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function rememberGithub(slug: string, remote: ShipGitRemote): Promise<void> {
  const current = await readShipRecord(slug);
  await saveShipRecord({ ...current, github: remote });
}

export async function rememberDeploy(
  slug: string,
  deploy: {
    target: ShipDeployTarget;
    id?: string;
    state?: string;
    url?: string;
    logs?: string;
    error?: string;
  },
): Promise<void> {
  const current = await readShipRecord(slug);
  await saveShipRecord({
    ...current,
    lastDeploy: { ...deploy, updatedAt: new Date().toISOString() },
  });
}

export async function saveChanges(slug: string, changes: ShipChangeItem[]): Promise<ShipChangeItem[]> {
  const current = await readShipRecord(slug);
  await saveShipRecord({ ...current, changes });
  return changes;
}

export async function writeScreenshot(slug: string, id: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) throw new Error("Screenshot must be a PNG, JPEG or WebP data URL.");
  const target = shipShotPath(slug, id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(match[1], "base64"));
  return id;
}
