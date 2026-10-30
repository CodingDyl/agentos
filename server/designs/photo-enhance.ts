import { z } from "zod";
import type { HiggsfieldModel } from "../../shared/design-generation-types";
import { generate, ENHANCE_ONLY_RULE } from "./generation";
import { listModels } from "./higgsfield";
import { generationModel } from "./renderer";
import type { DesignGeneration } from "../../shared/design-generation-types";

/**
 * Enhancing a prospect's own photos for the "Better photos, free" approach.
 *
 * Each photo goes through `generate()` on its own, as the single reference, so
 * every result can be compared with the original it came from. Results land in
 * the Designs library as `generated` assets tagged to the prospect.
 */

/** A free sample is two or three photos; more is a paid job. */
export const MAX_ENHANCE_PHOTOS = 6;

const BASE_PROMPT = "Enhance this photo of a business's own premises for its listing.";

export function prospectTag(prospect: string): string {
  const slug = prospect
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `prospect:${slug}`;
}

/**
 * Picks the image model from the live catalogue. Prefers the configured model
 * when the catalogue still offers it, then an enhancement/edit model, then any
 * image model. Never returns a model the catalogue does not list.
 */
export function pickEnhanceModel(
  models: readonly HiggsfieldModel[],
  preferred: string = generationModel(),
): string | undefined {
  const images = models.filter((model) => model.kind === "image");
  return (
    images.find((model) => model.id === preferred) ??
    images.find((model) => /enhanc|upscal|edit/i.test(`${model.id} ${model.name}`)) ??
    images[0]
  )?.id;
}

export const EnhancePhotosRequestSchema = z.object({
  /** Business or prospect name; becomes the `prospect:<slug>` tag. */
  prospect: z.string().trim().min(1).max(120),
  /** Library assets holding the prospect's photos. */
  photoAssetIds: z.array(z.string().min(1)).min(1).max(MAX_ENHANCE_PHOTOS),
  project: z.string().optional(),
});

export type EnhanceProspectPhotosInput = z.infer<typeof EnhancePhotosRequestSchema>;

export async function enhanceProspectPhotos(
  input: EnhanceProspectPhotosInput,
): Promise<DesignGeneration[]> {
  const ids = [...new Set(input.photoAssetIds)].slice(0, MAX_ENHANCE_PHOTOS);
  if (ids.length === 0) throw new Error("Choose at least one photo to enhance.");

  const model = pickEnhanceModel(await listModels());
  if (!model) throw new Error("Higgsfield offers no image model to enhance photos with.");

  const tags = [prospectTag(input.prospect), "enhanced"];
  const generations: DesignGeneration[] = [];

  // One paid job at a time; stop at the first failure rather than spend on more.
  for (const id of ids) {
    const generation = await generate(
      {
        project: input.project,
        model,
        prompt: BASE_PROMPT,
        referenceAssetIds: [id],
        count: 1,
        refinePrompt: true,
      },
      { enhanceOnly: true, tags },
    );
    generations.push(generation);
    if (generation.status === "failed") break;
  }

  return generations;
}

export { ENHANCE_ONLY_RULE };
