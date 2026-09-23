import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentTypeFor,
  extensionFor,
  readDimensions,
  resolveMedia,
} from "../media";

/**
 * The grid lays tiles out by aspect ratio before a single image has loaded, so
 * dimensions are read from the file's own header at upload time. Four container
 * formats, parsed by hand rather than pulled in as a native dependency.
 */

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(32);
  data.writeUInt32BE(0x89504e47, 0);
  data.writeUInt32BE(0x0d0a1a0a, 4);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function gif(width: number, height: number): Buffer {
  const data = Buffer.alloc(16);
  data.write("GIF89a", 0, "ascii");
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return data;
}

/** A start-of-frame segment, preceded by a segment that must be skipped. */
function jpeg(width: number, height: number): Buffer {
  const data = Buffer.alloc(64);
  data.writeUInt16BE(0xffd8, 0);
  // APP0, 16 bytes long — the walker must step over it to find the frame.
  data.writeUInt16BE(0xffe0, 2);
  data.writeUInt16BE(16, 4);
  data.writeUInt16BE(0xffc0, 20);
  data.writeUInt16BE(17, 22);
  data[24] = 8;
  data.writeUInt16BE(height, 25);
  data.writeUInt16BE(width, 27);
  return data;
}

function webpLossless(width: number, height: number): Buffer {
  const data = Buffer.alloc(40);
  data.write("RIFF", 0, "ascii");
  data.write("WEBP", 8, "ascii");
  data.write("VP8L", 12, "ascii");
  data[20] = 0x2f;
  // 14 bits each, stored as size - 1.
  data.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return data;
}

describe("reading dimensions", () => {
  it("reads a PNG", () => {
    assert.deepEqual(readDimensions(png(1440, 1000)), {
      width: 1440,
      height: 1000,
    });
  });

  it("reads a GIF", () => {
    assert.deepEqual(readDimensions(gif(320, 240)), { width: 320, height: 240 });
  });

  it("reads a JPEG, stepping over segments before the frame", () => {
    assert.deepEqual(readDimensions(jpeg(375, 812)), {
      width: 375,
      height: 812,
    });
  });

  it("reads a lossless WebP", () => {
    assert.deepEqual(readDimensions(webpLossless(800, 600)), {
      width: 800,
      height: 600,
    });
  });

  it("reports nothing for a format it does not understand", () => {
    // An SVG has no pixel dimensions to read; the grid falls back to a default
    // ratio rather than being told a wrong one.
    assert.equal(readDimensions(Buffer.from("<svg viewBox='0 0 10 10'/>")), undefined);
    assert.equal(readDimensions(Buffer.alloc(4)), undefined);
    assert.equal(readDimensions(Buffer.alloc(0)), undefined);
  });

  it("does not read past the end of a truncated file", () => {
    assert.doesNotThrow(() => readDimensions(png(100, 100).subarray(0, 18)));
    assert.doesNotThrow(() => readDimensions(jpeg(100, 100).subarray(0, 22)));
  });
});

describe("accepted formats", () => {
  it("maps a content type to the extension it is stored under", () => {
    assert.equal(extensionFor("image/png"), ".png");
    assert.equal(extensionFor("image/jpeg"), ".jpg");
    assert.equal(extensionFor("image/webp"), ".webp");
  });

  it("ignores charset and casing", () => {
    assert.equal(extensionFor("IMAGE/PNG; charset=binary"), ".png");
  });

  it("refuses anything that is not an accepted image", () => {
    assert.equal(extensionFor("application/pdf"), undefined);
    assert.equal(extensionFor("text/html"), undefined);
    assert.equal(extensionFor(""), undefined);
  });

  it("names the type a stored file is served as", () => {
    assert.equal(contentTypeFor("abc.png"), "image/png");
    assert.equal(contentTypeFor("abc.unknown"), "application/octet-stream");
  });
});

describe("resolving a stored file", () => {
  it("resolves a name the server generated", () => {
    assert.ok(resolveMedia("originals", "abc123.png").endsWith("/originals/abc123.png"));
  });

  it("refuses a name that would escape the media directory", () => {
    // Stored names are generated, never supplied — but this is the boundary,
    // so it is enforced here rather than trusted upstream.
    assert.throws(() => resolveMedia("originals", "../../.ssh/id_rsa"));
    assert.throws(() => resolveMedia("../../..", "id_rsa"));
  });
});
