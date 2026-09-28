import path from "node:path";
import type { CaseStudy } from "../../shared/traction-types";
import { findStoredAsset, type StoredAsset } from "../designs/library";
import { ORIGINALS, readImage } from "../designs/media";
import type { ZipEntry } from "./zip";

/**
 * A case study as files for the Virtara site: `case-study.md` and `images/`.
 *
 * Built on the server because only the server knows each image's real format
 * (its stored extension), so the names in the Markdown and the files in the
 * ZIP always agree. The images come from Creative by id; a study never names
 * a path, and an image deleted from Creative is simply left out.
 *
 * Gaps stay visible. A `[NEEDS DATA]` left in a section is exported as
 * written: silently dropping it would turn a missing fact into a claim.
 */

export interface ExportImage {
  /** Path inside the export, e.g. `images/01-configurator.png`. */
  name: string;
  alt: string;
  asset: StoredAsset;
}

/** A filename stem safe on any system: lower-case letters, digits and hyphens. */
function slug(text: string, fallback: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || fallback;
}

/** Alt text a screen reader can use: the asset's notes, else its filename made readable. */
function altFor(asset: StoredAsset): string {
  const note = asset.notes?.trim();
  if (note) return note.split("\n")[0].slice(0, 120);
  return asset.filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim() || "Screenshot";
}

/** The study's images that still exist in Creative and are stills, in the study's order. */
export async function resolveImages(study: CaseStudy): Promise<ExportImage[]> {
  const images: ExportImage[] = [];

  for (const id of study.assetIds) {
    const asset = await findStoredAsset(id);
    if (!asset || asset.mediaType === "video") continue;
    const index = String(images.length + 1).padStart(2, "0");
    const extension = path.extname(asset.storedName).toLowerCase() || ".png";
    images.push({ name: `images/${index}-${slug(asset.filename, "screenshot")}${extension}`, alt: altFor(asset), asset });
  }

  return images;
}

function section(heading: string, body: string | undefined): string | undefined {
  return body?.trim() ? `## ${heading}\n\n${body.trim()}\n` : undefined;
}

/** Markdown with the images placed after "What we built", where they show the thing. */
export function caseStudyMarkdown(study: CaseStudy, images: readonly Pick<ExportImage, "name" | "alt">[]): string {
  const gallery = images.length > 0 ? `${images.map((image) => `![${image.alt.replace(/[[\]]/g, "")}](${image.name})`).join("\n\n")}\n` : undefined;
  const quote = study.testimonial?.trim()
    ? `> ${study.testimonial.trim().replace(/\n/g, "\n> ")}\n>\n> ${study.client}\n`
    : undefined;

  return [
    `# ${study.title}`,
    "",
    `*${study.client}*`,
    "",
    section("The problem", study.problem),
    section("What we built", study.solution),
    gallery,
    section("How", study.implementation),
    section("The result", study.result),
    quote,
  ]
    .filter((part) => part !== undefined)
    .join("\n")
    .trim()
    .concat("\n");
}

/** Every file in the export. Images that cannot be read from disk are left out, not faked. */
export async function caseStudyFiles(study: CaseStudy): Promise<{ markdown: string; entries: ZipEntry[]; skipped: number }> {
  const images = await resolveImages(study);
  const entries: ZipEntry[] = [];
  const included: ExportImage[] = [];

  for (const image of images) {
    const data = await readImage(ORIGINALS, image.asset.storedName);
    if (!data) continue;
    entries.push({ name: image.name, data });
    included.push(image);
  }

  const markdown = caseStudyMarkdown(study, included);
  return {
    markdown,
    entries: [{ name: "case-study.md", data: Buffer.from(markdown, "utf8") }, ...entries],
    skipped: study.assetIds.length - included.length,
  };
}

/** The download's filename, from the study's title. */
export function exportFilename(study: CaseStudy): string {
  return `${slug(study.title, "case-study")}.zip`;
}
