import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { DesignAsset } from "../../shared/agentos-types";
import type { TasteReference } from "../../shared/worker-types";
import { getProjects } from "../agentos/projects";
import {
  createAssetOnce,
  findStoredAsset,
  fingerprint,
  getLibrary,
  listStoredAssets,
  updateAsset,
} from "../designs/library";
import { deleteImage, ORIGINALS, resolveMedia, storeImage } from "../designs/media";
import { checkUrl, SafeFetchError } from "../web/safe-fetch";
import { captureReferences } from "../website-rebuild/references";

/**
 * Taste Vault: the owner's collected inspiration. Not a store of its own: a
 * taste item is a design-library asset of type `reference`, and this module is
 * the view over those plus the two things the library did not do, photographing
 * a URL and attaching a reference to a workspace.
 */

export class TasteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The most references one job is handed. */
export const TASTE_JOB_CAP = 12;
/** A snippet rides in the worker's prompt, so a job gets the start of a long one. */
const SNIPPET_PROMPT_CHARS = 4_000;

/** Swapped in tests, so no test ever launches a browser. */
export const tasteDeps = {
  /** A PNG of the page, or nothing when it could not be photographed. */
  capture: async (url: string): Promise<Buffer | undefined> => {
    const [shot] = await captureReferences([{ label: new URL(url).hostname, url }]);
    return shot ? fs.readFile(shot.file) : undefined;
  },
};

/** Every reference, newest first; only one workspace's when a slug is given. */
export async function listTaste(workspace?: string): Promise<DesignAsset[]> {
  const { assets } = await getLibrary();
  return assets.filter((asset) => asset.type === "reference" && (!workspace || asset.attachedTo.includes(workspace)));
}

function cleanTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/** Photographs a public page and files it as a reference. The same picture twice is one asset. */
export async function addUrlReference(input: { url: string; notes?: string; tags?: string[] }): Promise<{ asset: DesignAsset; created: boolean }> {
  let url: URL;
  try {
    url = checkUrl(input.url);
  } catch (error) {
    throw new TasteError(400, error instanceof SafeFetchError ? error.message : "That is not a web address.");
  }

  const shot = await tasteDeps.capture(url.href);
  if (!shot) throw new TasteError(422, "That page could not be photographed. Save a screenshot of it and drop that in instead.");

  const id = randomUUID();
  const stored = await storeImage(id, ".png", shot);
  const result = await createAssetOnce({
    id,
    sha256: fingerprint(shot),
    filename: `${url.hostname}.png`,
    storedName: stored.storedName,
    hasThumbnail: stored.hasThumbnail,
    dimensions: stored.dimensions,
    type: "reference",
    notes: input.notes?.trim() || undefined,
    tags: cleanTags(input.tags),
    sourceUrl: url.href,
  });
  if (!result.created) await deleteImage(stored.storedName);
  return result;
}

export interface TastePatch {
  notes?: string | null;
  tags?: string[];
  snippet?: string | null;
  attachedTo?: string[];
}

/** Updates a reference. Undefined when the id names no reference asset. */
export async function updateTaste(id: string, patch: TastePatch): Promise<DesignAsset | undefined> {
  if ((await findStoredAsset(id))?.type !== "reference") return undefined;

  if (patch.attachedTo?.length) {
    const known = new Set((await getProjects("all")).map((project) => project.slug));
    const unknown = patch.attachedTo.filter((slug) => !known.has(slug));
    if (unknown.length > 0) throw new TasteError(400, `There is no workspace called ${unknown.join(", ")}.`);
  }

  return updateAsset(id, patch);
}

/** What a job in this workspace is shown: its attached image references, newest first, capped. */
export async function tasteReferencesFor(slug: string): Promise<TasteReference[]> {
  return (await listStoredAssets())
    .filter((asset) => asset.type === "reference" && asset.mediaType !== "video" && asset.attachedTo?.includes(slug))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, TASTE_JOB_CAP)
    .map((asset) => ({
      path: resolveMedia(ORIGINALS, asset.storedName),
      filename: asset.filename,
      notes: asset.notes,
      tags: asset.tags,
      sourceUrl: asset.sourceUrl,
      snippet:
        asset.snippet && asset.snippet.length > SNIPPET_PROMPT_CHARS
          ? `${asset.snippet.slice(0, SNIPPET_PROMPT_CHARS)}\n…(truncated)`
          : asset.snippet,
    }));
}
