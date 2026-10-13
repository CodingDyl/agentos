import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewPublishOverridesVisible } from "../preview-publish-model";

describe("preview publish overrides", () => {
  it("shows force, re-check and mark-as-deployed only on a blocked Vercel preview", () => {
    assert.equal(previewPublishOverridesVisible({ id: "preview", status: "blocked" }), true);
    assert.equal(previewPublishOverridesVisible({ id: "preview", status: "in_progress" }), false);
    assert.equal(previewPublishOverridesVisible({ id: "preview", status: "complete" }), false);
    assert.equal(previewPublishOverridesVisible({ id: "functions", status: "blocked" }), false);
  });
});
