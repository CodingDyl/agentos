import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { crc32 } from "node:zlib";

const ui = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cs-export-ui-"));
const media = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cs-export-media-"));
process.env.AGENTOS_UI_DIR = ui;
process.env.AGENTOS_MEDIA_DIR = media;

const { storeImage } = await import("../../designs/media");
const { createAsset } = await import("../../designs/library");
const { caseStudyFiles, caseStudyMarkdown } = await import("../case-study-export");
const { buildZip } = await import("../zip");

after(() => {
  fs.rmSync(ui, { recursive: true, force: true });
  fs.rmSync(media, { recursive: true, force: true });
});

// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function addImage(filename: string, notes?: string) {
  const id = randomUUID();
  const stored = await storeImage(id, ".png", PNG);
  await createAsset({ id, filename, storedName: stored.storedName, hasThumbnail: stored.hasThumbnail, dimensions: stored.dimensions, type: "screenshot" });
  if (notes) {
    const { updateAsset } = await import("../../designs/library");
    await updateAsset(id, { notes });
  }
  return id;
}

/** Reads a stored ZIP back: every local entry's name, and whether its CRC matches its data. */
function readZip(buffer: Buffer): { name: string; ok: boolean; data: Buffer }[] {
  const entries: { name: string; ok: boolean; data: Buffer }[] = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const checksum = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    entries.push({ name, ok: (crc32(data) >>> 0) === checksum, data });
    offset += 30 + nameLength + size;
  }
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, "ends with an end-of-directory record");
  return entries;
}

const baseStudy = {
  id: "cs_1",
  title: "A configurator buyers design with",
  client: "Vaja",
  status: "draft" as const,
  problem: "Buyers could not picture the product.",
  solution: "A real-time 3D configurator.",
  result: "Fewer calls per sale. [NEEDS DATA: calls before and after]",
  missing: [],
  createdAt: "",
  updatedAt: "",
};

describe("case study export", () => {
  it("writes a readable ZIP: the Markdown and each image, with matching names", async () => {
    const first = await addImage("Configurator home.png", "The configurator on a phone");
    const second = await addImage("colour_options.png");
    const { entries, markdown, skipped } = await caseStudyFiles({ ...baseStudy, assetIds: [first, second, randomUUID()] });

    assert.equal(skipped, 1, "an id Creative no longer holds is left out");
    assert.deepEqual(entries.map((entry) => entry.name), ["case-study.md", "images/01-configurator-home.png", "images/02-colour-options.png"]);
    assert.match(markdown, /!\[The configurator on a phone\]\(images\/01-configurator-home\.png\)/);
    assert.match(markdown, /!\[colour options\]\(images\/02-colour-options\.png\)/);

    const zip = readZip(buildZip(entries));
    assert.deepEqual(zip.map((entry) => entry.name), entries.map((entry) => entry.name));
    assert.ok(zip.every((entry) => entry.ok), "every CRC matches");
    assert.ok(zip[1].data.equals(PNG), "the image is byte-for-byte the original");
  });

  it("places images after 'What we built' and keeps a gap visible", () => {
    const markdown = caseStudyMarkdown({ ...baseStudy, assetIds: [] }, [{ name: "images/01-x.png", alt: "X" }]);
    const built = markdown.indexOf("## What we built");
    const image = markdown.indexOf("![X]");
    const result = markdown.indexOf("## The result");
    assert.ok(built < image && image < result);
    assert.match(markdown, /\[NEEDS DATA: calls before and after\]/);
  });
});
