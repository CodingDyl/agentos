import { VirtecScanInfoSchema, VirtecScanResultSchema, type VirtecScanInfo, type VirtecScanResult } from "../../shared/virtec-types";
import { getVirtec, postVirtecScan, VIRTEC_PATHS, VirtecError, type VirtecScanRequest } from "./client";
import { clearVirtecCache } from "./snapshot";

/**
 * Places scans, asked of Virtec.
 *
 * Virtec finds the businesses, holds the Places key and enforces the monthly
 * cap; AgentOS chooses where to look and reads what came back. Answers are
 * parsed rather than trusted: a Virtec that changes shape fails here with a
 * plain message instead of putting a blank panel on the screen.
 */

export async function getScanInfo(fetcher: typeof fetch = fetch): Promise<VirtecScanInfo> {
  const parsed = VirtecScanInfoSchema.safeParse(await getVirtec(VIRTEC_PATHS.scanInfo, fetcher));
  if (!parsed.success) throw new VirtecError("Virtec's scan options could not be read. Is Virtec up to date?", "bad-response");
  return parsed.data;
}

/**
 * Runs a scan. The candidates it found are new to the cached snapshot, so
 * the cache is dropped: the list on screen picks them up on its next read.
 */
export async function runScan(request: VirtecScanRequest, fetcher: typeof fetch = fetch): Promise<VirtecScanResult> {
  const parsed = VirtecScanResultSchema.safeParse(await postVirtecScan(request, fetcher));
  if (!parsed.success) throw new VirtecError("Virtec answered the scan, but not in a shape AgentOS can read.", "bad-response");
  clearVirtecCache();
  return parsed.data;
}

/** The Places requests a choice of categories would make at most: each type once, however many categories share it. */
export function requestsFor(info: Pick<VirtecScanInfo, "categories">, track: string, categories: readonly string[]): number {
  return new Set(info.categories.filter((entry) => entry.track === track && categories.includes(entry.category)).flatMap((entry) => entry.types)).size;
}
