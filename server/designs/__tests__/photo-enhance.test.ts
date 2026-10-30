import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENHANCE_ONLY_RULE, refinePrompt } from "../generation";
import {
  EnhancePhotosRequestSchema,
  MAX_ENHANCE_PHOTOS,
  pickEnhanceModel,
  prospectTag,
} from "../photo-enhance";

describe("choosing the enhancement model from the live catalogue", () => {
  const models = [
    { id: "vid_a", name: "Video A", kind: "video" as const },
    { id: "img_a", name: "Image A", kind: "image" as const },
    { id: "img_edit", name: "Photo Edit", kind: "image" as const },
  ];

  it("prefers the configured model when the catalogue offers it", () => {
    assert.equal(pickEnhanceModel(models, "img_a"), "img_a");
  });

  it("falls back to an edit model, then any image model, never a video or an unlisted one", () => {
    assert.equal(pickEnhanceModel(models, "gone"), "img_edit");
    assert.equal(pickEnhanceModel(models.filter((m) => m.id !== "img_edit"), "gone"), "img_a");
    assert.equal(pickEnhanceModel([models[0]], "gone"), undefined);
    assert.equal(pickEnhanceModel([], "gone"), undefined);
  });
});

describe("the enhance-only rule", () => {
  const request = {
    prompt: "Enhance this photo.",
    count: 1,
    refinePrompt: false,
  };

  it("is always on the rendered prompt, even when Hermes is not asked", async () => {
    const { prompt } = await refinePrompt(request, { enhanceOnly: true });
    assert.ok(prompt.includes(ENHANCE_ONLY_RULE));
    assert.match(prompt, /Enhance, don't invent/);
  });

  it("is not added to ordinary generations", async () => {
    const { prompt } = await refinePrompt(request);
    assert.equal(prompt, request.prompt);
  });
});

describe("tagging and validating a prospect's photos", () => {
  it("tags to a stable prospect slug", () => {
    assert.equal(prospectTag("  The Sea View Guesthouse! "), "prospect:the-sea-view-guesthouse");
  });

  it("needs a prospect and between one and the maximum number of photos", () => {
    assert.ok(EnhancePhotosRequestSchema.safeParse({ prospect: "A", photoAssetIds: ["x"] }).success);
    assert.ok(!EnhancePhotosRequestSchema.safeParse({ prospect: "A", photoAssetIds: [] }).success);
    assert.ok(!EnhancePhotosRequestSchema.safeParse({ prospect: "", photoAssetIds: ["x"] }).success);
    assert.ok(
      !EnhancePhotosRequestSchema.safeParse({
        prospect: "A",
        photoAssetIds: Array.from({ length: MAX_ENHANCE_PHOTOS + 1 }, (_, i) => String(i)),
      }).success,
    );
  });
});
