import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  downloadFilename,
  extensionFromSource,
  slugifyFilenamePart,
} from "../download-filename";

/**
 * Creative downloads are named `<title-or-prompt-slug>-<date>.<ext>` so a
 * folder of them is readable without opening each file. The stem comes from
 * the title when there is one, otherwise the prompt; the date is the day the
 * asset was made; the extension is the real file's, never the thumbnail's.
 */

const DAY = new Date("2026-10-14T09:00:00Z");

describe("slugifying a title or prompt", () => {
  it("lower-cases, hyphenates, and drops punctuation", () => {
    assert.equal(slugifyFilenamePart("Chef in a warm kitchen!"), "chef-in-a-warm-kitchen");
  });

  it("strips a file extension so it is not doubled later", () => {
    assert.equal(slugifyFilenamePart("dashboard-inspiration.png"), "dashboard-inspiration");
  });

  it("falls back when nothing usable remains", () => {
    assert.equal(slugifyFilenamePart("   "), "download");
    assert.equal(slugifyFilenamePart("!!!"), "download");
    assert.equal(slugifyFilenamePart(""), "download");
  });

  it("truncates a long prompt rather than producing a huge name", () => {
    const slug = slugifyFilenamePart("a ".repeat(80) + "chef");
    assert.ok(slug.length <= 60);
    assert.equal(slug.includes(" "), false);
  });
});

describe("picking the real extension", () => {
  it("reads it from a stored filename or URL path", () => {
    assert.equal(extensionFromSource({ filename: "shot.png" }), "png");
    assert.equal(extensionFromSource({ url: "/api/designs/assets/a1/media.mp4" }), "mp4");
    assert.equal(extensionFromSource({ url: "https://cdn.example/out.webm?sig=1" }), "webm");
  });

  it("maps a mime type, including jpeg to jpg", () => {
    assert.equal(extensionFromSource({ mimeType: "image/jpeg" }), "jpg");
    assert.equal(extensionFromSource({ mimeType: "image/png; charset=binary" }), "png");
    assert.equal(extensionFromSource({ mimeType: "video/quicktime" }), "mov");
  });

  it("reads a data URL's mime type", () => {
    assert.equal(extensionFromSource({ url: "data:image/webp;base64,AAAA" }), "webp");
    assert.equal(extensionFromSource({ url: "data:video/mp4;base64,AAAA" }), "mp4");
  });

  it("prefers the filename/url extension over a generic mime", () => {
    assert.equal(
      extensionFromSource({ filename: "cut.webm", mimeType: "application/octet-stream" }),
      "webm",
    );
  });

  it("falls back to png when nothing else is known", () => {
    assert.equal(extensionFromSource({}), "png");
    assert.equal(extensionFromSource({ mimeType: "application/octet-stream" }), "png");
  });
});

describe("downloadFilename", () => {
  it("uses the title, the asset's day, and the file's extension", () => {
    assert.equal(
      downloadFilename({
        title: "dashboard-inspiration.png",
        date: "2026-10-14T10:00:00Z",
        url: "/api/designs/assets/a1/media",
        filename: "dashboard-inspiration.png",
      }),
      "dashboard-inspiration-2026-10-14.png",
    );
  });

  it("uses the prompt when there is no title", () => {
    assert.equal(
      downloadFilename({
        prompt: "A chef in a warm kitchen, paper texture",
        date: "2026-09-22T08:00:00Z",
        mimeType: "image/png",
      }),
      "a-chef-in-a-warm-kitchen-paper-texture-2026-09-22.png",
    );
  });

  it("prefers the title over the prompt", () => {
    assert.equal(
      downloadFilename({
        title: "Chef hero",
        prompt: "ignored because a title is present",
        date: DAY,
        mimeType: "video/mp4",
      }),
      "chef-hero-2026-10-14.mp4",
    );
  });

  it("uses today when the date is missing or unreadable", () => {
    assert.equal(
      downloadFilename({ title: "still", mimeType: "image/png", now: DAY }),
      "still-2026-10-14.png",
    );
    assert.equal(
      downloadFilename({ title: "still", date: "not-a-date", mimeType: "image/png", now: DAY }),
      "still-2026-10-14.png",
    );
  });

  it("never puts path separators in the name", () => {
    const name = downloadFilename({
      title: "../../etc/passwd",
      date: DAY,
      mimeType: "image/png",
    });
    assert.equal(name, "etc-passwd-2026-10-14.png");
    assert.equal(name.includes("/"), false);
    assert.equal(name.includes("\\"), false);
  });
});
