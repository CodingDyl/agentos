import { randomBytes } from "node:crypto";
import {
  assembleChangeObjective,
  ShipAddChangeRequestSchema,
  ShipPatchChangeRequestSchema,
  type ShipChangeItem,
} from "../../shared/ship-types";
import { readJob, startJob } from "../workers/job-manager";
import { ShipError } from "./error";
import { requireKnownProject, requireShipRoot } from "./root";
import { assertChangeId, readShipRecord, saveChanges, writeScreenshot } from "./store";

/**
 * The change list: what a person notices while previewing, kept until it is
 * sent as one Execute job through the ordinary worker system. A job finishing
 * marks its items done; it never deploys anything.
 */

function newId(): string {
  return `chg_${randomBytes(8).toString("hex")}`;
}

const jobHref = (id: string) => `/workers/jobs/${encodeURIComponent(id)}`;

async function syncJobStatus(items: ShipChangeItem[]): Promise<ShipChangeItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (!item.jobId || item.status !== "in_progress") return item;
      const job = await readJob(item.jobId).catch(() => undefined);
      if (!job) return item;
      if (job.status === "completed") return { ...item, status: "done" as const, error: undefined };
      if (job.status === "failed" || job.status === "rejected" || job.status === "cancelled") {
        return { ...item, status: "open" as const, selected: true, error: job.error ?? `The job was ${job.status}.` };
      }
      return item;
    }),
  );
}

export async function listShipChanges(slug: string): Promise<ShipChangeItem[]> {
  await requireKnownProject(slug);
  const record = await readShipRecord(slug);
  const synced = await syncJobStatus(record.changes);
  if (synced.some((item, index) => item !== record.changes[index])) await saveChanges(slug, synced);
  return synced;
}

export async function addShipChange(slug: string, raw: unknown): Promise<ShipChangeItem> {
  await requireKnownProject(slug);
  const input = ShipAddChangeRequestSchema.parse(raw);
  const id = newId();
  const screenshotId = input.screenshot ? await writeScreenshot(slug, id, input.screenshot) : undefined;
  const item: ShipChangeItem = {
    id,
    text: input.text,
    page: input.page?.trim() || undefined,
    url: input.url?.trim() || undefined,
    screenshotId,
    priority: input.priority ?? "medium",
    status: "open",
    selected: true,
    createdAt: new Date().toISOString(),
  };
  await saveChanges(slug, [...(await listShipChanges(slug)), item]);
  return item;
}

export async function patchShipChange(slug: string, id: string, raw: unknown): Promise<ShipChangeItem> {
  await requireKnownProject(slug);
  assertChangeId(id);
  const input = ShipPatchChangeRequestSchema.parse(raw);
  const current = await listShipChanges(slug);
  const index = current.findIndex((item) => item.id === id);
  if (index === -1) throw new ShipError("That change item was not found.", 404);
  const next = { ...current[index], ...input };
  current[index] = next;
  await saveChanges(slug, current);
  return next;
}

export async function deleteShipChange(slug: string, id: string): Promise<void> {
  await requireKnownProject(slug);
  assertChangeId(id);
  const current = await listShipChanges(slug);
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) throw new ShipError("That change item was not found.", 404);
  await saveChanges(slug, next);
}

export async function sendShipChanges(
  slug: string,
  ids?: string[],
  start: typeof startJob = startJob,
): Promise<{ jobId: string; href: string; changes: ShipChangeItem[]; objective: string }> {
  const folder = await requireShipRoot(slug);
  const current = await listShipChanges(slug);
  const selected = current.filter((item) => (ids?.length ? ids.includes(item.id) : item.selected) && item.status === "open");
  if (selected.length === 0) throw new ShipError("Select at least one open change to send.", 409);

  const objective = assembleChangeObjective(selected);
  const started = await start({
    worker: "auto",
    project: slug,
    objective,
    repoPath: folder,
    modelRouteType: "execute",
    acceptanceCriteria: selected.map((item) => item.text),
  });
  if (!started.job) throw new ShipError(started.error ?? "The coding agent could not be started.", 409);

  const jobId = started.job.id;
  const href = jobHref(jobId);
  const picked = new Set(selected.map((item) => item.id));
  const updated = current.map((item) =>
    picked.has(item.id) ? { ...item, status: "in_progress" as const, selected: false, jobId, jobHref: href, error: undefined } : item,
  );
  await saveChanges(slug, updated);
  return { jobId, href, changes: updated, objective };
}
