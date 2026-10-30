import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sender } from "@shared/outreach-case";
import { pathPatch, photoSampleReady } from "../traction-outreach-path";

const sender = { id: "s1", defaultMonthly: "R1 500", defaultSetup: "R4 000", defaultProject: "R25 000" } as unknown as Sender;
const empty = { monthlyPrice: "", setupPrice: "", projectPrice: "" };

describe("pathPatch", () => {
  it("fills your usual monthly and setup prices when building first and none are set", () => {
    assert.deepEqual(pathPatch("build_first", empty, sender), { path: "build_first", monthlyPrice: "R1 500", setupPrice: "R4 000" });
  });

  it("fills the project price, and only that, for a cold pitch", () => {
    assert.deepEqual(pathPatch("cold_pitch", empty, sender), { path: "cold_pitch", projectPrice: "R25 000" });
  });

  it("fills the once-off price for a photo sample only when it is empty", () => {
    assert.deepEqual(pathPatch("photo_sample", empty, sender), { path: "photo_sample", projectPrice: "R25 000" });
    assert.deepEqual(pathPatch("photo_sample", { ...empty, projectPrice: "R3,500" }, sender), { path: "photo_sample" });
  });

  it("never overwrites a price you already set", () => {
    assert.deepEqual(pathPatch("build_first", { ...empty, monthlyPrice: "R900" }, sender), { path: "build_first", setupPrice: "R4 000" });
  });

  it("sets only the approach when there is no sender to take prices from", () => {
    assert.deepEqual(pathPatch("build_first", empty, undefined), { path: "build_first" });
  });
});

describe("photoSampleReady", () => {
  const url = "https://example.com/samples";
  const entry = { samplesUrl: url, samplesChecked: true };

  it("is done only with a link and the honesty check", () => {
    assert.equal(photoSampleReady({ samplesUrl: "", samplesChecked: true }).done, false);
    assert.equal(photoSampleReady({ samplesUrl: url, samplesChecked: false }).done, false);
    assert.equal(photoSampleReady(entry).done, true);
  });

  it("requires the link in the message", () => {
    assert.equal(photoSampleReady(entry, `Look: ${url}`).checks[0].ok, true);
    assert.equal(photoSampleReady(entry, "Look at the photos").checks[0].ok, false);
    assert.equal(photoSampleReady({ samplesUrl: "", samplesChecked: true }, "anything").checks[0].ok, false);
  });

  it("flags attachment wording", () => {
    assert.equal(photoSampleReady(entry, `See ${url}`).checks[1].ok, true);
    assert.equal(photoSampleReady(entry, `Attached are three photos ${url}`).checks[1].ok, false);
    assert.equal(photoSampleReady(entry, `See the attachment ${url}`).checks[1].ok, false);
  });
});
