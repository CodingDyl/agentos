import crypto from "node:crypto";
import type {
  DesignGeneration,
  DesignGenerationRequest,
  GeneratedDesign,
} from "../../shared/design-generation-types";
import { recordActivity } from "../activity/ui-events";
import { authorize } from "../connectors/policy";
import { sendToHermes } from "../hermes/client";
import { createAsset } from "./library";
import { extensionFor, storeImage } from "./media";
import { projectContext, resolveReferences } from "./review-context";
import { createGenerationId, saveGeneration } from "./generation-store";
import { generationCapability, generationModel, render } from "./renderer";

/**
 * Turning intent into concepts.
 *
 * The whole point of putting this behind Hermes rather than wiring a prompt box
 * straight to an image model: the operator says what they want in their own
 * words, Hermes turns that into a prompt informed by what the project actually
 * is, and the renderer draws it. A prompt box alone would make the Designs page
 * a worse version of the tool it is imitating; this makes it part of AgentOS.
 *
 * Everything that comes back is saved into the library as a `generated` asset
 * carrying the prompt and its parent references. A concept whose provenance is
 * lost is just a picture.
 */

/** Enough of a picture to be worth keeping. Anything smaller is an error page. */
const MIN_IMAGE_BYTES = 1_024;

/** A ceiling on one downloaded image. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Asks Hermes to write the prompt.
 *
 * It is given the project and what the operator asked for, and nothing else —
 * the same scoping rule the visual review follows. A refusal or a failure is
 * not fatal: the operator's own words are used instead, and the record says
 * which of the two was rendered.
 */
export async function refinePrompt(
  request: DesignGenerationRequest,
): Promise<{ prompt: string; by: "operator" | "hermes" }> {
  if (!request.refinePrompt || !request.project) {
    return { prompt: request.prompt, by: "operator" };
  }

  const context = await projectContext(request.project).catch(() => "");

  const instruction = [
    "Write a single image-generation prompt.",
    "",
    `Project: ${request.project}`,
    "",
    "What the operator asked for:",
    request.prompt,
    "",
    context ? `Project context:\n\n${context}\n` : "",
    "Turn this into one concise visual prompt for an image model. Describe",
    "layout, mood, colour and typography in visual terms. Do not invent",
    "product features the project has not asked for.",
    "",
    "Reply with the prompt itself and nothing else: no preamble, no quotes,",
    "no explanation.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const reply = (
      await sendToHermes(instruction, {
        operation: "image-generation",
        project: request.project,
      })
    ).trim();

    // A model that answers a request for one line with three paragraphs has
    // not written a prompt. The operator's own words are better than that.
    if (reply.length === 0 || reply.length > 1_200) {
      return { prompt: request.prompt, by: "operator" };
    }

    return { prompt: reply, by: "hermes" };
  } catch {
    return { prompt: request.prompt, by: "operator" };
  }
}

/**
 * Fetches one rendered image into the library.
 *
 * The URL comes from the renderer's own response, never from the browser, and
 * anything that is not plausibly an image is refused rather than stored — an
 * expired link returns an error page, and an error page saved as a concept is
 * a broken tile nobody can explain later.
 */
async function saveRendered(
  url: string,
  request: DesignGenerationRequest,
  prompt: string,
  referenceAssetIds: string[],
  generationId: string,
): Promise<GeneratedDesign | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type") ?? "";
    const extension = extensionFor(contentType);

    if (!extension) return undefined;

    const data = Buffer.from(await response.arrayBuffer());

    if (data.byteLength < MIN_IMAGE_BYTES || data.byteLength > MAX_IMAGE_BYTES) {
      return undefined;
    }

    const id = crypto.randomUUID();
    const stored = await storeImage(id, extension, data);

    const asset = await createAsset({
      id,
      // Named for a person scanning a grid, not for a filesystem.
      filename: `${prompt.slice(0, 48).replace(/\s+/g, "-").toLowerCase()}${extension}`,
      storedName: stored.storedName,
      hasThumbnail: stored.hasThumbnail,
      dimensions: stored.dimensions,
      type: "generated",
      project: request.project,
      product: request.product,
      prompt,
      // Provenance travels with the picture: which renderer, which model,
      // which references, and which run it belonged to. A concept whose
      // provenance is lost is just a picture.
      source: "higgsfield",
      provider: "higgsfield",
      model: request.model?.trim() || generationModel(),
      generationId,
      referenceAssetIds,
    });

    return {
      assetId: asset.id,
      prompt,
      project: request.project,
      referenceAssetIds,
      createdAt: asset.createdAt,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one generation, start to finish.
 *
 * Variations are rendered one after another rather than at once: each is a
 * separate paid job, and a failure on the second should not leave the operator
 * wondering whether the first was charged for.
 */
export async function generate(
  request: DesignGenerationRequest,
): Promise<DesignGeneration> {
  const capability = await generationCapability();

  const generation: DesignGeneration = {
    id: createGenerationId(),
    status: capability.available ? "generating" : "failed",
    request,
    results: [],
    createdAt: new Date().toISOString(),
    error: capability.available ? undefined : capability.reason,
  };

  if (!capability.available) {
    generation.completedAt = new Date().toISOString();
    await saveGeneration(generation);
    return generation;
  }

  authorize("higgsfield.generate", {
    initiator: "person",
    detail: `${request.count} concept${request.count === 1 ? "" : "s"}${request.project ? ` for ${request.project}` : ""}`,
  });

  // Ids in, paths out. The browser never names a file.
  const { references } = await resolveReferences(request.referenceAssetIds ?? []);
  const referencePaths = references.map((reference) => reference.path);
  const referenceAssetIds = references.map((reference) => reference.assetId);

  const { prompt, by } = await refinePrompt(request);

  generation.finalPrompt = prompt;
  generation.promptBy = by;

  await saveGeneration(generation);

  const failures: string[] = [];

  for (let index = 0; index < request.count; index += 1) {
    try {
      const { urls } = await render({
        prompt,
        aspectRatio: request.aspectRatio,
        referencePaths,
        model: request.model,
      });

      if (urls.length === 0) {
        failures.push(
          "The renderer finished without returning an image URL this system could find.",
        );
        continue;
      }

      for (const url of urls) {
        const saved = await saveRendered(
          url,
          request,
          prompt,
          referenceAssetIds,
          generation.id,
        );

        if (saved) generation.results.push(saved);
      }
    } catch (error) {
      failures.push(
        error instanceof Error ? error.message : "The renderer failed.",
      );

      // A plan or session failure will not fix itself on the next variation,
      // and each attempt is a paid job. One is enough to learn that.
      break;
    }

    // Saved as it goes, so a long run is visible rather than appearing only at
    // the end — and a crash midway still leaves what was already made.
    await saveGeneration(generation);
  }

  generation.status = generation.results.length > 0 ? "completed" : "failed";
  generation.completedAt = new Date().toISOString();

  if (generation.results.length === 0) {
    generation.error = failures[0] ?? "Nothing was generated.";
  } else if (failures.length > 0) {
    // Partial success is still success, but not silently.
    generation.error = `Some variations failed: ${failures[0]}`;
  }

  await saveGeneration(generation);

  await recordActivity({
    type: "design.generated",
    description:
      generation.results.length > 0
        ? `${generation.results.length} concept${generation.results.length === 1 ? "" : "s"} generated: ${prompt.slice(0, 80)}`
        : `Generation failed: ${generation.error}`,
    project: request.project,
    metadata: {
      generationId: generation.id,
      results: generation.results.length,
      promptBy: by,
      references: referenceAssetIds.length,
    },
  });

  return generation;
}
