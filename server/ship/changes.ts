import { randomBytes } from "node:crypto";
import {
  assembleChangeObjective,
  type ShipAddChangeRequest,
  type ShipChangeItem,
  type ShipPatchChangeRequest,
} from "../../shared/ship-types";
import { ShipAddChangeRequestSchema, ShipPatchChangeRequestSchema } from "../../shared/ship-types";
import { startJob, readJob } from "../workers/job-manager";
import { ShipError } from "./error";
import { requireKnownProject, requireShipRoot } from "./root";
import { readShipRecord, saveChanges, writeScreenshot } from "./store";

function newId(): string {
  return `chg_${randomBytes(8).toString("hex")}`;
}

async function syncJobStatus(items: ShipChangeItem[]): Promise<ShipChangeItem[]> {
  const next: ShipChangeItem[] = [];
  for (const item of items) {
    if (!item.jobId || item.status !== "in_progress") {
      next.push(item);
      continue;
    }
    const job = await readJob(item.jobId);
    if (!job) {
      next.push(item);
      continue;
    }
    if (job.status === "completed") {
      next.push({ ...item, status: "done" as const, error: undefined, jobHref: `/workers/jobs/${job.id}` });
      continue;
    }
    if (job.status === "failed" || job.status === "rejected" || job.status === "cancelled") {
      next.push({ ...item, status: "open" as const, error: job.error ?? `Job ${job.status}.`, jobHref: `/workers/jobs/${job.id}` });
      continue;
    }
    next.push({ ...item, jobHref: `/workers/jobs/${job.id}` });
  }
  return next;
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
  const input = ShipAddChangeRequestSchema.parse(raw) as ShipAddChangeRequest;
  const id = newId();
  let screenshotId: string | undefined;
  if (input.screenshot) screenshotId = await writeScreenshot(slug, id, input.screenshot);
  const item: ShipChangeItem = {
    id,
    text: input.text.trim(),
    page: input.page?.trim() || undefined,
    url: input.url?.trim() || undefined,
    screenshotId,
    priority: input.priority ?? "medium",
    status: "open",
    selected: true,
    createdAt: new Date().toISOString(),
  };
  const current = await listShipChanges(slug);
  await saveChanges(slug, [...current, item]);
  return item;
}

export async function patchShipChange(slug: string, id: string, raw: unknown): Promise<ShipChangeItem> {
  await requireKnownProject(slug);
  const input = ShipPatchChangeRequestSchema.parse(raw) as ShipPatchChangeRequest;
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
  await requireKnownProject(slug);
  const folder = await requireShipRoot(slug);
  const current = await listShipChanges(slug);
  const selected = current.filter((item) => (ids?.length ? ids.includes(item.id) : item.selected) && item.status !== "done");
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
  const href = `/workers/jobs/${jobId}`;
  const updated = current.map((item) =>
    selected.some((picked) => picked.id === item.id)
      ? { ...item, status: "in_progress" as const, selected: false, jobId, jobHref: href, error: undefined }
      : item,
  );
  await saveChanges(slug, updated);
  return { jobId, href, changes: updated, objective };
}

export type { ShipAddChangeRequest, ShipPatchChangeRequest };
